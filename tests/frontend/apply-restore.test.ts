import { expect, test } from "bun:test";
import {
  createApplyStorage,
  applyStorageKey,
  type SavedApply,
} from "../../frontend/src/lib/apply-storage";
import { ConfigClient } from "../../frontend/src/lib/config-client";
import { createSettingsStore } from "../../frontend/src/stores/settings";
import { dnsPlan } from "../../frontend/src/lib/settings";
import { settingsFixture } from "../helpers/settings-fixture";

const sid = "a".repeat(32);
const origin = "https://192.168.69.1";
function harness() {
  const values = new Map<string, string>();
  const storage = createApplyStorage(
    () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    }),
    () => origin,
  );
  const calls: string[] = [];
  let active = true;
  const snapshot = settingsFixture();
  const client = {
    read: async () => snapshot,
    changes: async () => false,
    stage: async () => {
      calls.push("stage");
    },
    apply: async () => {
      calls.push("apply");
    },
    confirm: async () => {
      calls.push("confirm");
    },
    rollback: async () => {
      calls.push("rollback");
    },
    revert: async () => {
      calls.push("revert");
    },
    applyPending: async () => active,
    rpc: {
      call: async () => ({
        interface: [{ interface: "lan", up: true, "ipv4-address": [{ address: "192.168.69.1" }] }],
      }),
    },
  } as unknown as ConfigClient;
  const store = createSettingsStore(client, storage);
  const reload = () => {
    const next = createSettingsStore(client, storage);
    next.getState().bind(sid);
    return next;
  };
  const apply = async () => {
    store.getState().bind(sid);
    await store.getState().load();
    await store.getState().apply(dnsPlan(snapshot, "1.1.1.1"), origin);
  };
  return {
    store,
    storage,
    values,
    client,
    calls,
    reload,
    apply,
    finish: () => {
      active = false;
    },
  };
}

test("刷新恢复原有倒计时，核对设备快照与实际地址后才能确认", async () => {
  const h = harness();
  await h.apply();
  const pending = h.store.getState().pending;
  const reloaded = h.reload();
  expect(reloaded.getState().pending).toEqual(pending);
  expect(reloaded.getState().reachable).toBe(false);
  await reloaded.getState().confirm();
  expect(h.calls).not.toContain("confirm");
  await reloaded.getState().probe();
  expect(reloaded.getState().reachable).toBe(true);
  await reloaded.getState().confirm();
  expect(h.calls).toContain("confirm");
  expect(h.values.has(applyStorageKey)).toBe(false);
});

test("设备已结束事务时清除恢复记录，不确认或回滚其他设置", async () => {
  const h = harness();
  await h.apply();
  h.finish();
  const reloaded = h.reload();
  await reloaded.getState().probe();
  expect(reloaded.getState().pending).toBeNull();
  expect(h.calls).toEqual(["stage", "apply"]);
  expect(h.values.has(applyStorageKey)).toBe(false);
});

test("恢复意图随刷新保留，过期事务不能确认，退出会清除记录", async () => {
  const h = harness();
  await h.apply();
  const pending = h.store.getState().pending!;
  h.storage.write(sid, {
    pending: { ...pending, deadline: Date.now() - 2000 },
    restoreRequested: true,
  });
  const reloaded = h.reload();
  await reloaded.getState().confirm();
  expect(h.calls).not.toContain("confirm");
  await reloaded.getState().probe();
  expect(h.calls).toContain("rollback");
  expect(h.values.has(applyStorageKey)).toBe(false);
  await h.apply();
  h.store.getState().bind(null);
  expect(h.values.has(applyStorageKey)).toBe(false);
});

test("拒绝跨会话、跨来源、过期和被篡改的事务元数据", async () => {
  const h = harness();
  await h.apply();
  const saved = h.values.get(applyStorageKey)!;
  expect(h.storage.read("b".repeat(32))).toBeNull();
  expect(h.values.has(applyStorageKey)).toBe(false);
  for (const mutate of [
    (v: SavedApply) => {
      v.pending.deadline = Date.now() + 600000;
    },
    (v: SavedApply) => {
      v.pending.deadline = Date.now() - 600000;
    },
    (v: SavedApply) => {
      v.pending.newOrigin = "https://example.com";
    },
    (v: SavedApply) => {
      v.pending.configs = ["system"] as never;
    },
  ]) {
    const value = JSON.parse(saved);
    mutate(value);
    h.values.set(applyStorageKey, JSON.stringify(value));
    expect(h.storage.read(sid)).toBeNull();
  }
});

test("设备状态核对失败保留回滚入口，存储不可用仍可正常应用", async () => {
  const h = harness();
  await h.apply();
  h.client.applyPending = async () => {
    throw new Error("断线");
  };
  const reloaded = h.reload();
  await reloaded.getState().probe();
  expect(reloaded.getState().pending).not.toBeNull();
  expect(reloaded.getState().reachable).toBe(false);
  expect(reloaded.getState().error).toContain("核对");
  const storage = createApplyStorage(
    () => {
      throw new Error("存储不可用");
    },
    () => origin,
  );
  const store = createSettingsStore(h.client, storage);
  store.getState().bind(sid);
  await store.getState().load();
  await store.getState().apply(dnsPlan(settingsFixture(), "1.1.1.1"), origin);
  expect(store.getState().pending).not.toBeNull();
});
