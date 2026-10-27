import { expect, test } from "bun:test";
import { ipv6Cidr, ipv6Draft, ipv6Plan, isIpv6Unicast } from "../../frontend/src/lib/ipv6-settings";
import { ConfigClient } from "../../frontend/src/lib/config-client";
import { RouterClient } from "../../frontend/src/lib/rpc";
import { createSettingsStore } from "../../frontend/src/stores/settings";
import { settingsFixture } from "../helpers/settings-fixture";

test("IPv6 校验拒绝多播、回环、非法前缀及未对齐网段", () => {
  for (const address of [
    "::",
    "::1",
    "ff02::1",
    "::ffff:192.168.1.1",
    "2001:db8::;reboot",
    "2001::db8::1",
  ])
    expect(isIpv6Unicast(address)).toBe(false);
  expect(isIpv6Unicast("fe80::1")).toBe(true);
  expect(ipv6Cidr("2001:db8::2/64")).toBe(true);
  expect(ipv6Cidr("2001:db8::2/56", true)).toBe(false);
  expect(ipv6Cidr("2001:db8:100::/56", true)).toBe(true);
  expect(ipv6Cidr("2001:db8::/064")).toBe(false);
});

test("自动 IPv6 保留 IPv4 和拨号凭据，缺少接口时通过命名新增创建", () => {
  const snapshot = settingsFixture();
  snapshot.dhcp.lan.ra = "server";
  const initial = ipv6Draft(snapshot, false);
  expect(ipv6Plan(snapshot, initial, false).edits).toHaveLength(0);
  delete snapshot.network.wan6;
  snapshot.network.wan.proto = "pppoe";
  snapshot.network.wan.password = "existing-password";
  const plan = ipv6Plan(
    snapshot,
    { ...ipv6Draft(snapshot, false), mode: "auto", lan: true },
    false,
  );
  expect(plan.edits).toContainEqual(
    expect.objectContaining({
      config: "network",
      section: "wan6",
      add: "interface",
      values: expect.objectContaining({ proto: "dhcpv6", reqprefix: "auto", device: "@wan" }),
    }),
  );
  expect(plan.edits).toContainEqual({ config: "network", section: "wan", values: { ipv6: "1" } });
  expect(JSON.stringify(plan)).not.toContain("existing-password");
  expect(snapshot.network.wan.password).toBe("existing-password");
});

test("中继配置明确主从接口，退出中继清理自身创建的主接口", () => {
  const snapshot = settingsFixture();
  snapshot.dhcp.lan.ra = "server";
  const plan = ipv6Plan(
    snapshot,
    { ...ipv6Draft(snapshot, false), mode: "relay", lan: true },
    false,
  );
  expect(plan.edits).toContainEqual(
    expect.objectContaining({
      section: "router_ui_ipv6_uplink",
      add: "dhcp",
      values: expect.objectContaining({ master: "1", interface: "wan6", ndp: "relay" }),
    }),
  );
  expect(plan.edits).toContainEqual(
    expect.objectContaining({
      section: "lan",
      values: expect.objectContaining({ ra: "relay", ndp: "relay" }),
    }),
  );
  snapshot.dhcp.router_ui_ipv6_uplink = { ".type": "dhcp", master: "1", interface: "wan6" };
  snapshot.dhcp.lan.ra = "relay";
  const automatic = ipv6Plan(snapshot, { ...ipv6Draft(snapshot, false), mode: "auto" }, false);
  expect(automatic.edits).toContainEqual({
    config: "dhcp",
    section: "router_ui_ipv6_uplink",
    deleteSection: true,
  });
});

test("旁路由仅获取本机地址，不创建 RA 服务或请求下游前缀", () => {
  const snapshot = settingsFixture(true);
  const plan = ipv6Plan(snapshot, { ...ipv6Draft(snapshot, true), mode: "auto" }, true);
  expect(plan.edits).toHaveLength(1);
  expect(plan.edits[0]).toMatchObject({
    section: "lan6",
    add: "interface",
    values: { device: "@lan", reqprefix: "no", delegate: "0" },
  });
  expect(() => ipv6Plan(snapshot, { ...ipv6Draft(snapshot, true), mode: "relay" }, true)).toThrow(
    "支持",
  );
});

test("静态 IPv6 校验地址、网关、LAN 前缀和 DNS，不覆盖高级接口", () => {
  const snapshot = settingsFixture();
  const draft = {
    ...ipv6Draft(snapshot, false),
    mode: "static" as const,
    lan: true,
    address: "2001:db8:1::2/64",
    gateway: "fe80::1",
    prefix: "2001:db8:200::/56",
    autoDns: false,
    dns: "2606:4700:4700::1111",
  };
  expect(ipv6Plan(snapshot, draft, false).edits[0].values).toMatchObject({
    ip6addr: [draft.address],
    ip6gw: draft.gateway,
    ip6prefix: [draft.prefix],
    dns: [draft.dns],
  });
  expect(() => ipv6Plan(snapshot, { ...draft, prefix: "" }, false)).toThrow("LAN 前缀");
  expect(() => ipv6Plan(snapshot, { ...draft, dns: "1.1.1.1" }, false)).toThrow("IPv6 DNS");
  snapshot.network.wan6.proto = "6in4";
  expect(() => ipv6Draft(snapshot, false)).toThrow("高级");
});

test("新增配置检查返回名称，删除整节单独调用，IPv6 管理保持原来源", async () => {
  const calls: [string, object][] = [];
  const rpc = {
    call: async (_session: string, _object: string, method: string, args: object) => {
      calls.push([method, args]);
      return { section: "lan6" };
    },
  } as unknown as RouterClient;
  const api = new ConfigClient(rpc);
  await api.stage("sid", [
    { config: "network", section: "lan6", add: "interface", values: { proto: "dhcpv6" } },
    { config: "dhcp", section: "relay", deleteSection: true },
  ]);
  expect(calls[0]).toEqual([
    "add",
    { config: "network", name: "lan6", type: "interface", values: { proto: "dhcpv6" } },
  ]);
  expect(calls[1]).toEqual(["delete", { config: "dhcp", section: "relay" }]);
  const client = {
    changes: async () => false,
    stage: async () => {},
    apply: async () => {},
  } as unknown as ConfigClient;
  const store = createSettingsStore(client),
    snapshot = settingsFixture();
  store.setState({ session: "sid", snapshot });
  await store.getState().apply(
    {
      label: "IPv6",
      address: String(snapshot.network.lan.ipaddr),
      edits: [{ config: "network", section: "wan6", values: { reqprefix: "56" } }],
    },
    "https://[fd12::1]",
  );
  expect(store.getState().pending?.newOrigin).toBe("https://[fd12::1]");
});
