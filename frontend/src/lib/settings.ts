import type { NetworkInterface } from "./types";
import { ipv4, ipv4Text, maskPrefix, poolRange, poolStartOffset, subnet } from "./ipv4";
import { wifiBand, type WifiBand } from "./wifi-band";
export { ipv4, maskPrefix } from "./ipv4";

export type ConfigName = "network" | "dhcp" | "wireless" | "firewall";
export type UciSection = Record<string, string | string[] | number | boolean>;
export type UciSections = Record<string, UciSection>;
export function hasControl(value: string) {
  return Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}
export interface SettingsSnapshot {
  network: UciSections;
  dhcp: UciSections;
  wireless: UciSections;
  firewall: UciSections;
}
export interface ConfigEdit {
  config: ConfigName;
  section: string;
  values?: Record<string, string | string[]>;
  remove?: string[];
  add?: string;
  deleteSection?: boolean;
}
export interface ConfigPlan {
  label: string;
  edits: ConfigEdit[];
  address: string;
  details?: string[];
}
export interface LanDraft {
  address: string;
  netmask: string;
  gateway: string;
}
export interface WifiDraft {
  section: string;
  device: string;
  band: WifiBand;
  enabled: boolean;
  ssid: string;
  encryption: string;
  password: string;
  hidden: boolean;
  hasPassword: boolean;
  editable: boolean;
}

export function isDnsAddress(value: string) {
  if (ipv4(value) !== null) return true;
  if (!value.includes(":") || !/^[a-f\d:.]+$/i.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.startsWith("[");
  } catch {
    return false;
  }
}

export function lanDraft(snapshot: SettingsSnapshot): LanDraft {
  const lan = snapshot.network.lan;
  if (!lan || lan.proto !== "static" || typeof lan.ipaddr !== "string") {
    throw new Error("当前 LAN 使用高级配置，请通过 SSH 管理，避免覆盖现有配置");
  }
  let address = lan.ipaddr;
  let netmask = String(lan.netmask ?? "255.255.255.0");
  if (lan.ipaddr.includes("/")) {
    const cidr = /^([^/]+)\/(\d{1,2})$/.exec(lan.ipaddr);
    const prefix = Number(cidr?.[2]);
    if (
      !cidr ||
      ipv4(cidr[1]) === null ||
      prefix < 8 ||
      prefix > 30 ||
      (lan.netmask !== undefined &&
        (typeof lan.netmask !== "string" || maskPrefix(lan.netmask) !== prefix))
    ) {
      throw new Error("当前 LAN 使用高级配置，请通过 SSH 管理，避免覆盖现有配置");
    }
    address = cidr[1];
    netmask = ipv4Text((0xffffffff << (32 - prefix)) >>> 0);
  }
  return {
    address,
    netmask,
    gateway: String(lan.gateway ?? ""),
  };
}

export function lanPlan(
  snapshot: SettingsSnapshot,
  draft: LanDraft,
  bypass: boolean,
  interfaces: NetworkInterface[],
): ConfigPlan {
  const old = lanDraft(snapshot);
  const address = draft.address.trim();
  const netmask = draft.netmask.trim();
  const gateway = draft.gateway.trim();
  const ip = ipv4(address);
  const mask = ipv4(netmask);
  const prefix = maskPrefix(netmask);
  if (ip === null || ip >>> 24 === 0 || ip >>> 24 === 127 || ip >>> 24 >= 224)
    throw new Error("请输入有效的 LAN IPv4 地址");
  if (mask === null || prefix === null || prefix < 8 || prefix > 30)
    throw new Error("子网掩码需在 /8 至 /30 之间");
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  const oldBounds = subnet(old.address, old.netmask);
  const networkChanged = address !== old.address || netmask !== old.netmask;
  if (ip === network || ip === broadcast) throw new Error("LAN 地址不能是网络地址或广播地址");
  for (const section of Object.values(snapshot.dhcp)) {
    if (section[".type"] !== "host" || typeof section.ip !== "string") continue;
    const reserved = ipv4(section.ip);
    if (reserved !== null && (reserved <= network || reserved >= broadcast || reserved === ip))
      throw new Error("新的 LAN 网段与已有 DHCP 地址保留冲突，请先调整保留记录。");
  }
  for (const section of Object.values(snapshot.firewall)) {
    if (
      section[".type"] !== "redirect" ||
      section.dest !== "lan" ||
      typeof section.dest_ip !== "string"
    )
      continue;
    const target = ipv4(section.dest_ip);
    if (target !== null && (target <= network || target >= broadcast || target === ip))
      throw new Error("新的 LAN 网段与已有端口转发目标冲突，请先调整转发规则。");
  }
  const dhcpEdits: ConfigPlan["edits"] = [];
  const details: string[] = [];
  if (!bypass) {
    for (const [name, section] of Object.entries(snapshot.dhcp)) {
      if (
        section[".type"] !== "dhcp" ||
        (section.interface !== "lan" && name !== "lan") ||
        String(section.ignore ?? "0") === "1" ||
        section.dhcpv4 === "disabled"
      )
        continue;
      try {
        const startOffset = poolStartOffset(section.start, oldBounds.network);
        const count = Number(section.limit ?? 150);
        const absoluteStart = typeof section.start === "string" ? ipv4(section.start) : null;
        let targetOffset = startOffset;
        if (absoluteStart !== null && (absoluteStart <= network || absoluteStart >= broadcast)) {
          poolRange(address, netmask, startOffset, count);
          const shiftedStart = ipv4Text(network + startOffset);
          dhcpEdits.push({ config: "dhcp", section: name, values: { start: shiftedStart } });
          details.push(
            `LAN 网段变更时，DHCP 地址池起始地址将从 ${ipv4Text(absoluteStart)} 调整为 ${shiftedStart}，地址数量保持 ${count} 个。`,
          );
        } else if (absoluteStart !== null) {
          targetOffset = absoluteStart - network;
        }
        poolRange(address, netmask, targetOffset, count);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : "地址池不正确"}；请先调整 DHCP 地址池，再修改 LAN。`,
        );
      }
    }
  }
  const wanAddresses = interfaces
    .filter((item) => item.interface === "wan")
    .flatMap((item) => item["ipv4-address"] ?? []);
  const configuredWan = snapshot.network.wan;
  if (
    configuredWan?.proto === "static" &&
    typeof configuredWan.ipaddr === "string" &&
    typeof configuredWan.netmask === "string"
  ) {
    const configuredPrefix = maskPrefix(configuredWan.netmask);
    if (configuredPrefix !== null)
      wanAddresses.push({ address: configuredWan.ipaddr, mask: configuredPrefix });
  }
  for (const wan of wanAddresses) {
    const wanIp = ipv4(wan.address);
    if (wanIp === null) continue;
    const commonMask = (0xffffffff << (32 - Math.min(prefix, wan.mask))) >>> 0;
    if ((ip & commonMask) >>> 0 === (wanIp & commonMask) >>> 0)
      throw new Error("LAN 与 WAN 网段重叠，请选择其他网段");
  }
  if (bypass) {
    const gw = ipv4(gateway);
    if (
      gw === null ||
      gw === ip ||
      gw === network ||
      gw === broadcast ||
      (gw & mask) >>> 0 !== network
    )
      throw new Error("旁路由网关需是同网段中另一台路由器的有效地址");
  }
  const values: Record<string, string | string[]> = {};
  const currentAddress = snapshot.network.lan.ipaddr;
  if (typeof currentAddress === "string" && currentAddress.includes("/") && networkChanged) {
    values.ipaddr = address;
    values.netmask = netmask;
  } else {
    if (address !== old.address) values.ipaddr = address;
    if (netmask !== old.netmask) values.netmask = netmask;
  }
  if (bypass && gateway !== old.gateway) values.gateway = gateway;
  const oldDns = snapshot.network.lan.dns;
  if (
    bypass &&
    gateway !== old.gateway &&
    (oldDns === old.gateway ||
      (Array.isArray(oldDns) && oldDns.length === 1 && oldDns[0] === old.gateway))
  ) {
    values.dns = [gateway];
  }
  const edits = [...dhcpEdits];
  if (Object.keys(values).length) edits.push({ config: "network", section: "lan", values });
  return {
    label: "LAN 设置",
    address,
    edits,
    ...(details.length ? { details } : {}),
  };
}

export function dnsSection(snapshot: SettingsSnapshot) {
  const entry = Object.entries(snapshot.dhcp).find(([, value]) => value[".type"] === "dnsmasq");
  if (!entry) throw new Error("未找到 DNS 服务配置");
  return entry;
}

export function dnsServers(snapshot: SettingsSnapshot): string[] {
  const server = dnsSection(snapshot)[1].server;
  return Array.isArray(server) ? server : typeof server === "string" ? [server] : [];
}

export function dnsPlan(snapshot: SettingsSnapshot, input: string): ConfigPlan {
  const [section, current] = dnsSection(snapshot);
  const servers = [...new Set(input.split(/\s+/).filter(Boolean))];
  if (servers.length > 4 || servers.some((server) => !isDnsAddress(server)))
    throw new Error("最多填写 4 个有效的 IPv4 或 IPv6 DNS 地址，每行一个");
  const old = dnsServers(snapshot);
  const noresolv = servers.length ? "1" : "0";
  const same =
    JSON.stringify(servers) === JSON.stringify(old) && String(current.noresolv ?? "0") === noresolv;
  return {
    label: "DNS 设置",
    address: lanDraft(snapshot).address,
    edits: same
      ? []
      : [
          {
            config: "dhcp",
            section,
            values: servers.length ? { server: servers, noresolv } : { noresolv },
            remove: !servers.length && old.length ? ["server"] : [],
          },
        ],
  };
}

export function wifiDrafts(snapshot: SettingsSnapshot, allowStation = false): WifiDraft[] {
  return Object.entries(snapshot.wireless)
    .filter(([, section]) => section[".type"] === "wifi-iface")
    .map(([name, section]) => {
      const device = String(section.device ?? "");
      const encryption = String(section.encryption ?? "none");
      return {
        section: name,
        device,
        band: wifiBand(snapshot.wireless[device] ?? {}),
        ssid: String(section.ssid ?? ""),
        encryption: ["psk2", "sae-mixed"].includes(encryption) ? encryption : "psk2",
        password: "",
        enabled: section.disabled !== "1" && snapshot.wireless[device]?.disabled !== "1",
        hidden: section.hidden === "1",
        hasPassword:
          ["psk2", "sae-mixed"].includes(encryption) &&
          typeof section.key === "string" &&
          section.key.length >= 8,
        editable:
          (section.mode === "ap" || (allowStation && section.mode === "sta")) &&
          ["none", "psk2", "sae-mixed"].includes(encryption),
      };
    });
}

export function wifiPlan(
  snapshot: SettingsSnapshot,
  draft: WifiDraft,
  allowStation = false,
): ConfigPlan {
  const old = wifiDrafts(snapshot, allowStation).find((item) => item.section === draft.section);
  if (!old || !old.editable || draft.device !== old.device || !snapshot.wireless[old.device])
    throw new Error("此无线接口使用高级配置，请通过 SSH 管理");
  if (
    !draft.ssid.trim() ||
    new TextEncoder().encode(draft.ssid).length > 32 ||
    hasControl(draft.ssid)
  )
    throw new Error("WiFi 名称需为 1 至 32 字节，不能包含控制字符");
  if (!["psk2", "sae-mixed"].includes(draft.encryption))
    throw new Error("请选择支持的 WiFi 加密方式");
  const length = new TextEncoder().encode(draft.password).length;
  if ((draft.password && (length < 8 || length > 63)) || hasControl(draft.password))
    throw new Error("WiFi 密码需为 8 至 63 字节，不能包含控制字符");
  if (draft.enabled && !draft.password && !old.hasPassword)
    throw new Error("首次启用 WiFi 请设置密码");
  const values: Record<string, string> = {};
  if (draft.ssid !== old.ssid) values.ssid = draft.ssid;
  if (draft.encryption !== old.encryption || (draft.enabled && !old.hasPassword))
    values.encryption = draft.encryption;
  if (draft.password) values.key = draft.password;
  if (draft.enabled !== old.enabled) values.disabled = draft.enabled ? "0" : "1";
  if (draft.hidden !== old.hidden) values.hidden = draft.hidden ? "1" : "0";
  const edits: ConfigEdit[] = Object.keys(values).length
    ? [{ config: "wireless", section: draft.section, values }]
    : [];
  if (draft.enabled && snapshot.wireless[old.device].disabled === "1")
    edits.push({ config: "wireless", section: old.device, values: { disabled: "0" } });
  return { label: "无线设置", address: lanDraft(snapshot).address, edits };
}

export function managementOrigin(address: string, current: string) {
  if (ipv4(address) === null) throw new Error("管理地址无效");
  const url = new URL(current);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("管理页面协议无效");
  // Vite 开发代理保持同一来源，正式设备使用新 IP 地址。
  if (["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
  url.hostname = address;
  return url.origin;
}
