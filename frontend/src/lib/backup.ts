import {
  dnsSection,
  dnsServers,
  isDnsAddress,
  lanDraft,
  lanPlan,
  wifiDrafts,
  type ConfigEdit,
  type ConfigPlan,
  type LanDraft,
  type SettingsSnapshot,
} from "./settings";
import type { Device, NetworkInterface } from "./types";
import { dhcpDraft, dhcpPlan, dhcpSection, type DhcpDraft } from "./dhcp-settings";
import { ipv4, subnet } from "./ipv4";

export const BACKUP_LIMIT = 64 * 1024;
interface WifiBackup {
  section: string;
  device: string;
  ssid: string;
  enabled: boolean;
  hidden: boolean;
  encryption: "none" | "psk2" | "sae-mixed";
  key: string | null;
}
export interface NetworkBackup {
  format: "router-ui-network";
  version: 1 | 2;
  createdAt: string;
  device: Device["device"];
  role: Device["role"];
  revision: string;
  lan: LanDraft;
  dns: { servers: string[]; automatic: boolean };
  wireless: WifiBackup[];
  omittedWireless: string[];
  dhcp?: DhcpDraft | null;
}
export interface RestoreChange {
  label: string;
  before: string;
  after: string;
}
const encryptionLabel = (value: string) =>
  value === "psk2" ? "WPA2" : value === "sae-mixed" ? "WPA2/WPA3" : "未加密";

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}格式不正确`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key)))
    throw new Error(`${label}包含不支持的字段`);
  return record;
}
function text(value: unknown, max: number, label: string) {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > max ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(`${label}格式不正确`);
  return value;
}
function flag(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label}格式不正确`);
  return value;
}
function name(value: unknown) {
  const result = text(value, 64, "无线接口名称");
  if (!/^[a-zA-Z0-9_]+$/.test(result)) throw new Error("无线接口名称不正确");
  return result;
}
function readWifi(value: unknown): WifiBackup {
  const data = object(
    value,
    ["section", "device", "ssid", "enabled", "hidden", "encryption", "key"],
    "无线备份",
  );
  const section = name(data.section);
  const device = name(data.device);
  const ssid = text(data.ssid, 32, "WiFi 名称");
  const enabled = flag(data.enabled, "无线启用状态");
  const hidden = flag(data.hidden, "无线隐藏状态");
  const encryption = data.encryption;
  if (!ssid.trim() || !["none", "psk2", "sae-mixed"].includes(String(encryption)))
    throw new Error("备份中的无线名称或加密方式不受支持");
  const cipher = encryption as WifiBackup["encryption"];
  const key = data.key === null ? null : text(data.key, 64, "WiFi 密钥");
  if (key !== null) {
    const bytes = new TextEncoder().encode(key).length;
    if (
      cipher === "none" ||
      !((bytes >= 8 && bytes <= 63) || (cipher === "psk2" && /^[a-f\d]{64}$/i.test(key)))
    )
      throw new Error("备份中的 WiFi 密钥不正确");
  }
  if (enabled && (cipher === "none" || key === null))
    throw new Error("备份不能启用无密码的无线网络");
  return { section, device, ssid, enabled, hidden, encryption: cipher, key };
}

export function parseBackup(input: string, target: Device): NetworkBackup {
  if (new TextEncoder().encode(input).length > BACKUP_LIMIT)
    throw new Error("备份文件不能超过 64 KiB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.trim());
  } catch {
    throw new Error("请选择有效的 JSON 备份文件");
  }
  const data = object(
    parsed,
    [
      "format",
      "version",
      "createdAt",
      "device",
      "role",
      "revision",
      "lan",
      "dns",
      "wireless",
      "omittedWireless",
      "dhcp",
    ],
    "备份",
  );
  if (data.format !== "router-ui-network" || ![1, 2].includes(data.version as number))
    throw new Error("不支持此备份格式或版本");
  if (data.version === 1 && Object.hasOwn(data, "dhcp"))
    throw new Error("旧版备份不能包含 DHCP 字段");
  if (data.device !== target.device || data.role !== target.role)
    throw new Error("备份的设备型号和主/旁路由模式必须与当前设备一致");
  const createdAt = text(data.createdAt, 64, "备份时间");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("备份时间不正确");
  const revision = text(data.revision, 80, "源码版本");
  const lan = object(data.lan, ["address", "netmask", "gateway"], "LAN 备份");
  const dns = object(data.dns, ["servers", "automatic"], "DNS 备份");
  if (
    !Array.isArray(dns.servers) ||
    dns.servers.length > 4 ||
    dns.servers.some((server) => typeof server !== "string" || !isDnsAddress(server))
  )
    throw new Error("DNS 备份需包含最多 4 个有效 IP 地址");
  const servers = [...new Set(dns.servers)] as string[];
  const automatic = flag(dns.automatic, "自动 DNS 状态");
  if (!automatic && !servers.length) throw new Error("备份需启用自动 DNS 或指定上游服务器");
  if (
    !Array.isArray(data.wireless) ||
    data.wireless.length > 16 ||
    !Array.isArray(data.omittedWireless) ||
    data.omittedWireless.length > 16
  )
    throw new Error("备份中的无线接口数量不正确");
  const wireless = data.wireless.map(readWifi);
  if (target.device === "phicomm-n1" && wireless.some((wifi) => wifi.encryption === "sae-mixed"))
    throw new Error("N1 无线备份仅支持 WPA2 个人版。");
  if (new Set(wireless.map((radio) => radio.section)).size !== wireless.length)
    throw new Error("备份包含重复的无线接口");
  let dhcp: DhcpDraft | null = null;
  if (data.version === 2) {
    if (target.role === "bypass") {
      if (data.dhcp !== null) throw new Error("旁路由备份不能包含 DHCP 服务配置");
    } else {
      const value = object(data.dhcp, ["enabled", "start", "end", "lease"], "DHCP 备份");
      dhcp = {
        enabled: flag(value.enabled, "DHCP 启用状态"),
        start: text(value.start, 15, "DHCP 起始地址"),
        end: text(value.end, 15, "DHCP 结束地址"),
        lease: text(value.lease, 16, "DHCP 租期"),
      };
    }
  }
  return {
    format: "router-ui-network",
    version: data.version as 1 | 2,
    createdAt,
    device: target.device,
    role: target.role,
    revision,
    lan: {
      address: text(lan.address, 15, "LAN 地址"),
      netmask: text(lan.netmask, 15, "子网掩码"),
      gateway: text(lan.gateway, 15, "网关"),
    },
    dns: { servers, automatic },
    wireless,
    omittedWireless: data.omittedWireless.map(name),
    ...(data.version === 2 ? { dhcp } : {}),
  };
}

export function createBackup(snapshot: SettingsSnapshot, device: Device): NetworkBackup {
  const omittedWireless: string[] = [];
  const wireless: WifiBackup[] = [];
  {
    for (const draft of wifiDrafts(snapshot)) {
      const section = snapshot.wireless[draft.section];
      try {
        if (!draft.editable) throw new Error("高级无线接口");
        wireless.push(
          readWifi({
            section: draft.section,
            device: draft.device,
            ssid: draft.ssid,
            enabled: draft.enabled,
            hidden: draft.hidden,
            encryption: section.encryption ?? "none",
            key: section.encryption === "none" || !section.key ? null : section.key,
          }),
        );
      } catch {
        omittedWireless.push(draft.section);
      }
    }
  }
  const backup = parseBackup(
    JSON.stringify({
      format: "router-ui-network",
      version: 2,
      createdAt: new Date().toISOString(),
      device: device.device,
      role: device.role,
      revision: device.revision,
      lan: lanDraft(snapshot),
      dns: {
        servers: dnsServers(snapshot),
        automatic: String(dnsSection(snapshot)[1].noresolv ?? "0") !== "1",
      },
      wireless,
      omittedWireless,
      dhcp: device.role === "router" ? dhcpDraft(snapshot) : null,
    }),
    device,
  );
  restoreBackup(snapshot, backup, device, []);
  return backup;
}

export function restoreBackup(
  snapshot: SettingsSnapshot,
  input: NetworkBackup,
  device: Device,
  interfaces: NetworkInterface[],
) {
  // 再次校验，不能通过直接构造对象绕过文件校验。
  const backup = parseBackup(JSON.stringify(input), device);
  let dhcp: ConfigPlan | null = null;
  let validationSnapshot = snapshot;
  if (backup.dhcp) {
    const previousDhcp = dhcpDraft(snapshot);
    const projected = {
      ...snapshot,
      network: {
        ...snapshot.network,
        lan: { ...snapshot.network.lan, ipaddr: backup.lan.address, netmask: backup.lan.netmask },
      },
    };
    dhcp = dhcpPlan(projected, backup.dhcp, device.role === "bypass", previousDhcp);
    // 地址池相对目标 LAN 子网计算，与 LAN 改址在同一个回滚事务中恢复。
    const [section] = dhcpSection(snapshot);
    const start = ipv4(backup.dhcp.start);
    const end = ipv4(backup.dhcp.end);
    const targetNetwork = subnet(backup.lan.address, backup.lan.netmask).network;
    validationSnapshot = {
      ...snapshot,
      dhcp: {
        ...snapshot.dhcp,
        [section]: {
          ...snapshot.dhcp[section],
          ...(dhcp.edits.find((edit) => edit.config === "dhcp" && edit.section === section)?.values ?? {}),
          start: String((start ?? targetNetwork) - targetNetwork),
          ...(start !== null && end !== null ? { limit: String(end - start + 1) } : {}),
        },
      },
    };
  }
  const lan = lanPlan(validationSnapshot, backup.lan, device.role === "bypass", interfaces);
  const edits: ConfigEdit[] = [...lan.edits, ...(dhcp?.edits ?? [])];
  const changes: RestoreChange[] = [];
  if (dhcp?.edits.length && backup.dhcp) {
    const old = dhcpDraft(snapshot);
    changes.push({
      label: "DHCP 地址分配",
      before: `${old.enabled ? "开启" : "关闭"} · ${old.start} — ${old.end} · ${old.lease}`,
      after: `${backup.dhcp.enabled ? "开启" : "关闭"} · ${backup.dhcp.start} — ${backup.dhcp.end} · ${backup.dhcp.lease}`,
    });
  }
  if (lan.edits.length)
    changes.push({
      label: "LAN",
      before: `${lanDraft(snapshot).address} / ${lanDraft(snapshot).netmask}${device.role === "bypass" ? ` · 网关 ${lanDraft(snapshot).gateway}` : ""}`,
      after: `${backup.lan.address} / ${backup.lan.netmask}${device.role === "bypass" ? ` · 网关 ${backup.lan.gateway}` : ""}`,
    });
  const [section, currentDns] = dnsSection(snapshot);
  const servers = dnsServers(snapshot);
  const automatic = String(currentDns.noresolv ?? "0") !== "1";
  if (
    JSON.stringify(servers) !== JSON.stringify(backup.dns.servers) ||
    automatic !== backup.dns.automatic
  ) {
    edits.push({
      config: "dhcp",
      section,
      values: {
        noresolv: backup.dns.automatic ? "0" : "1",
        ...(backup.dns.servers.length ? { server: backup.dns.servers } : {}),
      },
      remove: !backup.dns.servers.length && servers.length ? ["server"] : [],
    });
    changes.push({
      label: "上游 DNS",
      before: `${automatic ? "自动 " : ""}${servers.join("、")}`,
      after: `${backup.dns.automatic ? "自动 " : ""}${backup.dns.servers.join("、")}`,
    });
  }
  const currentWifi = wifiDrafts(snapshot);
  for (const wifi of backup.wireless) {
    const current = currentWifi.find((draft) => draft.section === wifi.section);
    if (!current?.editable || current.device !== wifi.device || !snapshot.wireless[wifi.device])
      throw new Error(`无线接口 ${wifi.section} 已变化，请核对设备配置后再恢复`);
    const raw = snapshot.wireless[wifi.section];
    const values: Record<string, string> = {};
    if (wifi.ssid !== current.ssid) values.ssid = wifi.ssid;
    if (wifi.encryption !== String(raw.encryption ?? "none")) values.encryption = wifi.encryption;
    if (wifi.enabled !== current.enabled) values.disabled = wifi.enabled ? "0" : "1";
    if (wifi.hidden !== current.hidden) values.hidden = wifi.hidden ? "1" : "0";
    const keyChanged = wifi.key !== (typeof raw.key === "string" ? raw.key : null);
    if (keyChanged && wifi.key !== null) values.key = wifi.key;
    const remove = keyChanged && wifi.key === null && raw.key !== undefined ? ["key"] : [];
    if (Object.keys(values).length || remove.length) {
      edits.push({ config: "wireless", section: wifi.section, values, remove });
      changes.push({
        label: `无线 ${wifi.section}`,
        before: `${current.ssid} · ${current.enabled ? "开启" : "关闭"} · ${encryptionLabel(String(raw.encryption ?? "none"))} · ${current.hidden ? "隐藏" : "可见"}`,
        after: `${wifi.ssid} · ${wifi.enabled ? "开启" : "关闭"} · ${encryptionLabel(wifi.encryption)} · ${wifi.hidden ? "隐藏" : "可见"}${keyChanged ? " · 密钥更新" : ""}`,
      });
    }
    if (
      wifi.enabled &&
      snapshot.wireless[wifi.device].disabled === "1" &&
      !edits.some((edit) => edit.config === "wireless" && edit.section === wifi.device)
    )
      edits.push({ config: "wireless", section: wifi.device, values: { disabled: "0" } });
  }
  const plan: ConfigPlan = { label: "网络设置恢复", address: backup.lan.address, edits };
  return { plan, changes };
}
