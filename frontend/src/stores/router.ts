import { create } from "zustand";
import { RouterClient, RpcError } from "../lib/rpc";
import {
  browserSessionStorage,
  isSessionId,
  type SessionStorageAdapter,
} from "../lib/session-storage";
import type { Device, Snapshot } from "../lib/types";
import { appendOverviewSample, type OverviewSample } from "../lib/overview-history";

interface RouterState {
  session: string | null;
  sessionReady: boolean;
  sessionRestoreError: string | null;
  device: Device | null;
  deviceLoading: boolean;
  deviceError: string | null;
  snapshot: Snapshot | null;
  history: OverviewSample[];
  loading: boolean;
  error: string | null;
  loadDevice: () => Promise<void>;
  restoreSession: () => Promise<void>;
  adoptSession: (session: string) => boolean;
  forgetSession: (message?: string) => void;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function createRouterStore(client = new RouterClient(), storage?: SessionStorageAdapter) {
  // 登录代次用于忽略退出登录或重新登录后才返回的旧请求。
  let generation = 0;
  let restoring: Promise<void> | null = null;
  let deviceRequest: Promise<void> | null = null;
  const readSession = () => {
    try {
      return storage?.read() ?? null;
    } catch {
      return null;
    }
  };
  const saveSession = (session: string | null) => {
    try {
      if (session) storage?.write(session);
      else storage?.clear();
    } catch {
      /* 存储不可用时保留当前页面的内存会话。 */
    }
  };
  return create<RouterState>((set, get) => ({
    session: null,
    sessionReady: false,
    sessionRestoreError: null,
    device: null,
    deviceLoading: false,
    deviceError: null,
    snapshot: null,
    history: [],
    loading: false,
    error: null,
    loadDevice: () => {
      if (deviceRequest) return deviceRequest;
      set({ deviceLoading: true, deviceError: null });
      const operation = (async () => {
        try {
          const device = await client.device();
          if (!device) throw new Error("无法识别设备，请检查连接后重试");
          set({ device, deviceError: null });
        } catch {
          // 短暂断线时保留已识别的设备，避免页面退回无限加载。
          set({ deviceError: "设备信息读取失败，请检查连接后重试" });
        } finally {
          set({ deviceLoading: false });
        }
      })();
      deviceRequest = operation;
      void operation.finally(() => {
        if (deviceRequest === operation) deviceRequest = null;
      });
      return operation;
    },
    forgetSession: (message) => {
      ++generation;
      saveSession(null);
      set({
        session: null,
        sessionReady: true,
        sessionRestoreError: null,
        snapshot: null,
        history: [],
        loading: false,
        error: message ?? null,
      });
    },
    adoptSession: (session) => {
      if (!isSessionId(session)) return false;
      ++generation;
      saveSession(session);
      set({
        session,
        sessionReady: true,
        sessionRestoreError: null,
        snapshot: null,
        history: [],
        loading: false,
        error: null,
      });
      return true;
    },
    restoreSession: () => {
      if (get().sessionReady) return Promise.resolve();
      if (restoring) return restoring;
      const session = readSession();
      if (session === null) {
        set({ sessionReady: true });
        return Promise.resolve();
      }
      if (!isSessionId(session)) {
        get().forgetSession("登录已过期，请重新登录");
        return Promise.resolve();
      }
      const request = ++generation;
      set({ loading: true, sessionRestoreError: null });
      const operation = (async () => {
        try {
          const access = await client.call<{ access: boolean }>(session, "session", "access", {
            scope: "ubus",
            object: "system",
            function: "board",
          });
          if (request !== generation) return;
          if (access?.access === false) {
            get().forgetSession("登录已过期，请重新登录");
            return;
          }
          if (access?.access !== true) throw new RpcError("设备返回的会话状态不完整，请重试");
          set({ session, sessionReady: true, loading: false, error: null });
          await get().refresh();
        } catch (error) {
          if (request !== generation) return;
          if (error instanceof RpcError && error.sessionExpired) {
            get().forgetSession("登录已过期，请重新登录");
          } else {
            set({
              loading: false,
              sessionRestoreError:
                error instanceof Error ? error.message : "检查登录状态失败，请重试",
            });
          }
        }
      })();
      restoring = operation;
      void operation.finally(() => {
        if (restoring === operation) restoring = null;
      });
      return operation;
    },
    login: async (password) => {
      if (get().loading) return;
      const request = ++generation;
      saveSession(null);
      set({
        session: null,
        sessionReady: true,
        sessionRestoreError: null,
        snapshot: null,
        history: [],
        loading: true,
        error: null,
      });
      try {
        const session = await client.login(password);
        if (request !== generation) return;
        if (!isSessionId(session)) throw new RpcError("设备未能创建登录会话");
        saveSession(session);
        set({ session, snapshot: null, loading: false });
        await get().refresh();
      } catch (error) {
        if (request !== generation) return;
        set({
          loading: false,
          error:
            error instanceof RpcError && error.sessionExpired
              ? "登录失败，请检查设备密码"
              : error instanceof Error
                ? error.message
                : "登录失败，请重试",
        });
      }
    },
    logout: async () => {
      const session = get().session;
      get().forgetSession();
      if (session) {
        try {
          await client.logout(session);
        } catch {
          /* 本地会话已清除，服务端会话会按时过期。 */
        }
      }
    },
    refresh: async () => {
      const session = get().session;
      if (!session || get().loading) return;
      if (!get().device) void get().loadDevice();
      const request = generation;
      set({ loading: true, error: null });
      try {
        const snapshot = await client.snapshot(session);
        if (request === generation)
          set({ snapshot, history: appendOverviewSample(get().history, snapshot), loading: false });
      } catch (error) {
        if (request !== generation) return;
        if (error instanceof RpcError && error.code === 6) {
          try {
            const access = await client.call<{ access: boolean }>(session, "session", "access", {
              scope: "ubus",
              object: "system",
              function: "board",
            });
            if (request !== generation) return;
            if (access?.access === false) {
              get().forgetSession("登录已过期，请重新登录");
            } else {
              set({
                loading: false,
                error:
                  access?.access === true
                    ? "登录仍有效，但设备拒绝了状态读取请求，请检查权限配置"
                    : "设备返回的会话状态不完整，请重试",
              });
            }
          } catch (verificationError) {
            if (request !== generation) return;
            if (verificationError instanceof RpcError && verificationError.sessionExpired) {
              get().forgetSession("登录已过期，请重新登录");
            } else {
              set({
                loading: false,
                error:
                  verificationError instanceof Error
                    ? verificationError.message
                    : "检查登录状态失败，请重试",
              });
            }
          }
        } else if (error instanceof RpcError && error.sessionExpired) {
          get().forgetSession("登录已过期，请重新登录");
        } else {
          set({ loading: false, error: error instanceof Error ? error.message : "读取状态失败" });
        }
      }
    },
  }));
}

export const useRouter = createRouterStore(new RouterClient(), browserSessionStorage);
