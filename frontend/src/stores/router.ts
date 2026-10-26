import { create } from "zustand";
import { RouterClient, RpcError } from "../lib/rpc";
import type { Device, Snapshot } from "../lib/types";

interface RouterState {
  session: string | null;
  device: Device | null;
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  loadDevice: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function createRouterStore(client = new RouterClient()) {
  // 登录代次用于忽略退出登录或重新登录后才返回的旧请求。
  let generation = 0;
  return create<RouterState>((set, get) => ({
    session: null,
    device: null,
    snapshot: null,
    loading: false,
    error: null,
    loadDevice: async () => set({ device: await client.device() }),
    login: async (password) => {
      if (get().loading) return;
      const request = ++generation;
      set({ loading: true, error: null });
      try {
        const session = await client.login(password);
        if (request !== generation) return;
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
      ++generation;
      set({ session: null, snapshot: null, loading: false, error: null });
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
      const request = generation;
      set({ loading: true, error: null });
      try {
        const snapshot = await client.snapshot(session);
        if (request === generation) set({ snapshot, loading: false });
      } catch (error) {
        if (request !== generation) return;
        if (error instanceof RpcError && error.sessionExpired) {
          ++generation;
          set({ session: null, snapshot: null, loading: false, error: "登录已过期，请重新登录" });
        } else {
          set({ loading: false, error: error instanceof Error ? error.message : "读取状态失败" });
        }
      }
    },
  }));
}

// 会话只保存在内存中，刷新页面后重新登录。
export const useRouter = createRouterStore();
