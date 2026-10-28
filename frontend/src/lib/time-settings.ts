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
export function validateTimeServers(settings: TimeSettings) {
  const { enabled, useDhcp, servers } = settings;
  if (servers.length > 4 || (enabled && !useDhcp && !servers.length))
    throw new Error("请填写 1–4 个 NTP 服务器，或启用上游 DHCP 校时源。");
  for (const server of servers) {
    const valid =
      server.length <= 253 &&
      (server.includes(":")
        ? /^[0-9a-fA-F:]{2,45}$/.test(server)
        : server
            .split(".")
            .every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)));
    if (!valid) throw new Error("NTP 服务器需为有效的域名或 IP 地址，不要填写 URL、端口或命令。");
  }
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
