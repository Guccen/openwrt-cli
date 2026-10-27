// 浏览器仅保存当前标签页的 rpcd 会话标识，设备密码始终留在登录请求中。
export const sessionStorageKey = "router-ui-session";

export interface SessionStorageAdapter {
  read: () => string | null;
  write: (session: string) => void;
  clear: () => void;
}

export function isSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{32}$/.test(value) &&
    value !== "00000000000000000000000000000000"
  );
}

export function createSessionStorage(
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): SessionStorageAdapter {
  return {
    read: () => {
      try {
        return storage()?.getItem(sessionStorageKey) ?? null;
      } catch {
        return null;
      }
    },
    write: (session) => {
      try {
        if (isSessionId(session)) storage()?.setItem(sessionStorageKey, session);
      } catch {
        /* 隐私模式或存储配额不可用时，当前页面仍可正常登录。 */
      }
    },
    clear: () => {
      try {
        storage()?.removeItem(sessionStorageKey);
      } catch {
        /* 当前内存中的会话仍须清除。 */
      }
    },
  };
}

export const browserSessionStorage = createSessionStorage(() =>
  typeof window === "undefined" ? null : window.sessionStorage,
);
