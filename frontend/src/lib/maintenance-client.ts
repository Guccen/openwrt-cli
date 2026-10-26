import { RouterClient } from "./rpc";

export const SYSTEM_BACKUP_LIMIT = 128 * 1024;
export interface MaintenanceSnapshot {
  configurationBusy: boolean;
  operationBusy: boolean;
  backupLimit: number;
  updatedAt: number;
}
const errors: Record<string, string> = {
  configuration_busy: "设备存在待确认或暂存的配置，请先完成确认或恢复。",
  operation_busy: "设备正在执行其他维护操作，请稍后重试。",
  confirmation_required: "需要确认重启操作。",
  backup_failed: "系统备份生成失败；自定义备份较大时请通过 SSH 导出。",
  backup_too_large: "系统备份超过 128 KiB，请通过 SSH 导出。",
  preview_only: "本地演示不执行系统备份或重启，请使用 GitHub OpenWrt 模拟测试。",
};
export class MaintenanceClient {
  constructor(readonly rpc = new RouterClient()) {}
  private async call(session: string, method: string, args = {}) {
    const result = await this.rpc.call<Record<string, unknown>>(
      session,
      "router.maintenance",
      method,
      args,
      method === "backup" ? 30000 : undefined,
    );
    if (!result || result.ok !== true)
      throw new Error(errors[String(result?.error)] ?? "设备未能完成维护操作");
    return result;
  }
  async read(session: string): Promise<MaintenanceSnapshot> {
    const result = await this.call(session, "status");
    if (typeof result.configurationBusy !== "boolean" || typeof result.operationBusy !== "boolean")
      throw new Error("系统维护状态格式不正确");
    return {
      configurationBusy: result.configurationBusy,
      operationBusy: result.operationBusy,
      backupLimit: SYSTEM_BACKUP_LIMIT,
      updatedAt: Date.now(),
    };
  }
  async backup(session: string) {
    const result = await this.call(session, "backup");
    return decodeSystemBackup(result);
  }
  async reboot(session: string) {
    const result = await this.call(session, "reboot", { confirm: true });
    if (result.accepted !== true) throw new Error("设备未接受重启请求");
  }
}

export async function decodeSystemBackup(result: Record<string, unknown>) {
  const { data, size, sha256 } = result;
  if (
    typeof data !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
    data.length > Math.ceil(SYSTEM_BACKUP_LIMIT / 3) * 4 ||
    data.length % 4 !== 0 ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > SYSTEM_BACKUP_LIMIT ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256)
  )
    throw new Error("系统备份响应格式或体积不正确");
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  if (bytes.length !== size || bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    throw new Error("系统备份不是有效的 gzip 文件");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (checksum !== sha256) throw new Error("系统备份 SHA-256 校验失败，请重新导出");
  return bytes;
}
