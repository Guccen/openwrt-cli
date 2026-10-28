import { toast } from "sonner";

type NotificationScope =
  | "time"
  | "led"
  | "schedule"
  | "system-backup"
  | "network-backup"
  | "password"
  | "reboot"
  | "restore"
  | "upgrade"
  | "reset"
  | "diagnostics"
  | "network-settings";

// 标识只由固定操作类型生成，重复操作更新同一条通知，也避免历史队列持续增长。
const id = (scope: NotificationScope) => `operation-${scope}`;
export const notify = {
  success(scope: NotificationScope, message: string, description?: string) {
    return toast.success(message, { id: id(scope), description, duration: 4500 });
  },
  info(scope: NotificationScope, message: string, description?: string) {
    return toast.info(message, { id: id(scope), description, duration: 6000 });
  },
  warning(scope: NotificationScope, message: string, description?: string) {
    return toast.warning(message, { id: id(scope), description, duration: 8000 });
  },
  error(scope: NotificationScope, cause: unknown, fallback = "操作失败，请稍后重试。") {
    const message =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : fallback;
    return toast.error(message || fallback, {
      id: id(scope),
      description: undefined,
      duration: 8000,
    });
  },
  dismiss(scope: NotificationScope) {
    toast.dismiss(id(scope));
  },
  clear() {
    toast.dismiss();
  },
};
