import { expect, test } from "bun:test";
import { settingsFixture } from "../helpers/settings-fixture";
import { reservationPlan, reservations } from "../../frontend/src/lib/reservations";
import { forwardingPlan, forwardingRows, type Forwarding } from "../../frontend/src/lib/forwarding";
import { wanLinkDraft, wanLinkPlan } from "../../frontend/src/lib/wan-link";
import {
  RadioClient,
  radioDraft,
  radioPlan,
  type RadioCapabilities,
} from "../../frontend/src/lib/radio-settings";
import { RouterClient } from "../../frontend/src/lib/rpc";
import { lanPlan } from "../../frontend/src/lib/settings";

test("地址保留支持命名新增、修改、删除，拒绝重复 MAC/IP 和广播、路由器地址", () => {
  const s = settingsFixture(),
    draft = { section: "", name: "laptop", mac: "02:00:00:00:00:01", ip: "192.168.69.20" };
  const edit = reservationPlan(s, draft).edits[0];
  expect(edit).toMatchObject({
    config: "dhcp",
    add: "host",
    values: { mac: draft.mac, ip: draft.ip, name: draft.name },
  });
  s.dhcp[edit.section] = { ".type": "host", ...edit.values };
  expect(reservationPlan(s, { ...draft, section: edit.section }).edits).toHaveLength(0);
  expect(() => reservationPlan(s, { ...draft, mac: "02:00:00:00:00:02" })).toThrow("使用");
  for (const mac of [
    "ff:ff:ff:ff:ff:ff",
    "01:00:00:00:00:01",
    "00:00:00:00:00:00",
    "02:00:00:00:00:01;id",
  ])
    expect(() => reservationPlan(s, { ...draft, mac })).toThrow("MAC");
  for (const ip of ["192.168.69.1", "192.168.69.255", "192.168.70.2"])
    expect(() => reservationPlan(s, { ...draft, ip })).toThrow("网段");
  expect(reservationPlan(s, { ...draft, section: edit.section }, true).edits[0]).toMatchObject({
    deleteSection: true,
  });
  s.dhcp[edit.section].hostid = "1";
  expect(reservations(s)[0].editable).toBe(false);
  expect(() => reservationPlan(s, { ...draft, section: edit.section }, true)).toThrow("高级");
});

test("LAN 改网段会检查现有地址保留和端口转发目标", () => {
  const s = settingsFixture(),
    lan = { address: "192.168.70.1", netmask: "255.255.255.0", gateway: "" };
  s.dhcp.pc = { ".type": "host", ip: "192.168.69.20", mac: "02:00:00:00:00:01" };
  expect(() => lanPlan(s, lan, false, [])).toThrow("保留");
  delete s.dhcp.pc;
  s.firewall.forward = { ".type": "redirect", dest: "lan", dest_ip: "192.168.69.30" };
  expect(() => lanPlan(s, lan, false, [])).toThrow("转发");
});

test("端口转发仅创建 IPv4 DNAT，检查目标、协议和已有范围冲突并保留高级规则", () => {
  const s = settingsFixture(),
    row: Forwarding = {
      section: "",
      name: "web",
      protocol: "tcp",
      external: "8080",
      internal: "80",
      address: "192.168.69.20",
      enabled: true,
      editable: true,
    };
  const edit = forwardingPlan(s, row).edits[0];
  expect(edit).toMatchObject({
    config: "firewall",
    add: "redirect",
    values: { family: "ipv4", src: "wan", dest: "lan", target: "DNAT", dest_ip: row.address },
  });
  s.firewall[edit.section] = { ".type": "redirect", ...edit.values };
  expect(forwardingPlan(s, { ...row, section: edit.section }).edits).toHaveLength(0);
  expect(() => forwardingPlan(s, row)).toThrow("冲突");
  expect(() => forwardingPlan(s, { ...row, address: "192.168.69.1" })).toThrow("目标");
  expect(() => forwardingPlan(s, { ...row, external: "65536" })).toThrow("端口");
  expect(() => forwardingPlan(s, { ...row, protocol: "icmp" })).toThrow("TCP");
  expect(forwardingPlan(s, { ...row, section: edit.section }, true).edits[0].deleteSection).toBe(
    true,
  );
  s.firewall[edit.section].src_dport = "8000-9000";
  expect(forwardingRows(s)[0].editable).toBe(false);
  expect(() => forwardingPlan(s, row)).toThrow("冲突");
  expect(() => forwardingPlan(s, { ...row, section: edit.section }, true)).toThrow("高级");
});

test("WAN MAC 修改物理设备，PPPoE MTU 修改逻辑接口，IPv6 保留 1280 最低要求", () => {
  const s = settingsFixture();
  expect(wanLinkPlan(s, wanLinkDraft(s)).edits).toHaveLength(0);
  const edits = wanLinkPlan(s, { mtu: "1500", mac: "02:00:00:00:00:11" }).edits;
  expect(edits).toContainEqual(
    expect.objectContaining({
      add: "device",
      values: { name: "eth1", mtu: "1500", macaddr: "02:00:00:00:00:11" },
    }),
  );
  s.network.wan.proto = "pppoe";
  expect(wanLinkPlan(s, { mtu: "1492", mac: "" }).edits).toEqual([
    { config: "network", section: "wan", values: { mtu: "1492" } },
  ]);
  expect(() => wanLinkPlan(s, { mtu: "1200", mac: "" })).toThrow("1280");
  s.network.wan.device = "br-lan";
  expect(() => wanLinkDraft(s)).toThrow("高级");
});

test("射频设置来自真实能力，只改指定射频，换国家时先自动信道", async () => {
  const calls: string[] = [];
  const rpc = {
    call: async (_s: string, _o: string, method: string) => {
      calls.push(method);
      return method === "phyname"
        ? { phyname: "phy0" }
        : method === "info"
          ? { htmodes: ["HT20", "HE20", "HE40"] }
          : method === "freqlist"
            ? {
                results: [
                  { channel: 1, mhz: 2412, restricted: false },
                  { channel: 14, mhz: 2484, restricted: true },
                  { channel: 36, mhz: 5180, restricted: true },
                ],
              }
            : { results: [{ iso3166: "CN", country: "China" }] };
    },
  } as unknown as RouterClient;
  const caps: RadioCapabilities = await new RadioClient(rpc).read("sid", "radio0"),
    s = settingsFixture();
  expect(calls).toEqual(["phyname", "info", "freqlist", "countrylist"]);
  expect(caps.channels.map((c) => c.channel)).toEqual([1]);
  expect(caps.bands).toEqual(["2g", "5g"]);
  const draft = { ...radioDraft(s, "radio0"), country: "CN", mode: "HE20" };
  expect(radioPlan(s, "radio0", draft, caps).edits).toEqual([
    { config: "wireless", section: "radio0", values: { country: "CN", htmode: "HE20" } },
  ]);
  expect(() => radioPlan(s, "radio0", { ...draft, mode: "HE160" }, caps)).toThrow("带宽");
  expect(() => radioPlan(s, "radio0", { ...draft, channel: "1" }, caps)).toThrow("自动信道");
});
