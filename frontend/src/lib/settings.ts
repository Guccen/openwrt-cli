import type { NetworkInterface } from "./types";
import { ipv4, maskPrefix, poolRange } from "./ipv4";
export { ipv4, maskPrefix } from "./ipv4";

export type ConfigName = "network" | "dhcp" | "wireless";
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
}
export interface ConfigEdit {
  config: ConfigName;
  section: string;
  values?: Record<string, string | string[]>;
  remove?: string[];
}
export interface ConfigPlan {
  label: string;
  edits: ConfigEdit[];
  address: string;
}
export interface LanDraft {
  address: string;
  netmask: string;
  gateway: string;
}
export interface WifiDraft {
  section: string;
  device: string;
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
  if (
    !lan ||
    lan.proto !== "static" ||
    typeof lan.ipaddr !== "string" ||
    lan.ipaddr.includes("/")
  ) {
    throw new Error("当前 LAN 使用高级配置，请通过 SSH 管理，避免覆盖现有配置");
  }
  return {
    address: lan.ipaddr,
    netmask: String(lan.netmask ?? "255.255.255.0"),
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
  if (ip === network || ip === broadcast) throw new Error("LAN 地址不能是网络地址或广播地址");
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
        poolRange(address, netmask, Number(section.start ?? 100), Number(section.limit ?? 150));
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
  if (address !== old.address) values.ipaddr = address;
  if (netmask !== old.netmask) values.netmask = netmask;
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
  return {
    label: "LAN 设置",
    address,
    edits: Object.keys(values).length ? [{ config: "network", section: "lan", values }] : [],
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

export function wifiDrafts(snapshot: SettingsSnapshot): WifiDraft[] {
  return Object.entries(snapshot.wireless)
    .filter(([, section]) => section[".type"] === "wifi-iface")
    .map(([name, section]) => {
      const device = String(section.device ?? "");
      const encryption = String(section.encryption ?? "none");
      return {
        section: name,
        device,
        ssid: String(section.ssid ?? ""),
        encryption: ["psk2", "sae-mixed"].includes(encryption) ? encryption : "psk2",
        password: "",
        enabled: section.disabled !== "1" && snapshot.wireless[device]?.disabled !== "1",
        hidden: section.hidden === "1",
        hasPassword:
          ["psk2", "sae-mixed"].includes(encryption) &&
          typeof section.key === "string" &&
          section.key.length >= 8,
        editable: section.mode === "ap" && ["none", "psk2", "sae-mixed"].includes(encryption),
      };
    });
}

export function wifiPlan(snapshot: SettingsSnapshot, draft: WifiDraft): ConfigPlan {
  const old = wifiDrafts(snapshot).find((item) => item.section === draft.section);
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
