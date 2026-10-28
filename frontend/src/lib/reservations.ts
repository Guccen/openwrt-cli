import { ipv4, subnet } from "./ipv4";
import { lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";

export interface Reservation {
  section: string;
  name: string;
  mac: string;
  ip: string;
  editable: boolean;
}
export function unicastMac(input: string) {
  return (
    /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(input) &&
    input.toLowerCase() !== "00:00:00:00:00:00" &&
    (parseInt(input.slice(0, 2), 16) & 1) === 0
  );
}
export function lanHost(snapshot: SettingsSnapshot, address: string) {
  const lan = lanDraft(snapshot),
    range = subnet(lan.address, lan.netmask),
    ip = ipv4(address);
  return ip !== null && ip > range.network && ip < range.broadcast && ip !== range.ip;
}
export function reservations(snapshot: SettingsSnapshot): Reservation[] {
  return Object.entries(snapshot.dhcp)
    .filter(([, s]) => s[".type"] === "host")
    .map(([section, s]) => ({
      section,
      name: String(s.name ?? ""),
      mac: Array.isArray(s.mac) ? s.mac.join(" ") : String(s.mac ?? ""),
      ip: String(s.ip ?? ""),
      editable:
        unicastMac(String(s.mac ?? "")) &&
        typeof s.mac === "string" &&
        typeof s.ip === "string" &&
        ipv4(s.ip) !== null &&
        Object.keys(s).every(
          (key) => key.startsWith(".") || ["name", "mac", "ip", "leasetime", "dns"].includes(key),
        ),
    }));
}
export function reservationPlan(
  snapshot: SettingsSnapshot,
  draft: Omit<Reservation, "editable">,
  remove = false,
): ConfigPlan {
  const old = reservations(snapshot).find((row) => row.section === draft.section);
  if (draft.section && (!old || !old.editable))
    throw new Error("此租约包含高级配置，请通过 SSH 管理。");
  const plan: ConfigPlan = {
    label: remove ? "删除地址保留" : "DHCP 地址保留",
    address: lanDraft(snapshot).address,
    edits: [],
  };
  if (remove) {
    if (!old) throw new Error("地址保留不存在。");
    plan.edits.push({ config: "dhcp", section: old.section, deleteSection: true });
    return plan;
  }
  const mac = draft.mac.trim().toLowerCase(),
    ip = draft.ip.trim(),
    name = draft.name.trim();
  if (!unicastMac(mac)) throw new Error("请输入有效的单播 MAC 地址，例如 02:11:22:33:44:55。");
  if (!lanHost(snapshot, ip))
    throw new Error("保留地址必须在 LAN 可用网段内，且不能是路由器地址。");
  if (name && !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(name))
    throw new Error("主机名需为 1 至 63 个字母、数字或连字符，首尾不能是连字符。");
  for (const [section, host] of Object.entries(snapshot.dhcp)) {
    if (section === old?.section || host[".type"] !== "host") continue;
    const macs = (Array.isArray(host.mac) ? host.mac : [String(host.mac ?? "")]).flatMap((value) =>
      value.toLowerCase().split(/\s+/),
    );
    if (
      macs.includes(mac) ||
      host.ip === ip ||
      (name && String(host.name ?? "").toLowerCase() === name.toLowerCase())
    )
      throw new Error("MAC、IP 地址或主机名已被其他保留记录使用。");
  }
  const section = old?.section ?? `router_ui_host_${mac.replaceAll(":", "")}`;
  if (!old && snapshot.dhcp[section]) throw new Error("配置名称已存在，请先检查现有记录。");
  const raw = snapshot.dhcp[section] ?? {},
    values: Record<string, string> = {};
  for (const [key, value] of Object.entries({ mac, ip, ...(name ? { name } : {}) }))
    if (raw[key] !== value) values[key] = value;
  const clear = !name && raw.name !== undefined ? ["name"] : [];
  if (Object.keys(values).length || clear.length)
    plan.edits.push({
      config: "dhcp",
      section,
      values,
      remove: clear,
      ...(!old ? { add: "host" } : {}),
    });
  return plan;
}
