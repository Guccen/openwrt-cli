import { lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";
import { ipv4, ipv4Text, poolRange, subnet } from "./ipv4";

export interface DhcpDraft {
  enabled: boolean;
  start: string;
  end: string;
  lease: string;
}
export function dhcpSection(snapshot: SettingsSnapshot) {
  const sections = Object.entries(snapshot.dhcp).filter(
    ([name, value]) => value[".type"] === "dhcp" && (value.interface === "lan" || name === "lan"),
  );
  if (sections.length !== 1) throw new Error("未找到唯一的 LAN DHCP 配置，请通过 SSH 管理。");
  const [name, value] = sections[0];
  if (
    (value.interface !== undefined && value.interface !== "lan") ||
    value.instance !== undefined ||
    value.netmask !== undefined ||
    String(value.dynamicdhcpv4 ?? value.dynamicdhcp ?? "1") === "0" ||
    ![undefined, "server", "disabled"].includes(value.dhcpv4 as string | undefined)
  )
    throw new Error("当前 DHCP 使用高级配置，请通过 SSH 管理。");
  return [name, value] as const;
}
export function leaseSeconds(value: string) {
  const match = /^([1-9]\d{0,5})([mhd])$/.exec(value);
  const seconds = match ? Number(match[1]) * ({ m: 60, h: 3600, d: 86400 }[match[2]] ?? 0) : 0;
  if (seconds < 120 || seconds > 30 * 86400)
    throw new Error("租期需为 2 分钟至 30 天，例如 30m、12h 或 7d");
  return seconds;
}
export function dhcpDraft(snapshot: SettingsSnapshot): DhcpDraft {
  const [, current] = dhcpSection(snapshot);
  const lan = lanDraft(snapshot),
    range = subnet(lan.address, lan.netmask);
  const start = Number(current.start ?? 100),
    count = Number(current.limit ?? 150);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    start < 1 ||
    count < 1 ||
    range.network + start + count - 1 > 0xffffffff
  )
    throw new Error("当前 DHCP 地址池格式不受支持，请通过 SSH 管理。");
  return {
    enabled: String(current.ignore ?? "0") !== "1" && current.dhcpv4 !== "disabled",
    start: ipv4Text(range.network + start),
    end: ipv4Text(range.network + start + count - 1),
    lease: String(current.leasetime ?? "12h"),
  };
}
export function dhcpPlan(
  snapshot: SettingsSnapshot,
  draft: DhcpDraft,
  bypass: boolean,
): ConfigPlan {
  if (bypass) throw new Error("旁路由不开放 DHCP 地址分配，请使用主路由的 DHCP 服务。");
  const [section, raw] = dhcpSection(snapshot),
    old = dhcpDraft(snapshot),
    lan = lanDraft(snapshot);
  const values: Record<string, string> = {};
  const set = (key: string, value: string) => {
    if (String(raw[key] ?? "") !== value) values[key] = value;
  };
  if (draft.enabled) {
    const bounds = subnet(lan.address, lan.netmask),
      start = ipv4(draft.start.trim()),
      end = ipv4(draft.end.trim());
    if (
      start === null ||
      end === null ||
      start <= bounds.network ||
      end >= bounds.broadcast ||
      end < start
    )
      throw new Error("DHCP 起止地址需按顺序位于 LAN 可用网段内");
    poolRange(lan.address, lan.netmask, start - bounds.network, end - start + 1);
    leaseSeconds(draft.lease.trim());
    if (draft.start.trim() !== old.start) set("start", String(start - bounds.network));
    if (draft.end.trim() !== old.end || draft.start.trim() !== old.start)
      set("limit", String(end - start + 1));
    if (draft.lease.trim() !== old.lease) set("leasetime", draft.lease.trim());
    if (!old.enabled) {
      set("ignore", "0");
      set("dhcpv4", "server");
    }
  } else if (old.enabled) set("dhcpv4", "disabled");
  return {
    label: "DHCP 设置",
    address: lan.address,
    edits: Object.keys(values).length ? [{ config: "dhcp", section, values }] : [],
  };
}
