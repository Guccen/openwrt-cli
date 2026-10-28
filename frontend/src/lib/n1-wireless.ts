import {
  lanDraft,
  wifiDrafts,
  wifiPlan,
  type ConfigEdit,
  type SettingsSnapshot,
  type WifiDraft,
} from "./settings";
import type { Device } from "./types";

export const n1Topologies = {
  usb: "USB 网口上网，内置网口与 WiFi 接设备",
  station: "WiFi 连接上游，内置网口接设备",
  ethernet: "内置网口上网，WiFi 接设备",
};
export type N1Topology = keyof typeof n1Topologies;
const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/).filter(Boolean)
      : [];

export function n1Topology(snapshot: SettingsSnapshot, device: Device): N1Topology {
  const radios = wifiDrafts(snapshot, true);
  const iface = snapshot.wireless[radios[0]?.section];
  const bridges = Object.entries(snapshot.network).filter(
    ([, value]) =>
      value[".type"] === "device" && value.name === "br-lan" && value.type === "bridge",
  );
  if (
    device.device !== "phicomm-n1" ||
    radios.length !== 1 ||
    !radios[0].editable ||
    snapshot.network.lan.device !== "br-lan" ||
    bridges.length !== 1
  )
    throw new Error("当前 N1 使用高级网络配置，暂不能自动切换接线方案。");
  const ports = list(bridges[0][1].ports);
  const lanPort = ports.length === 1 && ports[0] === "eth0";
  const wan = snapshot.network.wan;
  if (iface.mode === "ap" && list(iface.network).join() === "lan") {
    if (lanPort && (device.role === "bypass" || wan?.device === (device.wan || "eth1")))
      return "usb";
    if (!ports.length && device.role === "router" && wan?.device === "eth0") return "ethernet";
  }
  if (
    device.role === "router" &&
    iface.mode === "sta" &&
    list(iface.network).join() === "wan" &&
    lanPort &&
    !wan?.device &&
    !wan?.ifname &&
    wan?.proto === "dhcp"
  )
    return "station";
  throw new Error("当前 N1 的网口或无线归属已自定义，请通过 SSH 管理。");
}

export function n1WifiPlan(
  snapshot: SettingsSnapshot,
  draft: WifiDraft,
  topology: N1Topology,
  device: Device,
) {
  const old = n1Topology(snapshot, device);
  if (!Object.hasOwn(n1Topologies, topology) || (device.role === "bypass" && topology !== "usb"))
    throw new Error("旁路由仅支持 LAN 无线热点。");
  if (draft.encryption !== "psk2") throw new Error("N1 无线使用 WPA2 个人版以兼容配套驱动。");
  if (topology !== "usb" && !draft.enabled)
    throw new Error("此接线方案依赖 WiFi，请启用并设置密码，或先切回 USB 网口方案。");
  // 切换上下游时不把原热点密码当作上游密码，也不把上游密码发布为热点密码。
  if ((old === "station") !== (topology === "station") && !draft.password)
    throw new Error("切换热点与上游连接时请重新填写对应的 WiFi 密码。");
  const plan = wifiPlan(snapshot, draft, true);
  if (old === topology) return plan;
  const wan = snapshot.network.wan;
  if (
    !wan ||
    !["dhcp", "static", "pppoe"].includes(String(wan.proto)) ||
    wan.ifname ||
    (snapshot.network.wan6 && snapshot.network.wan6.device !== "@wan")
  )
    throw new Error("当前 WAN 或 IPv6 使用高级配置，请先通过 SSH 核对。");
  const usb = device.wan || "eth1";
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$/.test(usb) || ["eth0", "lo", "br-lan"].includes(usb))
    throw new Error("镜像记录的 USB WAN 网口无效。");
  const bridge = Object.entries(snapshot.network).find(
    ([, value]) => value[".type"] === "device" && value.name === "br-lan",
  )!;
  const edits: ConfigEdit[] = [
    ...plan.edits,
    {
      config: "wireless",
      section: draft.section,
      values: {
        mode: topology === "station" ? "sta" : "ap",
        network: topology === "station" ? "wan" : "lan",
        hidden: "0",
      },
      remove: snapshot.wireless[draft.section].bssid !== undefined ? ["bssid"] : [],
    },
    {
      config: "wireless",
      section: draft.device,
      values: { channel: topology === "station" ? "auto" : draft.band === "5g" ? "36" : "1" },
    },
    {
      config: "network",
      section: bridge[0],
      values:
        topology === "ethernet" ? { bridge_empty: "1" } : { ports: ["eth0"], bridge_empty: "1" },
      remove: topology === "ethernet" ? ["ports"] : [],
    },
    {
      config: "network",
      section: "wan",
      values: {
        proto: "dhcp",
        ...(topology === "station" ? {} : { device: topology === "ethernet" ? "eth0" : usb }),
      },
      remove: [
        "ipaddr",
        "netmask",
        "gateway",
        "username",
        "password",
        "ipv6",
        ...(topology === "station" ? ["device"] : []),
      ].filter((key) => wan[key] !== undefined),
    },
  ];
  return { label: "N1 无线与接线方案", address: lanDraft(snapshot).address, edits };
}
