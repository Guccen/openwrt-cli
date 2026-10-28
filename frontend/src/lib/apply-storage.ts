import { CONFIGS } from "./config-client";
import { ipv4, managementOrigin, type ConfigName } from "./settings";
import { isSessionId } from "./session-storage";

export interface PendingApply {
  label: string;
  deadline: number;
  oldOrigin: string;
  newOrigin: string;
  address: string;
  previousAddress: string;
  configs: ConfigName[];
}
export interface SavedApply {
  pending: PendingApply;
  restoreRequested: boolean;
}
export interface ApplyStorageAdapter {
  read: (session: string) => SavedApply | null;
  write: (session: string, value: SavedApply) => void;
  clear: () => void;
}
export const applyStorageKey = "router-ui-pending-apply";

function origin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

export function validSavedApply(value: unknown, currentOrigin: string): value is SavedApply {
  if (!value || typeof value !== "object") return false;
  const { pending: p, restoreRequested } = value as SavedApply;
  if (!p || typeof p !== "object") return false;
  return (
    typeof restoreRequested === "boolean" &&
    typeof p.label === "string" &&
    p.label.length > 0 &&
    p.label.length < 80 &&
    Number.isFinite(p.deadline) &&
    p.deadline > Date.now() - 300000 &&
    p.deadline <= Date.now() + 125000 &&
    origin(p.oldOrigin) &&
    origin(p.newOrigin) &&
    [p.oldOrigin, p.newOrigin].includes(currentOrigin) &&
    typeof p.address === "string" &&
    ipv4(p.address) !== null &&
    typeof p.previousAddress === "string" &&
    ipv4(p.previousAddress) !== null &&
    p.newOrigin ===
      (p.address === p.previousAddress ? p.oldOrigin : managementOrigin(p.address, p.oldOrigin)) &&
    Array.isArray(p.configs) &&
    p.configs.length > 0 &&
    p.configs.length <= CONFIGS.length &&
    new Set(p.configs).size === p.configs.length &&
    p.configs.every((name) => CONFIGS.includes(name))
  );
}

export function createApplyStorage(
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  currentOrigin: () => string,
): ApplyStorageAdapter {
  return {
    read: (session) => {
      try {
        const raw = storage()?.getItem(applyStorageKey);
        if (!raw) return null;
        const value = raw.length <= 4096 ? JSON.parse(raw) : null;
        if (
          isSessionId(session) &&
          value?.version === 1 &&
          value.session === session &&
          validSavedApply(value, currentOrigin())
        )
          return { pending: value.pending, restoreRequested: value.restoreRequested };
        storage()?.removeItem(applyStorageKey);
      } catch {
        /* 存储异常不影响当前标签页的配置回滚。 */
      }
      return null;
    },
    write: (session, value) => {
      try {
        if (isSessionId(session) && validSavedApply(value, currentOrigin()))
          storage()?.setItem(applyStorageKey, JSON.stringify({ version: 1, session, ...value }));
      } catch {
        /* 无法持久化时继续使用当前内存中的确认流程。 */
      }
    },
    clear: () => {
      try {
        storage()?.removeItem(applyStorageKey);
      } catch {
        /* 内存状态仍会清理。 */
      }
    },
  };
}

export const browserApplyStorage = createApplyStorage(
  () => (typeof window === "undefined" ? null : window.sessionStorage),
  () => (typeof window === "undefined" ? "" : window.location.origin),
);
