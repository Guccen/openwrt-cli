import { RouterClient, RpcError } from "./rpc";
import { wifiBand, type WifiBand } from "./wifi-band";

export interface WirelessStation {
  mac: string;
  signal: number | null;
  connected: number | null;
  authorized: boolean | null;
  rx: number | null;
  tx: number | null;
}
export interface WirelessInterface {
  section: string;
  name: string;
  ssid: string;
  mode: string;
  channel: number | null;
  frequency: number | null;
  stations: WirelessStation[] | null;
  warning: string | null;
}
export interface WirelessRadio {
  name: string;
  up: boolean;
  pending: boolean;
  disabled: boolean;
  failed: boolean;
  band: WifiBand;
  channel: string;
  interfaces: WirelessInterface[];
}
export interface WirelessSnapshot {
  radios: WirelessRadio[];
  updatedAt: number;
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function signalDbm(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  // iwinfo 在部分版本中以无符号 32 位整数返回负的 dBm。
  const signed = value | 0;
  return signed >= -127 && signed < 0 ? signed : null;
}
export function station(value: unknown): WirelessStation {
  const row = record(value);
  return {
    mac: text(row.mac),
    signal: signalDbm(row.signal),
    connected: positive(row.connected_time),
    authorized: typeof row.authorized === "boolean" ? row.authorized : null,
    rx: positive(record(row.rx).rate),
    tx: positive(record(row.tx).rate),
  };
}

export class WirelessClient {
  constructor(readonly rpc = new RouterClient()) {}

  async read(session: string): Promise<WirelessSnapshot> {
    const response = await this.rpc.call<{ ok: boolean; radios: unknown }>(
      session,
      "router.status",
      "wireless",
    );
    if (response?.ok !== true) throw new RpcError("无线状态暂不可用，请稍后刷新。");
    const raw = response.radios;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new RpcError("无线状态格式不正确");
    const radios = await Promise.all(
      Object.entries(raw)
        .slice(0, 8)
        .map(async ([name, value]) => {
          const row = record(value);
          const config = record(row.config);
          const interfaces = await Promise.all(
            (Array.isArray(row.interfaces) ? row.interfaces : [])
              .slice(0, 32)
              .map(async (entry) => {
                const iface = record(entry);
                const options = record(iface.config);
                const result: WirelessInterface = {
                  section: text(iface.section),
                  name: text(iface.ifname),
                  ssid: text(options.ssid),
                  mode: text(options.mode),
                  channel: null,
                  frequency: null,
                  stations: null,
                  warning: null,
                };
                if (row.up !== true || !result.name) return result;
                // 无线重载时单个接口可能消失；仍保留其他接口的读取结果。
                const responses = await Promise.allSettled([
                  this.rpc.call<Record<string, unknown>>(session, "iwinfo", "info", {
                    device: result.name,
                  }),
                  this.rpc.call<{ results: unknown[] }>(session, "iwinfo", "assoclist", {
                    device: result.name,
                  }),
                ]);
                for (const response of responses)
                  if (
                    response.status === "rejected" &&
                    response.reason instanceof RpcError &&
                    response.reason.sessionExpired
                  )
                    throw response.reason;
                if (responses[0].status === "fulfilled") {
                  result.channel = positive(responses[0].value?.channel);
                  result.frequency = positive(responses[0].value?.frequency);
                }
                if (
                  responses[1].status === "fulfilled" &&
                  Array.isArray(responses[1].value?.results)
                )
                  result.stations = responses[1].value.results.slice(0, 512).map(station);
                if (responses.some((item) => item.status === "rejected"))
                  result.warning =
                    "部分运行数据未能读取，请确认 iwinfo 已安装，或等待无线重载后刷新。";
                return result;
              }),
          );
          return {
            name,
            up: row.up === true,
            pending: row.pending === true,
            disabled: row.disabled === true,
            failed: row.retry_setup_failed === true,
            band: wifiBand(config, interfaces.find((item) => item.frequency)?.frequency),
            channel: String(config.channel ?? ""),
            interfaces,
          };
        }),
    );
    return { radios, updatedAt: Date.now() };
  }
}
