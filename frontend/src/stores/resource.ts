import { create } from "zustand";

// 页面按需读取；退出、换会话后丢弃迟到的结果。
export function createSessionResource<T>(
  read: (session: string, signal: AbortSignal) => Promise<T>,
) {
  let generation = 0;
  let controller: AbortController | null = null;
  return create<{
    session: string | null;
    snapshot: T | null;
    loading: boolean;
    error: string | null;
    bind: (session: string | null) => void;
    load: () => Promise<void>;
    cancel: () => void;
  }>((set, get) => ({
    session: null,
    snapshot: null,
    loading: false,
    error: null,
    cancel: () => {
      ++generation;
      controller?.abort();
      controller = null;
      set({ loading: false });
    },
    bind: (session) => {
      if (session === get().session) return;
      get().cancel();
      set({ session, snapshot: null, loading: false, error: null });
    },
    load: async () => {
      const { session, loading } = get();
      if (!session || loading) return;
      const request = generation;
      const current = new AbortController();
      controller = current;
      set({ loading: true, error: null });
      try {
        const snapshot = await read(session, current.signal);
        if (request === generation) set({ snapshot, loading: false });
      } catch (error) {
        if (request === generation)
          set({
            loading: false,
            error: error instanceof Error ? error.message : "读取失败，请重试",
          });
      } finally {
        if (controller === current) controller = null;
      }
    },
  }));
}
