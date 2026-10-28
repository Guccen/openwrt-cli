import { expect, test } from "bun:test";
import { n1Topology, n1WifiPlan } from "../../frontend/src/lib/n1-wireless";
import { wifiDrafts, type ConfigPlan } from "../../frontend/src/lib/settings";
import { radioDraft, radioPlan } from "../../frontend/src/lib/radio-settings";
import { createBackup } from "../../frontend/src/lib/backup";
import { wanDraft, wanPlan } from "../../frontend/src/lib/wan-settings";
import type { Device } from "../../frontend/src/lib/types";
import { settingsFixture } from "../helpers/settings-fixture";

const device: Device = {
  device: "phicomm-n1",
  model: "N1",
  role: "router",
  address: "192.168.69.1",
  source: "25.12",
  revision: "a".repeat(40),
  wan: "eth2",
};
function fixture(bypass = false) {
  const s = settingsFixture(bypass);
  s.network.bridge = { ".type": "device", name: "br-lan", type: "bridge", ports: ["eth0"] };
  s.wireless.radio0.type = "mac80211";
  if (!bypass) s.network.wan.device = "eth2";
  return s;
}
function apply(s: ReturnType<typeof fixture>, plan: ConfigPlan) {
  const next = structuredClone(s);
  for (const edit of plan.edits) {
    const section = next[edit.config][edit.section];
    Object.assign(section, edit.values);
    for (const option of edit.remove ?? []) delete section[option];
  }
  return next;
}
const enabled = (s: ReturnType<typeof fixture>) => ({
  ...wifiDrafts(s, true)[0],
  enabled: true,
  password: "example-wifi-password",
});

test("N1 开启热点不改动 WAN，首次启用仍要求密码", () => {
  const s = fixture(),
    draft = enabled(s);
  expect(n1Topology(s, device)).toBe("usb");
  expect(() => n1WifiPlan(s, { ...draft, password: "" }, "usb", device)).toThrow("密码");
  const next = apply(s, n1WifiPlan(s, draft, "usb", device));
  expect(next.network).toEqual(s.network);
  expect(next.wireless.radio0.disabled).toBe("0");
  expect(next.wireless.default_radio0.key).toBe(draft.password);
});

test("N1 无线 WAN 将 STA 放入 WAN，保留有线管理、IPv6 和防火墙隔离", () => {
  const s = fixture();
  Object.assign(s.network.wan, { proto: "pppoe", username: "old-user", password: "old-secret" });
  const plan = n1WifiPlan(s, enabled(s), "station", device),
    next = apply(s, plan);
  for (const edit of plan.edits)
    for (const key of edit.remove ?? []) expect(s[edit.config][edit.section]).toHaveProperty(key);
  expect(next.network.wan.proto).toBe("dhcp");
  expect(next.network.wan.device).toBeUndefined();
  expect(next.network.wan.password).toBeUndefined();
  expect(next.network.bridge.ports).toEqual(["eth0"]);
  expect(next.wireless.default_radio0).toMatchObject({ mode: "sta", network: "wan", hidden: "0" });
  expect(next.wireless.radio0.channel).toBe("auto");
  expect(next.network.wan6).toEqual(s.network.wan6);
  expect(next.firewall).toEqual(s.firewall);
  expect(n1Topology(next, device)).toBe("station");
  expect(JSON.stringify({ label: plan.label, address: plan.address })).not.toContain("password");
  expect(createBackup(next, device).omittedWireless).toEqual(["default_radio0"]);
  expect(() => wanPlan(next, { ...wanDraft(next), protocol: "pppoe" }, false)).toThrow("无线 WAN");
  expect(wanPlan(next, wanDraft(next), false).edits).toEqual([]);
});

test("N1 内置网口作为 WAN 时从 LAN 桥移除，WiFi 为唯一 LAN", () => {
  const s = fixture(),
    next = apply(s, n1WifiPlan(s, enabled(s), "ethernet", device));
  expect(next.network.wan.device).toBe("eth0");
  expect(next.network.bridge.ports).toBeUndefined();
  expect(next.network.bridge.bridge_empty).toBe("1");
  expect(next.wireless.default_radio0.network).toBe("lan");
  expect(n1Topology(next, device)).toBe("ethernet");
  expect(() => n1WifiPlan(next, { ...enabled(next), enabled: false }, "ethernet", device)).toThrow(
    "依赖 WiFi",
  );
});

test("N1 从无线 WAN 切回时重新设置热点密码，恢复镜像记录的 USB 口", () => {
  const s = fixture(),
    station = apply(s, n1WifiPlan(s, enabled(s), "station", device));
  expect(() => n1WifiPlan(station, { ...enabled(station), password: "" }, "usb", device)).toThrow(
    "重新填写",
  );
  const restored = apply(station, n1WifiPlan(station, enabled(station), "usb", device));
  expect(restored.network.wan.device).toBe("eth2");
  expect(restored.wireless.default_radio0.mode).toBe("ap");
  expect(restored.wireless.default_radio0.network).toBe("lan");
  expect(n1Topology(restored, device)).toBe("usb");
});

test("旁路由仅开放热点，高级桥接、独立 IPv6 和并发无线接口不会被覆盖", () => {
  const s = fixture(true),
    bypass = { ...device, role: "bypass" as const };
  expect(n1WifiPlan(s, enabled(s), "usb", bypass).edits.every((e) => e.config === "wireless")).toBe(
    true,
  );
  expect(() => n1WifiPlan(s, enabled(s), "station", bypass)).toThrow("旁路由");
  const custom = fixture();
  custom.network.bridge.ports = ["eth0", "eth1"];
  expect(() => n1Topology(custom, device)).toThrow("自定义");
  const separate = fixture();
  separate.network.wan6.device = "eth2";
  expect(() => n1WifiPlan(separate, enabled(separate), "station", device)).toThrow("高级");
  const concurrent = fixture();
  concurrent.wireless.extra = { ...concurrent.wireless.default_radio0 };
  expect(() => n1Topology(concurrent, device)).toThrow("高级");
});

test("单射频切换频段时验证实际信道，不能把 5 GHz 信道或 VHT 模式用到 2.4 GHz", () => {
  const s = fixture(),
    draft = radioDraft(s, "radio0");
  const caps = {
    modes: ["HT20", "VHT80"],
    countries: [{ code: "CN", name: "中国" }],
    channels: [
      { channel: 1, mhz: 2412, dfs: false },
      { channel: 36, mhz: 5180, dfs: false },
    ],
  };
  const plan = radioPlan(s, "radio0", { ...draft, band: "5g", channel: "36", mode: "VHT80" }, caps);
  expect(plan.edits[0].values).toMatchObject({ band: "5g", channel: "36", htmode: "VHT80" });
  expect(() => radioPlan(s, "radio0", { ...draft, channel: "36" }, caps)).toThrow("信道");
  expect(() => radioPlan(s, "radio0", { ...draft, mode: "VHT80" }, caps)).toThrow("带宽");
  expect(() => radioPlan(s, "radio0", { ...draft, band: "6g" }, caps)).toThrow("频段");
});
