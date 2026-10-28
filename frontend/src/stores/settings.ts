import { create } from "zustand";
import { useMaintenanceOperation } from "./maintenance-operation";
import { APPLY_TIMEOUT, CONFIGS, ConfigClient } from "../lib/config-client";
import { RpcError } from "../lib/rpc";
import {
  browserApplyStorage,
  type ApplyStorageAdapter,
  type PendingApply,
} from "../lib/apply-storage";
import { managementOrigin, type ConfigPlan, type SettingsSnapshot } from "../lib/settings";

export type { PendingApply } from "../lib/apply-storage";
interface SettingsState {
  session: string | null;
  snapshot: SettingsSnapshot | null;
  pending: PendingApply | null;
  phase: "idle" | "staging" | "applying" | "waiting" | "confirming" | "restoring";
  loading: boolean;
  reachable: boolean;
  restoreRequested: boolean;
  recovered: boolean;
  error: string | null;
  notice: string | null;
  destination: string | null;
  staged: boolean;
  revision: number;
  bind: (session: string | null) => void;
  load: () => Promise<void>;
  discard: () => Promise<void>;
  apply: (plan: ConfigPlan, currentOrigin: string) => Promise<void>;
  probe: () => Promise<void>;
  confirm: () => Promise<void>;
  rollback: () => Promise<void>;
  adopt: (session: string, pending: PendingApply) => void;
  completedElsewhere: (destination: string) => void;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请稍后重试";

export function createSettingsStore(client = new ConfigClient(), storage?: ApplyStorageAdapter) {
  let generation = 0;
  let probing = false;
  const store = create<SettingsState>((set, get) => ({
    session: null,
    snapshot: null,
    pending: null,
    phase: "idle",
    loading: false,
    reachable: false,
    restoreRequested: false,
    recovered: false,
    error: null,
    notice: null,
    destination: null,
    staged: false,
    revision: 0,
    bind: (session) => {
      if (session === get().session) return;
      ++generation;
      const saved = session ? storage?.read(session) : null;
      set({
        session,
        snapshot: null,
        pending: saved?.pending ?? null,
        phase: saved ? "waiting" : "idle",
        loading: false,
        reachable: false,
        restoreRequested: saved?.restoreRequested ?? false,
        recovered: !!saved,
        error: null,
        notice: null,
        destination: null,
        staged: false,
      });
    },
    load: async () => {
      const { session, pending } = get();
      if (!session || pending || get().loading) return;
      const request = generation;
      set({ loading: true, error: null });
      try {
        const [snapshot, staged] = await Promise.all([
          client.read(session),
          client.changes(session),
        ]);
        if (request === generation)
          set({ snapshot, staged, loading: false, revision: get().revision + 1 });
      } catch (error) {
        if (request === generation) set({ loading: false, error: message(error) });
      }
    },
    discard: async () => {
      const { session, pending } = get();
      if (!session || pending || get().loading) return;
      const request = generation;
      set({ loading: true, error: null, notice: null });
      try {
        await client.revert(session, CONFIGS);
        if (request !== generation) return;
        set({ loading: false, staged: false, snapshot: null, notice: "已丢弃暂存改动" });
        await get().load();
      } catch (error) {
        if (request === generation) set({ loading: false, error: message(error) });
      }
    },
    apply: async (plan, origin) => {
      const { session, snapshot, pending, staged } = get();
      if (!session || !snapshot || pending || get().loading) return;
      if (useMaintenanceOperation.getState().kind) {
        set({ error: "系统维护操作进行中，请等待完成后再修改设置" });
        return;
      }
      if (!plan.edits.length) {
        set({ error: "没有需要应用的改动" });
        return;
      }
      if (staged) {
        set({ error: "当前会话有未应用改动，请先丢弃或等待恢复完成" });
        return;
      }
      const request = generation;
      const configs = [...new Set(plan.edits.map((edit) => edit.config))];
      const transaction: PendingApply = {
        label: plan.label,
        address: plan.address,
        previousAddress: String(snapshot.network.lan.ipaddr),
        configs,
        oldOrigin: origin,
        newOrigin:
          plan.address === String(snapshot.network.lan.ipaddr)
            ? origin
            : managementOrigin(plan.address, origin),
        deadline: Date.now() + APPLY_TIMEOUT * 1000,
      };
      set({
        phase: "staging",
        loading: true,
        error: null,
        notice: null,
        restoreRequested: false,
        recovered: false,
      });
      let started = false;
      try {
        if (await client.changes(session)) throw new Error("检测到其他未应用改动，请重新读取配置");
        started = true;
        await client.stage(session, plan.edits);
        if (request !== generation) return;
      } catch (error) {
        if (started)
          try {
            await client.revert(session, configs);
          } catch {
            /* 清理失败会在下一次读取时显示暂存状态。 */
          }
        if (request === generation) {
          set({ phase: "idle", loading: false });
          await get().load();
          set({ error: message(error) });
        }
        return;
      }
      transaction.deadline = Date.now() + APPLY_TIMEOUT * 1000;
      set({ pending: transaction, phase: "applying", reachable: false });
      try {
        await client.apply(session);
        if (request === generation) set({ phase: "waiting", loading: false });
      } catch (error) {
        if (request !== generation) return;
        if (error instanceof RpcError && error.code !== undefined) {
          try {
            await client.revert(session, configs);
          } catch {
            /* 其他会话可能正在应用设置。 */
          }
          set({ pending: null, phase: "idle", loading: false });
          await get().load();
          set({ error: "设备未接受应用请求，可能有其他设置正在应用，请稍后重新读取" });
        } else {
          // 应用后断线时，无法断言请求失败；保留倒计时，让设备负责恢复。
          set({
            phase: "waiting",
            loading: false,
            error: "连接暂时中断，请重新连接设备后确认，或等待自动恢复",
          });
        }
      }
    },
    probe: async () => {
      const { pending, session, phase } = get();
      if (
        !pending ||
        !session ||
        probing ||
        ["applying", "confirming", "restoring"].includes(phase)
      )
        return;
      const request = generation;
      probing = true;
      try {
        // 存储只恢复界面线索；设备的回滚快照和实际地址才决定是否开放确认。
        if (get().recovered && !(await client.applyPending(session))) {
          if (request !== generation || pending !== get().pending) return;
          set({
            pending: null,
            phase: "idle",
            recovered: false,
            reachable: false,
            notice: "设备已结束配置确认，已重新读取当前设置",
          });
          await get().load();
          return;
        }
        const state = await client.rpc.call<{
          interface: { interface: string; up: boolean; "ipv4-address"?: { address: string }[] }[];
        }>(session, "network.interface", "dump");
        if (request !== generation || pending !== get().pending) return;
        const lan = state.interface.find((item) => item.interface === "lan" && item.up);
        set({
          reachable: !!lan?.["ipv4-address"]?.some((item) => item.address === pending.address),
          ...(get().recovered ? { error: null } : {}),
        });
        if (Date.now() > pending.deadline + 1500 || get().restoreRequested) await get().rollback();
      } catch {
        if (request === generation)
          set({
            reachable: false,
            ...(get().recovered
              ? { error: "暂时无法核对设备的配置确认状态，请重试连接或等待自动恢复" }
              : {}),
          });
      } finally {
        probing = false;
      }
    },
    confirm: async () => {
      const { session, pending, reachable } = get();
      if (
        !session ||
        !pending ||
        !reachable ||
        get().loading ||
        get().restoreRequested ||
        Date.now() >= pending.deadline
      )
        return;
      if (typeof window !== "undefined" && window.location.origin !== pending.newOrigin) return;
      const request = generation;
      set({ phase: "confirming", loading: true, error: null, notice: null });
      try {
        await client.confirm(session);
        if (request !== generation) return;
        set({
          pending: null,
          phase: "idle",
          loading: false,
          notice: "设置已确认并保留",
          staged: false,
          snapshot: null,
        });
        await get().load();
      } catch (error) {
        if (request === generation)
          set({ phase: "waiting", loading: false, error: message(error) });
      }
    },
    rollback: async () => {
      const { session, pending } = get();
      if (!session || !pending || get().loading) return;
      const request = generation;
      set({ phase: "restoring", loading: true, error: null, notice: null, restoreRequested: true });
      let accepted = false;
      try {
        try {
          await client.rollback(session);
        } catch (error) {
          if (!(error instanceof RpcError && error.code === 10)) throw error;
        }
        accepted = true;
        await client.revert(session, pending.configs);
        if (request !== generation) return;
        const differentOrigin =
          typeof window !== "undefined" && window.location.origin !== pending.oldOrigin;
        set({
          pending: null,
          phase: "idle",
          loading: false,
          snapshot: null,
          staged: false,
          notice: "已请求恢复原设置",
          destination: differentOrigin ? pending.oldOrigin : null,
        });
        if (!differentOrigin) await get().load();
      } catch {
        if (
          request === generation &&
          accepted &&
          typeof window !== "undefined" &&
          window.location.origin !== pending.oldOrigin
        ) {
          set({
            pending: null,
            phase: "idle",
            loading: false,
            snapshot: null,
            destination: pending.oldOrigin,
            notice: "设备已接受恢复请求，请返回原地址继续管理",
          });
          return;
        }
        if (request === generation)
          set({
            phase: "waiting",
            loading: false,
            reachable: false,
            error: "正在等待设备恢复连接；可返回原地址，设备到期会自动恢复",
          });
      }
    },
    adopt: (session, pending) => {
      ++generation;
      set({
        session,
        pending,
        snapshot: null,
        phase: "waiting",
        loading: false,
        reachable: false,
        restoreRequested: false,
        recovered: false,
        error: null,
        notice: null,
        destination: null,
      });
    },
    completedElsewhere: (destination) => {
      ++generation;
      set({
        pending: null,
        phase: "idle",
        loading: false,
        reachable: false,
        snapshot: null,
        destination,
        notice: "设置已在新地址确认，请使用新页面继续管理",
      });
    },
  }));
  store.subscribe((state, previous) => {
    if (
      state.pending === previous.pending &&
      state.session === previous.session &&
      state.restoreRequested === previous.restoreRequested
    )
      return;
    if (state.session && state.pending)
      storage?.write(state.session, {
        pending: state.pending,
        restoreRequested: state.restoreRequested,
      });
    else storage?.clear();
  });
  return store;
}

export const useSettings = createSettingsStore(new ConfigClient(), browserApplyStorage);
