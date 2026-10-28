import {
  isDnsAddress,
  hasControl as control,
  lanDraft,
  type ConfigEdit,
  type ConfigPlan,
  type SettingsSnapshot,
} from "./settings";
import { ipv4, subnet } from "./ipv4";

export type WanProtocol = "dhcp" | "static" | "pppoe";
export interface WanDraft {
  protocol: WanProtocol;
  address: string;
  netmask: string;
  gateway: string;
  username: string;
  password: string;
  hasPassword: boolean;
  autoDns: boolean;
  dns: string;
}
export const wanProtocolNames: Record<WanProtocol, string> = {
  dhcp: "自动获取（DHCP）",
  static: "静态 IPv4",
  pppoe: "宽带拨号（PPPoE）",
};
export function wanDraft(snapshot: SettingsSnapshot): WanDraft {
  const wan = snapshot.network.wan;
  if (!wan || !["dhcp", "static", "pppoe"].includes(String(wan.proto)))
    throw new Error("当前 WAN 不存在或使用高级协议，请通过 SSH 管理。");
  if (
    [wan.ipaddr, wan.netmask, wan.gateway, wan.username, wan.password].some(
      (value) => value !== undefined && typeof value !== "string",
    )
  )
    throw new Error("当前 WAN 使用多地址或高级配置，请通过 SSH 管理。");
  return {
    protocol: wan.proto as WanProtocol,
    address: String(wan.ipaddr ?? ""),
    netmask: String(wan.netmask ?? "255.255.255.0"),
    gateway: String(wan.gateway ?? ""),
    username: String(wan.username ?? ""),
    password: "",
    hasPassword:
      wan.proto === "pppoe" && typeof wan.password === "string" && wan.password.length > 0,
    autoDns: wan.proto !== "static" && String(wan.peerdns ?? "1") !== "0",
    dns: (Array.isArray(wan.dns) ? wan.dns : typeof wan.dns === "string" ? [wan.dns] : []).join(
      "\n",
    ),
  };
}
export function wanPlan(snapshot: SettingsSnapshot, draft: WanDraft, bypass: boolean): ConfigPlan {
  if (bypass) throw new Error("旁路由通过 LAN 网关上网，不开放独立 WAN 配置。");
  const old = wanDraft(snapshot),
    raw = snapshot.network.wan;
  if (!Object.hasOwn(wanProtocolNames, draft.protocol))
    throw new Error("请选择支持的 WAN 上网方式");
  const values: Record<string, string | string[]> = {};
  const remove = new Set<string>();
  const set = (key: string, value: string | string[]) => {
    if (JSON.stringify(raw[key]) !== JSON.stringify(value)) values[key] = value;
  };
  const clear = (key: string) => {
    if (raw[key] !== undefined) remove.add(key);
  };
  const changedProtocol = old.protocol !== draft.protocol;
  if (changedProtocol) set("proto", draft.protocol);
  if (draft.protocol === "static") {
    const address = draft.address.trim(),
      netmask = draft.netmask.trim(),
      gateway = draft.gateway.trim();
    const wan = subnet(address, netmask),
      lan = subnet(lanDraft(snapshot).address, lanDraft(snapshot).netmask);
    if (wan.network <= lan.broadcast && lan.network <= wan.broadcast)
      throw new Error("WAN 与 LAN 网段重叠，请选择其他网段");
    const gw = ipv4(gateway);
    if (
      gw === null ||
      gw >>> 24 === 0 ||
      gw >>> 24 === 127 ||
      gw >>> 24 >= 224 ||
      gw === wan.ip ||
      gw <= wan.network ||
      gw >= wan.broadcast
    )
      throw new Error("WAN 网关需是同网段内另一台路由器的有效地址");
    set("ipaddr", address);
    set("netmask", netmask);
    set("gateway", gateway);
  } else if (changedProtocol) for (const key of ["ipaddr", "netmask", "gateway"]) clear(key);
  if (draft.protocol === "pppoe") {
    const username = draft.username.trim();
    if (!username || new TextEncoder().encode(username).length > 128 || control(username))
      throw new Error("宽带账号需为 1 至 128 字节，不能包含控制字符");
    if (!draft.password && !old.hasPassword) throw new Error("首次使用 PPPoE 请填写宽带密码");
    if (new TextEncoder().encode(draft.password).length > 128 || control(draft.password))
      throw new Error("宽带密码不能超过 128 字节或包含控制字符");
    set("username", username);
    if (draft.password) set("password", draft.password);
    // 已有独立 wan6 时仅启用 PPP IPv6 链路，避免再创建一份自动 DHCPv6 接口。
    if (changedProtocol && raw.ipv6 === undefined)
      set(
        "ipv6",
        snapshot.network.wan6
          ? snapshot.network.wan6.proto === "none" || snapshot.network.wan6.auto === "0"
            ? "0"
            : "1"
          : "auto",
      );
  } else if (changedProtocol)
    for (const key of ["username", "password", ...(old.protocol === "pppoe" ? ["ipv6"] : [])])
      clear(key);
  const autoDns = draft.protocol !== "static" && draft.autoDns;
  if (!autoDns) {
    const servers = [...new Set(draft.dns.split(/\s+/).filter(Boolean))];
    if (!servers.length || servers.length > 4 || servers.some((value) => !isDnsAddress(value)))
      throw new Error("手动 DNS 需填写 1 至 4 个有效的 IPv4 或 IPv6 地址");
    set("dns", servers);
    set("peerdns", "0");
  } else if (!old.autoDns || changedProtocol || draft.dns !== old.dns) {
    set("peerdns", "1");
    clear("dns");
  }
  const edit: ConfigEdit = { config: "network", section: "wan", values, remove: [...remove] };
  return {
    label: "WAN 设置",
    address: lanDraft(snapshot).address,
    edits: Object.keys(values).length || remove.size ? [edit] : [],
  };
}
