import { lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";
import { unicastMac } from "./reservations";

function wanDevice(snapshot: SettingsSnapshot) {
  const wan = snapshot.network.wan,
    device = String(wan?.device ?? "");
  if (
    !wan ||
    !/^[a-z\d_.-]{1,15}$/i.test(device) ||
    device === snapshot.network.lan.device ||
    wan.macaddr !== undefined
  )
    throw new Error("WAN 使用共享、旧式或高级设备配置，请通过 SSH 管理链路参数。");
  const entries = Object.entries(snapshot.network).filter(
    ([, s]) => s[".type"] === "device" && s.name === device,
  );
  if (
    entries.length > 1 ||
    entries.some(([, s]) => s.type !== undefined && !["8021q", "8021ad"].includes(String(s.type)))
  )
    throw new Error("WAN 设备定义不唯一或使用桥接，请通过 SSH 管理链路参数。");
  return { wan, device, entry: entries[0] };
}
export function wanLinkDraft(snapshot: SettingsSnapshot) {
  const { wan, entry } = wanDevice(snapshot);
  const raw = wan.proto === "pppoe" || wan.mtu !== undefined ? wan : entry?.[1];
  return { mtu: String(raw?.mtu ?? ""), mac: String(entry?.[1].macaddr ?? "") };
}
export function wanLinkPlan(
  snapshot: SettingsSnapshot,
  draft: ReturnType<typeof wanLinkDraft>,
): ConfigPlan {
  const { wan, device, entry } = wanDevice(snapshot),
    old = wanLinkDraft(snapshot);
  const mtu = draft.mtu.trim(),
    mac = draft.mac.trim().toLowerCase();
  const ipv6 = snapshot.network.wan6;
  const minimum = ipv6 && ipv6.proto !== "none" && ipv6.auto !== "0" ? 1280 : 576;
  if (mtu && (!/^\d{3,4}$/.test(mtu) || +mtu < minimum || +mtu > 1500))
    throw new Error(`MTU 需为 ${minimum} 至 1500，留空恢复默认。PPPoE 通常使用 1492。`);
  if (mac && !unicastMac(mac)) throw new Error("WAN MAC 必须是有效的单播地址。");
  const plan: ConfigPlan = {
    label: "WAN 链路参数",
    address: lanDraft(snapshot).address,
    edits: [],
  };
  const values: Record<string, string> = {},
    remove: string[] = [];
  if (mac !== old.mac.toLowerCase()) {
    if (mac) values.macaddr = mac;
    else remove.push("macaddr");
  }
  if (mtu !== old.mtu) {
    const edit = { ...(mtu ? { values: { mtu } } : { remove: ["mtu"] }) };
    if (wan.proto === "pppoe" || wan.mtu !== undefined)
      plan.edits.push({ config: "network", section: "wan", ...edit });
    else {
      if (mtu) values.mtu = mtu;
      else remove.push("mtu");
    }
  }
  if (Object.keys(values).length || remove.length) {
    const section = entry?.[0] ?? "router_ui_wan_device";
    if (!entry && snapshot.network[section])
      throw new Error("WAN 设备配置名称已被占用，请检查高级配置。");
    plan.edits.push({
      config: "network",
      section,
      values: { ...(!entry ? { name: device } : {}), ...values },
      remove,
      ...(!entry ? { add: "device" } : {}),
    });
  }
  return plan;
}
