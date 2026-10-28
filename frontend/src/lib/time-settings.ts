import { RouterClient } from "./rpc";
export interface TimeSettings {
  zone: string;
  enabled: boolean;
  useDhcp: boolean;
  servers: string[];
}
export interface TimeSnapshot {
  ok: boolean;
  settings: TimeSettings;
  zones: string[];
  error?: string;
}
export class TimeClient {
  constructor(readonly rpc = new RouterClient()) {}
  async read(session: string) {
    const response = await this.rpc.call<TimeSnapshot>(
      session,
      "router.maintenance",
      "time_status",
    );
    if (!response?.ok || !response.settings || !Array.isArray(response.zones))
      throw new Error("无法读取时间设置，请确认设备组件已更新。");
    return response;
  }
  async save(session: string, settings: TimeSettings) {
    const response = await this.rpc.call<{ ok: boolean; error?: string }>(
      session,
      "router.maintenance",
      "time_save",
      settings,
    );
    if (!response?.ok)
      throw new Error(
        response?.error === "configuration_busy" || response?.error === "operation_busy"
          ? "请先完成网络配置或其他维护操作。"
          : "时间设置未能保存，请检查时区和 NTP 服务器后重试。",
      );
  }
}
