import { hasControl, lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";
import { lanHost } from "./reservations";
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
function protocols(value: unknown) {
  return (Array.isArray(value) ? value : String(value ?? "tcp udp").split(/\s+/))
    .map(String)
    .sort()
    .join(" ");
}
export function forwardingRows(snapshot: SettingsSnapshot): Forwarding[] {
  return Object.entries(snapshot.firewall)
    .filter(([, s]) => s[".type"] === "redirect")
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
