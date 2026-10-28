import { RouterClient, RpcError } from "./rpc";
import type { ClientLeases, NetworkInterface } from "./types";

export function temperatureLabel(name: string, index: number) {
  if (/[\u4e00-\u9fff]/.test(name)) return name;
  if (/cpu|package/i.test(name)) return "处理器温度";
  if (/gpu/i.test(name)) return "图形处理器温度";
  if (/wifi|wlan|radio/i.test(name)) return "无线芯片温度";
  if (/ddr|dram|memory/i.test(name)) return "内存温度";
  if (/soc/i.test(name)) return "系统芯片温度";
  if (/board|ambient/i.test(name)) return "主板温度";
  // 无法确认硬件用途时只显示编号，不把未知传感器误标为处理器。
  return `温度传感器 ${index + 1}`;
}

export function defaultRoutes(iface: NetworkInterface) {
  return (iface.route ?? []).filter(
    (route) => route.mask === 0 && ["0.0.0.0", "::"].includes(route.target),
  );
}

export function upstreamInterfaces(interfaces: NetworkInterface[]) {
  return interfaces.filter(
    (iface) =>
      iface.interface !== "loopback" &&
      (["wan", "wan6"].includes(iface.interface) || defaultRoutes(iface).length > 0),
  );
}

export function leaseRemaining(seconds: number | null) {
  if (seconds === null) return "永久";
  if (seconds <= 0) return "已到期，刷新查看";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export async function readClients(
  session: string,
  client = new RouterClient(),
): Promise<ClientLeases> {
  const result = await client.call<ClientLeases>(session, "router.status", "clients");
  if (!result?.ok || !Array.isArray(result.ipv4) || !Array.isArray(result.ipv6))
    throw new RpcError("读取客户端租约失败，请稍后刷新或检查设备端状态组件。");
  return { ...result, updatedAt: Date.now() };
}
