import { RouterClient } from "./rpc";

export const SYSTEM_BACKUP_LIMIT = 128 * 1024;
export const FIRMWARE_LIMIT = 32 * 1024 * 1024;
export type DestructiveOperation = "restore" | "upgrade" | "reset";
export interface PreparedUpload {
  token: string;
  kind: "restore" | "upgrade";
  size: number;
  sha256: string;
  files?: number;
}
export interface MaintenanceSnapshot {
  configurationBusy: boolean;
  operationBusy: boolean;
  backupLimit: number;
  upgradeSupported: boolean;
  resetSupported: boolean;
  updatedAt: number;
}
const errors: Record<string, string> = {
  configuration_busy: "设备存在待确认或暂存的配置，请先完成确认或恢复。",
  operation_busy: "设备正在执行其他维护操作，请稍后重试。",
  confirmation_required: "需要再次确认维护操作。",
  backup_failed: "系统备份生成失败；自定义备份较大时请通过 SSH 导出。",
  backup_too_large: "系统备份超过 128 KiB，请通过 SSH 导出。",
  preview_only: "本地演示不操作系统文件，请使用 OpenWrt 模拟机或真实设备。",
  invalid_archive: "归档损坏或包含不支持的路径、链接或文件类型，请通过 SSH 检查。",
  archive_mismatch: "归档缺少本项目清单，或设备、模式、固件版本不一致，不能通过网页恢复。",
  invalid_upload: "上传数据或顺序不正确，请重新选择文件。",
  invalid_token: "上传凭据已失效，请重新上传。",
  incomplete_upload: "文件尚未上传完整。",
  upload_expired: "上传已超过 10 分钟，请重新上传。",
  write_failed: "设备无法保存上传文件，请检查剩余内存。",
  checksum_mismatch: "设备端 SHA-256 校验失败，请重新上传。",
  insufficient_space: "设备临时空间不足，需要至少 40 MiB 可用空间。",
  unsupported_device: "当前设备或存储布局不支持此操作；N1 请按刷机文档重新写卡。",
  invalid_firmware: "固件未通过设备兼容性检查，请选择匹配 AX1800 的 sysupgrade 镜像。",
  restore_failed: "配置恢复失败，已尝试还原原配置。请通过 SSH 检查后再重启。",
  restore_rollback_failed: "配置恢复及原配置还原失败，请保持设备通电并通过 SSH 修复。",
  invalid_password: "新密码需要 8–128 字节，密码不能包含控制字符或全部为空白。",
  password_mismatch: "两次输入的新密码不一致。",
  password_unchanged: "新密码不能与当前密码相同。",
  current_password_incorrect: "当前登录密码不正确。",
  password_failed: "修改密码未完成，请检查设备状态；连接中断时请先尝试新密码登录，勿反复提交。",
};
export class MaintenanceClient {
  constructor(readonly rpc = new RouterClient()) {}
  private async call(session: string, method: string, args = {}) {
    const result = await this.rpc.call<Record<string, unknown>>(
      session,
      "router.maintenance",
      method,
      args,
      ["backup", "inspect", "restore", "upgrade"].includes(method) ? 30000 : undefined,
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
      upgradeSupported: result.upgradeSupported === true,
      resetSupported: result.resetSupported === true,
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
  async prepare(
    session: string,
    kind: "restore" | "upgrade",
    file: File,
    expectedChecksum: string,
    progress: (percent: number) => void,
  ): Promise<PreparedUpload> {
    const limit = kind === "restore" ? SYSTEM_BACKUP_LIMIT : FIRMWARE_LIMIT;
    if (file.size < 1 || file.size > limit)
      throw new Error(`文件体积必须在 1 字节至 ${limit / 1024} KiB 之间。`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (
      kind === "upgrade" &&
      (!/^[a-f0-9]{64}$/i.test(expectedChecksum.trim()) ||
        sha256 !== expectedChecksum.trim().toLowerCase())
    )
      throw new Error("固件与填写的 SHA-256 不一致，请核对构建产物的校验文件。");
    if (kind === "restore" && (bytes[0] !== 0x1f || bytes[1] !== 0x8b))
      throw new Error("请选择 gzip 格式的系统配置归档。");
    const result = await this.call(session, "upload_start", { kind, size: bytes.length, sha256 });
    if (typeof result.token !== "string" || !/^[a-f0-9]{32}$/.test(result.token))
      throw new Error("设备返回的上传凭据无效");
    const token = result.token;
    try {
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        const chunk = bytes.subarray(offset, offset + 32768);
        const data = btoa(Array.from(chunk, (byte) => String.fromCharCode(byte)).join(""));
        const response = await this.call(session, "upload_chunk", { token, offset, data });
        if (response.offset !== offset + chunk.length) throw new Error("设备返回的上传进度不一致");
        progress(Math.round(((offset + chunk.length) / bytes.length) * 100));
      }
      const inspected = await this.call(session, "inspect", { token });
      return {
        token,
        kind,
        size: bytes.length,
        sha256,
        files: typeof inspected.files === "number" ? inspected.files : undefined,
      };
    } catch (error) {
      await this.cancel(session, token).catch(() => {});
      throw error;
    }
  }
  async cancel(session: string, token: string) {
    await this.call(session, "upload_cancel", { token });
  }
  async execute(session: string, kind: DestructiveOperation, token?: string) {
    const result = await this.call(session, kind, { confirm: true, ...(token ? { token } : {}) });
    if (result.accepted !== true) throw new Error("设备未接受维护请求");
  }
  async changePassword(session: string, current: string, password: string, confirmation: string) {
    validatePasswordChange(current, password, confirmation);
    const result = await this.call(session, "password", { current, password, confirmation });
    if (result.changed !== true) throw new Error(errors.password_failed);
    return result.sessionsRevoked === true;
  }
}

export function validatePasswordChange(current: string, password: string, confirmation: string) {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (!current || bytes(current) > 512) throw new Error("请输入当前登录密码。");
  if (
    bytes(password) < 8 ||
    bytes(password) > 128 ||
    !password.trim() ||
    Array.from(current + password).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error(errors.invalid_password);
  if (password !== confirmation) throw new Error(errors.password_mismatch);
  if (password === current) throw new Error(errors.password_unchanged);
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
