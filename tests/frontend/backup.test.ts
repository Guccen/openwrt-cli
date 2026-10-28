import { describe, expect, test } from "bun:test";
import {
  BACKUP_LIMIT,
  createBackup,
  parseBackup,
  restoreBackup,
} from "../../frontend/src/lib/backup";
import type { Device } from "../../frontend/src/lib/types";
import { settingsFixture } from "../helpers/settings-fixture";

const device: Device = {
  device: "jdcloud-ax1800",
  model: "AX1800",
  role: "router",
  address: "192.168.69.1",
  source: "25.12-nss",
  revision: "a".repeat(40),
};
const encode = (value: unknown) => JSON.stringify(value);
function encrypted() {
  const snapshot = settingsFixture();
  snapshot.wireless.radio0.disabled = "0";
  Object.assign(snapshot.wireless.default_radio0, {
    encryption: "psk2",
    key: "backup-test-password",
  });
  return snapshot;
}

describe("本地网络备份", () => {
  test("v2 恢复 LAN 与 DHCP 地址池，v1 备份保留当前地址池", () => {
    const saved = settingsFixture();
    Object.assign(saved.network.lan, { ipaddr: "192.168.70.1", netmask: "255.255.255.128" });
    Object.assign(saved.dhcp.lan, { start: "50", limit: "30", leasetime: "30m" });
    const backup = createBackup(saved, device),
      current = settingsFixture();
    expect(backup.version).toBe(2);
    expect(backup.dhcp).toMatchObject({
      start: "192.168.70.50",
      end: "192.168.70.79",
      lease: "30m",
    });
    const restored = restoreBackup(current, backup, device, []);
    expect(restored.plan.edits).toContainEqual({
      config: "dhcp",
      section: "lan",
      values: { start: "50", limit: "30", leasetime: "30m" },
    });
    expect(restored.changes.some((value) => value.label === "DHCP 地址分配")).toBe(true);
    const { dhcp: _pool, ...previous } = createBackup(current, device);
    const legacy = parseBackup(encode({ ...previous, version: 1 }), device);
    current.dhcp.lan.start = "70";
    expect(restoreBackup(current, legacy, device, []).plan.edits).toEqual([]);
    expect(() => parseBackup(encode({ ...backup, version: 1 }), device)).toThrow("旧版");
    expect(() =>
      parseBackup(encode({ ...backup, dhcp: { ...backup.dhcp, commands: ["reboot"] } }), device),
    ).toThrow("字段");
    expect(() =>
      restoreBackup(
        current,
        { ...backup, dhcp: { ...backup.dhcp!, start: "192.168.70.1" } },
        device,
        [],
      ),
    ).toThrow("路由器");
  });
  test("同设备往返无改动，仅保存支持的字段和 WiFi 密钥", () => {
    const snapshot = encrypted();
    snapshot.network.wan = {
      ".type": "interface",
      proto: "pppoe",
      username: "wan-login",
      password: "must-not-export-wan-password",
    };
    snapshot.network.lan.custom_option = "must-not-export-advanced-option";
    const original = structuredClone(snapshot);
    const backup = createBackup(snapshot, device);
    const serialized = encode(backup);
    expect(serialized).toContain("backup-test-password");
    expect(serialized).not.toContain("must-not-export");
    expect(serialized).not.toContain("wan-login");
    expect(restoreBackup(snapshot, parseBackup(serialized, device), device, []).plan.edits).toEqual(
      [],
    );
    expect(snapshot).toEqual(original);
  });

  test("拒绝错误型号、运行模式、版本、额外字段、过大文件及畸形输入", () => {
    const backup = createBackup(settingsFixture(), device);
    for (const modified of [
      { ...backup, device: "phicomm-n1" },
      { ...backup, role: "bypass" },
      { ...backup, version: 99 },
      { ...backup, commands: ["reboot"] },
      { ...backup, lan: { ...backup.lan, device: "eth1" } },
      { ...backup, dns: { servers: ["bad-address"], automatic: false } },
      { ...backup, dns: { servers: [], automatic: false } },
      { ...backup, wireless: [backup.wireless[0], backup.wireless[0]] },
    ])
      expect(() => parseBackup(encode(modified), device)).toThrow();
    expect(() => parseBackup(" ".repeat(BACKUP_LIMIT + 1), device)).toThrow("64 KiB");
    for (const input of ["not json", "null", "[]", '{"__proto__":{}}'])
      expect(() => parseBackup(input, device)).toThrow();
  });

  test("恢复跨三个配置的差异，预览不暴露密钥，也不覆盖 WAN 或桥接", () => {
    const saved = encrypted();
    const backup = createBackup(saved, device);
    const current = structuredClone(saved);
    current.network.lan.ipaddr = "192.168.70.1";
    current.network.lan.device = "custom-bridge";
    current.network.wan = { proto: "dhcp", device: "eth1" };
    Object.assign(current.dhcp.cfg01411c, { noresolv: "1", server: ["1.1.1.1"] });
    Object.assign(current.wireless.default_radio0, {
      ssid: "changed",
      key: "current-test-password",
    });
    const { plan, changes } = restoreBackup(current, backup, device, []);
    expect(new Set(plan.edits.map((edit) => edit.config))).toEqual(
      new Set(["network", "dhcp", "wireless"]),
    );
    expect(plan.edits.find((edit) => edit.config === "network")?.values).toEqual({
      ipaddr: "192.168.69.1",
    });
    expect(plan.edits.find((edit) => edit.config === "wireless")?.values).toMatchObject({
      ssid: "OpenWrt-demo",
      key: "backup-test-password",
    });
    expect(plan.edits.find((edit) => edit.config === "dhcp")?.remove).toEqual(["server"]);
    expect(encode(changes)).not.toContain("test-password");
    expect(encode(changes)).toContain("密钥更新");
    expect(current.network.lan.device).toBe("custom-bridge");
    expect(current.network.wan).toEqual({ proto: "dhcp", device: "eth1" });
  });

  test("导入仍校验 LAN/WAN 重叠和旁路由网关，保留自定义接口 DNS", () => {
    const snapshot = settingsFixture();
    const backup = createBackup(snapshot, device);
    expect(() =>
      restoreBackup(snapshot, backup, device, [
        {
          interface: "wan",
          up: true,
          proto: "dhcp",
          "ipv4-address": [{ address: "192.168.69.100", mask: 24 }],
        },
      ]),
    ).toThrow("重叠");
    expect(() =>
      restoreBackup(
        snapshot,
        { ...backup, lan: { ...backup.lan, address: "192.168.69.255" } },
        device,
        [],
      ),
    ).toThrow("广播");
    const n1: Device = { ...device, device: "phicomm-n1", role: "bypass" };
    const bypass = settingsFixture(true);
    const bypassBackup = createBackup(bypass, n1);
    expect(() =>
      restoreBackup(
        bypass,
        { ...bypassBackup, lan: { ...bypassBackup.lan, gateway: "192.168.70.1" } },
        n1,
        [],
      ),
    ).toThrow("网关");
    const moved = structuredClone(bypass);
    moved.network.lan.gateway = "192.168.68.3";
    moved.network.lan.dns = ["9.9.9.9"];
    expect(restoreBackup(moved, bypassBackup, n1, []).plan.edits[0].values).toEqual({
      gateway: "192.168.68.1",
    });
  });

  test("恢复禁用的未配置 AP 时清除新密钥；高级与不存在的接口不会被覆盖", () => {
    const initial = settingsFixture();
    const backup = createBackup(initial, device);
    const current = encrypted();
    const edit = restoreBackup(current, backup, device, []).plan.edits.find(
      (item) => item.section === "default_radio0",
    );
    expect(edit?.values).toMatchObject({ encryption: "none", disabled: "1" });
    expect(edit?.remove).toEqual(["key"]);
    current.wireless.default_radio0.encryption = "wpa2";
    expect(() => restoreBackup(current, backup, device, [])).toThrow("已变化");
    const advanced = createBackup(current, device);
    expect(advanced.wireless).toEqual([]);
    expect(advanced.omittedWireless).toEqual(["default_radio0"]);
    delete initial.wireless.default_radio0;
    expect(() => restoreBackup(initial, backup, device, [])).toThrow("已变化");
  });

  test("恢复混合自动和手动 DNS 时按当前 dnsmasq 节映射", () => {
    const snapshot = settingsFixture();
    snapshot.dhcp.cfg01411c.server = ["9.9.9.9", "2606:4700:4700::1111"];
    const backup = createBackup(snapshot, device);
    const current = settingsFixture();
    current.dhcp.renamed_dnsmasq = current.dhcp.cfg01411c;
    delete current.dhcp.cfg01411c;
    expect(restoreBackup(current, backup, device, []).plan.edits).toContainEqual({
      config: "dhcp",
      section: "renamed_dnsmasq",
      values: { noresolv: "0", server: backup.dns.servers },
      remove: [],
    });
  });

  test("不允许恢复开放的启用 AP，WPA2 十六进制密钥仅在适用加密下恢复", () => {
    const snapshot = encrypted();
    snapshot.wireless.default_radio0.key = "ab".repeat(32);
    const backup = createBackup(snapshot, device);
    expect(backup.wireless[0].key).toHaveLength(64);
    for (const wifi of [
      { ...backup.wireless[0], key: null },
      { ...backup.wireless[0], key: null, encryption: "none" },
      { ...backup.wireless[0], encryption: "sae-mixed" },
      { ...backup.wireless[0], script: "reboot" },
    ])
      expect(() => parseBackup(encode({ ...backup, wireless: [wifi] }), device)).toThrow();
    const n1 = { ...device, device: "phicomm-n1" as const };
    const n1Backup = parseBackup(encode({ ...backup, device: n1.device }), n1);
    expect(n1Backup.wireless).toEqual(backup.wireless);
  });
});
