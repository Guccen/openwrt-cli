import { hasControl, lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";
import { lanHost } from "./reservations";
import { isIpv6Unicast } from "./ipv6-settings";

export interface Forwarding {
  section: string;
  name: string;
  protocol: string;
  external: string;
  address: string;
  internal: string;
  enabled: boolean;
  editable: boolean;
}

export interface DmzDraft {
  enabled: boolean;
  address: string;
}

export interface Ipv6Rule {
  section: string;
  name: string;
  protocol: string;
  address: string;
  port: string;
  enabled: boolean;
  editable: boolean;
}

export interface SecurityDraft {
  wanPing: boolean;
  remoteWebEnabled: boolean;
  remoteWebPort: string;
}

const keys = [
  "name",
  "src",
  "dest",
  "target",
  "family",
  "proto",
  "src_dport",
  "dest_ip",
  "dest_port",
  "enabled",
  "reflection",
];

const ipv6RuleKeys = [
  "name",
  "src",
  "dest",
  "target",
  "family",
  "proto",
  "dest_port",
  "dest_ip",
  "enabled",
];

function protocols(value: unknown) {
  return (Array.isArray(value) ? value : String(value ?? "tcp udp").split(/\s+/))
    .map(String)
    .sort()
    .join(" ");
}

export function forwardingRows(snapshot: SettingsSnapshot): Forwarding[] {
  return Object.entries(snapshot.firewall)
    .filter(
      ([section, s]) =>
        s[".type"] === "redirect" &&
        section !== "router_ui_dmz" &&
        section !== "router_ui_remote_web" &&
        s.name !== "DMZ" &&
        s.name !== "Router-Remote-Web",
    )
    .map(([section, s]) => ({
      section,
      name: String(s.name ?? section),
      protocol: protocols(s.proto),
      external: String(s.src_dport ?? ""),
      address: String(s.dest_ip ?? ""),
      internal: String(s.dest_port ?? ""),
      enabled: String(s.enabled ?? "1") !== "0",
      editable:
        s.src === "wan" &&
        s.dest === "lan" &&
        String(s.target ?? "DNAT") === "DNAT" &&
        ["ipv4", "any"].includes(String(s.family ?? "any")) &&
        ["tcp", "udp", "tcp udp"].includes(protocols(s.proto)) &&
        /^\d{1,5}$/.test(String(s.src_dport)) &&
        /^\d{1,5}$/.test(String(s.dest_port)) &&
        Object.keys(s).every((key) => key.startsWith(".") || keys.includes(key)),
    }));
}

export function dmzDraft(snapshot: SettingsSnapshot): DmzDraft {
  const dmz =
    snapshot.firewall.router_ui_dmz ??
    Object.values(snapshot.firewall).find(
      (s) =>
        s[".type"] === "redirect" &&
        s.name === "DMZ" &&
        s.src === "wan" &&
        s.dest === "lan" &&
        !s.src_dport,
    );
  if (!dmz) return { enabled: false, address: "" };
  return {
    enabled: String(dmz.enabled ?? "1") !== "0",
    address: String(dmz.dest_ip ?? ""),
  };
}

export function dmzPlan(snapshot: SettingsSnapshot, draft: DmzDraft): ConfigPlan {
  const current = dmzDraft(snapshot);
  const address = draft.address.trim();
  if (current.enabled === draft.enabled && current.address === address) {
    return { label: "DMZ 主机", edits: [], address: lanDraft(snapshot).address };
  }
  const plan: ConfigPlan = {
    label: "DMZ 主机",
    address: lanDraft(snapshot).address,
    edits: [],
  };
  const section = "router_ui_dmz";
  const exists = Boolean(snapshot.firewall[section]);

  if (!draft.enabled) {
    if (exists) {
      plan.edits.push({ config: "firewall", section, deleteSection: true });
    }
    return plan;
  }

  if (!lanHost(snapshot, address)) {
    throw new Error("DMZ 目标地址必须在 LAN 网段内，且不能是路由器地址。");
  }

  plan.edits.push({
    config: "firewall",
    section,
    values: {
      name: "DMZ",
      src: "wan",
      dest: "lan",
      target: "DNAT",
      proto: "all",
      dest_ip: address,
      enabled: "1",
    },
    ...(!exists ? { add: "redirect" } : {}),
  });
  return plan;
}

export function ipv6RuleRows(snapshot: SettingsSnapshot): Ipv6Rule[] {
  return Object.entries(snapshot.firewall)
    .filter(
      ([section, s]) =>
        s[".type"] === "rule" &&
        s.src === "wan" &&
        s.dest === "lan" &&
        s.family === "ipv6" &&
        String(s.target ?? "ACCEPT") === "ACCEPT" &&
        section !== "router_ui_ipv6_relay",
    )
    .map(([section, s]) => ({
      section,
      name: String(s.name ?? section),
      protocol: protocols(s.proto),
      address: String(s.dest_ip ?? ""),
      port: String(s.dest_port ?? ""),
      enabled: String(s.enabled ?? "1") !== "0",
      editable:
        ["tcp", "udp", "tcp udp"].includes(protocols(s.proto)) &&
        /^\d{1,5}$/.test(String(s.dest_port)) &&
        (!s.dest_ip || isIpv6Unicast(String(s.dest_ip))) &&
        Object.keys(s).every((key) => key.startsWith(".") || ipv6RuleKeys.includes(key)),
    }));
}

export function ipv6RulePlan(
  snapshot: SettingsSnapshot,
  draft: Ipv6Rule,
  remove = false,
): ConfigPlan {
  const old = ipv6RuleRows(snapshot).find((row) => row.section === draft.section);
  if (draft.section && (!old || !old.editable))
    throw new Error("此规则包含高级选项，请通过 SSH 管理。");
  const plan: ConfigPlan = {
    label: remove ? "删除 IPv6 放行" : "IPv6 端口放行",
    address: lanDraft(snapshot).address,
    edits: [],
  };
  if (remove) {
    if (!old) throw new Error("IPv6 规则不存在。");
    plan.edits.push({ config: "firewall", section: old.section, deleteSection: true });
    return plan;
  }
  const name = draft.name.trim(),
    port = draft.port.trim(),
    address = draft.address.trim();
  if (!name || new TextEncoder().encode(name).length > 64 || hasControl(name))
    throw new Error("规则名称需为 1 至 64 字节，不能包含控制字符。");
  if (!["tcp", "udp", "tcp udp"].includes(draft.protocol))
    throw new Error("请选择 TCP、UDP 或 TCP+UDP。");
  if (!/^[1-9]\d{0,4}$/.test(port) || +port > 65535)
    throw new Error("端口需为 1 至 65535 的整数。");
  if (address && !isIpv6Unicast(address)) throw new Error("目标 IPv6 地址无效，必须为单播地址。");

  let section = old?.section ?? "";
  if (!old) {
    let i = 1;
    while (snapshot.firewall[`router_ui_ipv6_rule_${i}`]) i++;
    section = `router_ui_ipv6_rule_${i}`;
  }
  const current = snapshot.firewall[section] ?? {},
    values: Record<string, string> = {};
  const targetValues: Record<string, string> = {
    name,
    src: "wan",
    dest: "lan",
    target: "ACCEPT",
    family: "ipv6",
    proto: draft.protocol,
    dest_port: port,
    enabled: draft.enabled ? "1" : "0",
  };
  if (address) targetValues.dest_ip = address;

  for (const [key, value] of Object.entries(targetValues)) {
    if (String(current[key] ?? "") !== value) values[key] = value;
  }
  const removes: string[] = [];
  if (!address && current.dest_ip) removes.push("dest_ip");

  if (Object.keys(values).length || removes.length) {
    plan.edits.push({
      config: "firewall",
      section,
      values,
      ...(removes.length ? { remove: removes } : {}),
      ...(!old ? { add: "rule" } : {}),
    });
  }
  return plan;
}

export function securityDraft(snapshot: SettingsSnapshot): SecurityDraft {
  const pingSection = Object.entries(snapshot.firewall).find(
    ([, s]) =>
      s[".type"] === "rule" &&
      (s.name === "Allow-Ping" ||
        (s.src === "wan" && s.proto === "icmp" && s.icmp_type === "echo-request")),
  );
  const wanPing = pingSection ? String(pingSection[1].enabled ?? "1") !== "0" : true;

  const webRedirect =
    snapshot.firewall.router_ui_remote_web ??
    Object.values(snapshot.firewall).find(
      (s) => s[".type"] === "redirect" && s.name === "Router-Remote-Web",
    );
  const remoteWebEnabled = Boolean(webRedirect && String(webRedirect.enabled ?? "1") !== "0");
  const remoteWebPort = String(webRedirect?.src_dport ?? "8443");

  return { wanPing, remoteWebEnabled, remoteWebPort };
}

export function securityPlan(snapshot: SettingsSnapshot, draft: SecurityDraft): ConfigPlan {
  const current = securityDraft(snapshot);
  const port = draft.remoteWebPort.trim();
  if (
    current.wanPing === draft.wanPing &&
    current.remoteWebEnabled === draft.remoteWebEnabled &&
    (!draft.remoteWebEnabled || current.remoteWebPort === port)
  ) {
    return { label: "安全与远程访问", address: lanDraft(snapshot).address, edits: [] };
  }
  const plan: ConfigPlan = {
    label: "安全与远程访问",
    address: lanDraft(snapshot).address,
    edits: [],
  };

  // WAN Ping
  const pingEntry = Object.entries(snapshot.firewall).find(
    ([, s]) =>
      s[".type"] === "rule" &&
      (s.name === "Allow-Ping" ||
        (s.src === "wan" && s.proto === "icmp" && s.icmp_type === "echo-request")),
  );
  if (pingEntry) {
    const [pingSection, rule] = pingEntry;
    const currentEnabled = String(rule.enabled ?? "1") !== "0";
    if (currentEnabled !== draft.wanPing) {
      plan.edits.push({
        config: "firewall",
        section: pingSection,
        values: { enabled: draft.wanPing ? "1" : "0" },
      });
    }
  } else if (!draft.wanPing) {
    plan.edits.push({
      config: "firewall",
      section: "Allow-Ping",
      values: {
        name: "Allow-Ping",
        src: "wan",
        proto: "icmp",
        icmp_type: "echo-request",
        family: "ipv4",
        target: "ACCEPT",
        enabled: "0",
      },
      add: "rule",
    });
  }

  // Remote Web Access
  const webSection = "router_ui_remote_web";
  const webRedirect = snapshot.firewall[webSection];
  if (draft.remoteWebEnabled) {
    const port = draft.remoteWebPort.trim();
    if (!/^[1-9]\d{0,4}$/.test(port) || +port > 65535) {
      throw new Error("远程访问端口需为 1 至 65535 的整数。");
    }
    for (const [sec, rule] of Object.entries(snapshot.firewall)) {
      if (
        sec === webSection ||
        sec === "router_ui_dmz" ||
        rule[".type"] !== "redirect" ||
        rule.src !== "wan" ||
        String(rule.enabled ?? "1") === "0"
      )
        continue;
      if (String(rule.src_dport) === port) {
        throw new Error("该远程访问端口与已有启用的端口转发冲突。");
      }
    }
    plan.edits.push({
      config: "firewall",
      section: webSection,
      values: {
        name: "Router-Remote-Web",
        src: "wan",
        dest: "lan",
        dest_ip: lanDraft(snapshot).address,
        src_dport: port,
        dest_port: "80",
        proto: "tcp",
        target: "DNAT",
        enabled: "1",
      },
      ...(!webRedirect ? { add: "redirect" } : {}),
    });
  } else if (webRedirect) {
    plan.edits.push({ config: "firewall", section: webSection, deleteSection: true });
  }

  return plan;
}
export function forwardingPlan(
  snapshot: SettingsSnapshot,
  draft: Forwarding,
  remove = false,
): ConfigPlan {
  const zones = Object.values(snapshot.firewall).filter((s) => s[".type"] === "zone");
  for (const name of ["wan", "lan"])
    if (zones.filter((s) => s.name === name).length !== 1)
      throw new Error("LAN/WAN 防火墙区域不唯一，请先检查高级配置。");
  const old = forwardingRows(snapshot).find((row) => row.section === draft.section);
  if (draft.section && (!old || !old.editable))
    throw new Error("此转发包含高级规则，请通过 SSH 管理。");
  const plan: ConfigPlan = {
    label: remove ? "删除端口转发" : "端口转发",
    address: lanDraft(snapshot).address,
    edits: [],
  };
  if (remove) {
    if (!old) throw new Error("端口转发不存在。");
    plan.edits.push({ config: "firewall", section: old.section, deleteSection: true });
    return plan;
  }
  const name = draft.name.trim(),
    external = draft.external.trim(),
    internal = draft.internal.trim(),
    address = draft.address.trim();
  if (!name || new TextEncoder().encode(name).length > 64 || hasControl(name))
    throw new Error("转发名称需为 1 至 64 字节，不能包含控制字符。");
  if (!["tcp", "udp", "tcp udp"].includes(draft.protocol))
    throw new Error("请选择 TCP、UDP 或 TCP+UDP。");
  if ([external, internal].some((port) => !/^[1-9]\d{0,4}$/.test(port) || +port > 65535))
    throw new Error("端口需为 1 至 65535 的整数。");
  if (!lanHost(snapshot, address))
    throw new Error("目标地址必须在 LAN 网段内，且不能是路由器地址。");
  if (draft.enabled)
    for (const [section, rule] of Object.entries(snapshot.firewall)) {
      if (
        section === old?.section ||
        rule[".type"] !== "redirect" ||
        rule.src !== "wan" ||
        String(rule.enabled ?? "1") === "0"
      )
        continue;
      const match = /^(\d+)(?:[:-](\d+))?$/.exec(String(rule.src_dport ?? "")),
        incoming = protocols(rule.proto).split(" ");
      if (
        match &&
        +external >= +match[1]! &&
        +external <= +(match[2] ?? match[1]!) &&
        (incoming.includes("all") || draft.protocol.split(" ").some((p) => incoming.includes(p)))
      )
        throw new Error("该外部端口与已有启用的转发冲突。");
    }
  let section = old?.section ?? "";
  if (!old) {
    let i = 1;
    while (snapshot.firewall[`router_ui_redirect_${i}`]) i++;
    section = `router_ui_redirect_${i}`;
  }
  const current = snapshot.firewall[section] ?? {},
    values: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    name,
    src: "wan",
    dest: "lan",
    target: "DNAT",
    family: "ipv4",
    proto: draft.protocol,
    src_dport: external,
    dest_ip: address,
    dest_port: internal,
    enabled: draft.enabled ? "1" : "0",
  }))
    if (String(current[key] ?? "") !== value) values[key] = value;
  if (Object.keys(values).length)
    plan.edits.push({ config: "firewall", section, values, ...(!old ? { add: "redirect" } : {}) });
  return plan;
}
