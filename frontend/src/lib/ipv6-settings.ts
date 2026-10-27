import {
  lanDraft,
  type ConfigEdit,
  type ConfigPlan,
  type SettingsSnapshot,
  type UciSection,
} from "./settings";

export type Ipv6Mode = "auto" | "relay" | "static" | "off";
export interface Ipv6Draft {
  mode: Ipv6Mode;
  prefixHint: string;
  autoDns: boolean;
  dns: string;
  address: string;
  gateway: string;
  prefix: string;
  lan: boolean;
}
export const ipv6Modes: Record<Ipv6Mode, string> = {
  auto: "自动获取（DHCPv6 / 前缀委派）",
  relay: "中继（上游不分配前缀）",
  static: "静态 IPv6",
  off: "关闭 IPv6 上网",
};
const relaySection = "router_ui_ipv6_uplink";
export function ipv6Number(input: string): bigint | null {
  if (!input.includes(":") || !/^[a-f\d:.]+$/i.test(input)) return null;
  try {
    const canonical = new URL(`http://[${input}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split("::");
    const a = left ? left.split(":") : [],
      b = right ? right.split(":") : [];
    const parts =
      right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
    if (parts.length !== 8) return null;
    return parts.reduce((n, part) => (n << 16n) | BigInt(`0x${part}`), 0n);
  } catch {
    return null;
  }
}
export function isIpv6Unicast(input: string) {
  const value = ipv6Number(input);
  return value !== null && value > 1n && value >> 120n !== 255n && value >> 32n !== 65535n;
}
export function ipv6Cidr(input: string, prefixOnly = false) {
  const [address, mask, extra] = input.trim().split("/");
  if (
    extra !== undefined ||
    !address ||
    !mask ||
    !/^[1-9]\d{0,2}$/.test(mask) ||
    !isIpv6Unicast(address)
  )
    return false;
  const bits = Number(mask);
  if (bits < (prefixOnly ? 16 : 1) || bits > (prefixOnly ? 64 : 128)) return false;
  return !prefixOnly || (ipv6Number(address)! & ((1n << BigInt(128 - bits)) - 1n)) === 0n;
}
function list(value: UciSection[string] | undefined): string[] {
  return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
}
function lanDhcp(snapshot: SettingsSnapshot) {
  const result = Object.entries(snapshot.dhcp).filter(
    ([name, section]) =>
      section[".type"] === "dhcp" && (section.interface === "lan" || name === "lan"),
  );
  if (result.length !== 1) throw new Error("LAN 地址分配配置不唯一，需先检查高级 DHCP 配置。");
  return result[0]!;
}
export function ipv6Draft(snapshot: SettingsSnapshot, bypass: boolean): Ipv6Draft {
  const name = bypass ? "lan6" : "wan6",
    current = snapshot.network[name];
  if (!bypass && !snapshot.network.wan) throw new Error("未找到 WAN，需先配置上网接口。");
  if (
    current &&
    (current[".type"] !== "interface" ||
      !["none", "dhcpv6", "static"].includes(String(current.proto)) ||
      (current.device !== undefined &&
        ![
          bypass ? "@lan" : "@wan",
          String(snapshot.network[bypass ? "lan" : "wan"]?.device ?? ""),
        ].includes(String(current.device))))
  )
    throw new Error("IPv6 使用自定义接口或协议，当前页面不能覆盖该高级配置。");
  if (current && list(current.ip6addr).length > 1)
    throw new Error("当前 IPv6 使用多个静态地址，请通过 SSH 管理。");
  const [, lan] = lanDhcp(snapshot);
  if (snapshot.dhcp[relaySection] && snapshot.dhcp[relaySection][".type"] !== "dhcp")
    throw new Error("IPv6 中继配置名称已被占用，请检查高级配置。");
  for (const [section, value] of Object.entries(snapshot.dhcp)) {
    if (section !== relaySection && String(value.master ?? "0") === "1")
      throw new Error("检测到自定义 IPv6 中继主接口，需先检查高级配置。");
  }
  return {
    mode:
      !current || current.proto === "none" || String(current.auto ?? "1") === "0"
        ? "off"
        : !bypass && lan.ra === "relay"
          ? "relay"
          : current.proto === "static"
            ? "static"
            : "auto",
    prefixHint: ["48", "56", "60", "64"].includes(String(current?.reqprefix))
      ? String(current?.reqprefix)
      : "auto",
    autoDns: String(current?.peerdns ?? "1") !== "0",
    dns: list(current?.dns).join("\n"),
    address: list(current?.ip6addr)[0] ?? "",
    gateway: String(current?.ip6gw ?? ""),
    prefix: list(current?.ip6prefix)[0] ?? "",
    lan: !bypass && lan.ra !== "disabled" && (lan.ra === "server" || lan.ra === "relay"),
  };
}
export function ipv6Plan(
  snapshot: SettingsSnapshot,
  draft: Ipv6Draft,
  bypass: boolean,
): ConfigPlan {
  const initial = ipv6Draft(snapshot, bypass);
  if (JSON.stringify(initial) === JSON.stringify(draft))
    return { label: "IPv6 设置", edits: [], address: lanDraft(snapshot).address };
  if (!Object.hasOwn(ipv6Modes, draft.mode) || (bypass && draft.mode === "relay"))
    throw new Error("请选择支持的 IPv6 上网方式。");
  const edits: ConfigEdit[] = [],
    name = bypass ? "lan6" : "wan6",
    old = snapshot.network[name] ?? {};
  const values: Record<string, string | string[]> = {},
    remove: string[] = [];
  const set = (key: string, value: string | string[]) => {
    if (JSON.stringify(old[key]) !== JSON.stringify(value)) values[key] = value;
  };
  const clear = (key: string) => {
    if (old[key] !== undefined) remove.push(key);
  };
  set("proto", draft.mode === "off" ? "none" : draft.mode === "static" ? "static" : "dhcpv6");
  set("auto", draft.mode === "off" ? "0" : "1");
  set("device", bypass ? "@lan" : "@wan");
  set("delegate", bypass || draft.mode === "off" || draft.mode === "relay" ? "0" : "1");
  if (draft.mode === "auto" || draft.mode === "relay") {
    if (!["auto", "48", "56", "60", "64"].includes(draft.prefixHint))
      throw new Error("前缀请求长度只能是自动、48、56、60 或 64。");
    set("reqaddress", "try");
    set("reqprefix", bypass || draft.mode === "relay" ? "no" : draft.prefixHint);
  }
  if (draft.mode === "static") {
    if (!ipv6Cidr(draft.address) || !isIpv6Unicast(draft.gateway.trim()))
      throw new Error("请输入有效的 IPv6 地址/前缀长度及 IPv6 网关。");
    if (draft.prefix && (!ipv6Cidr(draft.prefix, true) || bypass))
      throw new Error("LAN 前缀需为网络边界对齐的 IPv6 前缀，长度为 /16 至 /64。");
    if (!bypass && draft.lan && !draft.prefix.trim())
      throw new Error("静态 IPv6 向 LAN 分配地址时，需填写运营商提供的 LAN 前缀。");
    set("ip6addr", [draft.address.trim()]);
    set("ip6gw", draft.gateway.trim());
    if (draft.prefix.trim()) set("ip6prefix", [draft.prefix.trim()]);
    else clear("ip6prefix");
  } else if (draft.mode !== "off") for (const key of ["ip6addr", "ip6gw", "ip6prefix"]) clear(key);
  if (draft.mode !== "off") {
    set("peerdns", draft.autoDns ? "1" : "0");
    if (draft.autoDns) clear("dns");
    else {
      const servers = [...new Set(draft.dns.split(/\s+/).filter(Boolean))];
      if (!servers.length || servers.length > 4 || servers.some((server) => !isIpv6Unicast(server)))
        throw new Error("请填写 1 至 4 个有效的 IPv6 DNS 地址。");
      set("dns", servers);
    }
  }
  if (Object.keys(values).length || remove.length)
    edits.push({
      config: "network",
      section: name,
      values,
      remove,
      ...(!snapshot.network[name] ? { add: "interface" } : {}),
    });
  if (!bypass && snapshot.network.wan?.proto === "pppoe") {
    const ipv6 = draft.mode === "off" ? "0" : "1";
    if (snapshot.network.wan.ipv6 !== ipv6)
      edits.push({ config: "network", section: "wan", values: { ipv6 } });
  }
  const [section, lan] = lanDhcp(snapshot);
  if (!bypass) {
    const enabled = draft.mode !== "off" && draft.lan,
      relay = enabled && draft.mode === "relay";
    const options: Record<string, string | string[]> = {
      ra: enabled ? (relay ? "relay" : "server") : "disabled",
      dhcpv6: enabled ? (relay ? "relay" : "server") : "disabled",
      ndp: relay ? "relay" : "disabled",
    };
    if (enabled && !relay) {
      options.ra_slaac = "1";
      options.ra_flags = ["managed-config", "other-config"];
    }
    const changed = Object.fromEntries(
      Object.entries(options).filter(
        ([key, value]) => JSON.stringify(lan[key]) !== JSON.stringify(value),
      ),
    );
    if (Object.keys(changed).length) edits.push({ config: "dhcp", section, values: changed });
    const rawLan = snapshot.network.lan,
      assign = enabled && !relay ? String(rawLan.ip6assign ?? "64") : null;
    if (assign ? rawLan.ip6assign !== assign : rawLan.ip6assign !== undefined)
      edits.push({
        config: "network",
        section: "lan",
        ...(assign ? { values: { ip6assign: assign } } : { remove: ["ip6assign"] }),
      });
    if (relay) {
      const prior = snapshot.dhcp[relaySection];
      const master = { interface: name, master: "1", ra: "relay", dhcpv6: "relay", ndp: "relay" };
      if (!prior || Object.entries(master).some(([key, value]) => prior[key] !== value))
        edits.push({
          config: "dhcp",
          section: relaySection,
          values: master,
          ...(!prior ? { add: "dhcp" } : {}),
        });
    } else if (snapshot.dhcp[relaySection])
      edits.push({ config: "dhcp", section: relaySection, deleteSection: true });
  }
  return {
    label: bypass ? "旁路由自身 IPv6" : "IPv6 设置",
    edits,
    address: lanDraft(snapshot).address,
  };
}
