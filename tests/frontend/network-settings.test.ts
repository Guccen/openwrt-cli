import { describe, expect, test } from "bun:test";
import { wanDraft, wanPlan } from "../../frontend/src/lib/wan-settings";
import { dhcpDraft, dhcpPlan, leaseSeconds } from "../../frontend/src/lib/dhcp-settings";
import { lanDraft, lanPlan } from "../../frontend/src/lib/settings";
import type { UciSection } from "../../frontend/src/lib/settings";
import { settingsFixture } from "../helpers/settings-fixture";

describe("WAN 上网设置", () => {
  test("自动上网无改动时不写配置，旁路由和高级接口不能套用普通表单", () => {
    const snapshot = settingsFixture();
    Object.assign(snapshot.network.wan, { mtu: "1480", macaddr: "00:11:22:33:44:55" });
    expect(wanPlan(snapshot, wanDraft(snapshot), false).edits).toEqual([]);
    expect(() => wanPlan(snapshot, wanDraft(snapshot), true)).toThrow("旁路由");
    for (const wan of [
      { proto: "wireguard" },
      { proto: "static", ipaddr: ["10.0.0.2/24"] },
    ] as UciSection[])
      expect(() => wanDraft({ ...snapshot, network: { ...snapshot.network, wan } })).toThrow(
        "高级",
      );
  });
  test("首次拨号要求凭据，留空保留已有密码，切回 DHCP 清理拨号字段", () => {
    const snapshot = settingsFixture(),
      original = structuredClone(snapshot);
    const draft = { ...wanDraft(snapshot), protocol: "pppoe" as const, username: "user@example" };
    expect(() => wanPlan(snapshot, draft, false)).toThrow("密码");
    const plan = wanPlan(snapshot, { ...draft, password: " sample password " }, false);
    expect(plan.edits[0].values).toMatchObject({
      proto: "pppoe",
      username: "user@example",
      password: " sample password ",
      ipv6: "1",
    });
    expect(plan.edits[0].values).not.toHaveProperty("device");
    expect(snapshot).toEqual(original);
    Object.assign(snapshot.network.wan, plan.edits[0].values);
    expect(wanDraft(snapshot).password).toBe("");
    expect(
      wanPlan(snapshot, { ...wanDraft(snapshot), username: "new-user" }, false).edits[0].values,
    ).toEqual({ username: "new-user" });
    const automatic = wanPlan(snapshot, { ...wanDraft(snapshot), protocol: "dhcp" }, false);
    expect(automatic.edits[0].remove).toEqual(
      expect.arrayContaining(["username", "password", "ipv6"]),
    );
    for (const password of ["bad\nline", "长".repeat(43)])
      expect(() => wanPlan(original, { ...draft, password }, false)).toThrow("密码");
  });
  test("静态地址校验网关、掩码和 LAN 冲突，手动 DNS 必须有效", () => {
    const snapshot = settingsFixture();
    const draft = {
      ...wanDraft(snapshot),
      protocol: "static" as const,
      address: "10.0.2.15",
      netmask: "255.255.255.0",
      gateway: "10.0.2.2",
      autoDns: false,
      dns: "1.1.1.1\n1.1.1.1\n2606:4700:4700::1111",
    };
    expect(wanPlan(snapshot, draft, false).edits[0].values).toMatchObject({
      proto: "static",
      ipaddr: "10.0.2.15",
      dns: ["1.1.1.1", "2606:4700:4700::1111"],
      peerdns: "0",
    });
    for (const invalid of [
      { address: "192.168.69.2" },
      { address: "10.0.2.0" },
      { address: "10.0.2.255" },
      { gateway: "10.0.2.15" },
      { gateway: "10.0.3.1" },
      { netmask: "255.0.255.0" },
      { dns: "" },
      { dns: "example.com" },
    ])
      expect(() => wanPlan(snapshot, { ...draft, ...invalid }, false)).toThrow();
    Object.assign(snapshot.network.wan, wanPlan(snapshot, draft, false).edits[0].values);
    const automatic = wanPlan(
      snapshot,
      { ...wanDraft(snapshot), protocol: "dhcp", autoDns: true },
      false,
    );
    expect(automatic.edits[0].remove).toEqual(
      expect.arrayContaining(["ipaddr", "netmask", "gateway", "dns"]),
    );
    expect(automatic.edits[0].values).toMatchObject({ proto: "dhcp", peerdns: "1" });
    expect(snapshot.network.wan.device).toBe("eth1");
    expect(snapshot.network.wan6.device).toBe("@wan");
  });
});

describe("DHCP 地址池与 LAN 联动", () => {
  test("把实际地址换算为相对子网的偏移，只改指定的 DHCP 字段", () => {
    const snapshot = settingsFixture(),
      original = structuredClone(snapshot),
      draft = dhcpDraft(snapshot);
    expect(dhcpPlan(snapshot, draft, false).edits).toEqual([]);
    Object.assign(snapshot.dhcp.lan, { ra: "server", dhcpv6: "server" });
    const plan = dhcpPlan(
      snapshot,
      { ...draft, start: "192.168.69.50", end: "192.168.69.79", lease: "30m" },
      false,
    );
    expect(plan.edits).toEqual([
      { config: "dhcp", section: "lan", values: { start: "50", limit: "30", leasetime: "30m" } },
    ]);
    expect(snapshot.network).toEqual(original.network);
    expect(snapshot.dhcp.lan.ra).toBe("server");
    expect(dhcpPlan(snapshot, { ...draft, enabled: false }, false).edits[0].values).toEqual({
      dhcpv4: "disabled",
    });
  });
  test("拒绝反向/越界地址池、路由器地址、大地址池和异常租期", () => {
    const snapshot = settingsFixture(),
      draft = dhcpDraft(snapshot);
    for (const invalid of [
      { start: "192.168.69.0" },
      { end: "192.168.69.255" },
      { end: "192.168.70.10" },
      { start: "192.168.69.200", end: "192.168.69.100" },
      { start: "192.168.69.1" },
      { lease: "1m" },
      { lease: "31d" },
    ])
      expect(() => dhcpPlan(snapshot, { ...draft, ...invalid }, false)).toThrow();
    expect(leaseSeconds("30m")).toBe(1800);
    expect(leaseSeconds("7d")).toBe(604800);
    expect(() => dhcpPlan(snapshot, draft, true)).toThrow("旁路由");
    snapshot.dhcp.lan.instance = "custom";
    expect(() => dhcpDraft(snapshot)).toThrow("高级");
  });
  test("LAN 缩小网段时先核对地址池，离线的静态 WAN 同样参与冲突检测", () => {
    const snapshot = settingsFixture(),
      draft = lanDraft(snapshot);
    expect(() => lanPlan(snapshot, { ...draft, address: "192.168.69.100" }, false, [])).toThrow(
      "路由器",
    );
    expect(() => lanPlan(snapshot, { ...draft, netmask: "255.255.255.128" }, false, [])).toThrow(
      "DHCP",
    );
    Object.assign(snapshot.dhcp.lan, { start: "50", limit: "30" });
    expect(
      lanPlan(snapshot, { ...draft, netmask: "255.255.255.128" }, false, []).edits[0].values,
    ).toEqual({ netmask: "255.255.255.128" });
    Object.assign(snapshot.network.wan, {
      proto: "static",
      ipaddr: "10.0.2.15",
      netmask: "255.255.255.0",
    });
    expect(() => lanPlan(snapshot, { ...draft, address: "10.0.2.1" }, false, [])).toThrow("重叠");
  });
});
