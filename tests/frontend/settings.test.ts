import { describe, expect, test } from "bun:test";
import axios from "axios";
import { ConfigClient } from "../../frontend/src/lib/config-client";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import { dnsPlan, lanDraft, lanPlan, wifiDrafts, wifiPlan } from "../../frontend/src/lib/settings";
import { createSettingsStore } from "../../frontend/src/stores/settings";
import { settingsFixture } from "../helpers/settings-fixture";

describe("配置校验", () => {
  test("LAN 拒绝广播地址、不连续掩码、过小 DHCP 网段和 WAN 重叠", () => {
    const snapshot = settingsFixture();
    const draft = lanDraft(snapshot);
    for (const address of ["192.168.69.0", "192.168.69.255", "127.0.0.1", "224.0.0.1"])
      expect(() => lanPlan(snapshot, { ...draft, address }, false, [])).toThrow();
    for (const netmask of ["255.0.255.0", "255.255.255.128"])
      expect(() => lanPlan(snapshot, { ...draft, netmask }, false, [])).toThrow();
    expect(() =>
      lanPlan(snapshot, draft, false, [
        {
          interface: "wan",
          up: true,
          proto: "dhcp",
          "ipv4-address": [{ address: "192.168.69.100", mask: 24 }],
        },
      ]),
    ).toThrow("重叠");
  });
  test("旁路由网关必须在同网段，修改时保留桥接和其他配置", () => {
    const snapshot = settingsFixture(true);
    expect(() =>
      lanPlan(
        snapshot,
        { address: "192.168.70.2", netmask: "255.255.255.0", gateway: "192.168.68.1" },
        true,
        [],
      ),
    ).toThrow("网关");
    const plan = lanPlan(snapshot, { ...lanDraft(snapshot), address: "192.168.68.10" }, true, []);
    expect(plan.edits).toEqual([
      { config: "network", section: "lan", values: { ipaddr: "192.168.68.10" } },
    ]);
    expect(snapshot.network.lan.device).toBe("br-lan");
    const moved = lanPlan(
      snapshot,
      { address: "192.168.70.2", netmask: "255.255.255.0", gateway: "192.168.70.1" },
      true,
      [],
    );
    expect(moved.edits[0].values).toMatchObject({ gateway: "192.168.70.1", dns: ["192.168.70.1"] });
    snapshot.network.lan.dns = ["9.9.9.9"];
    expect(
      lanPlan(
        snapshot,
        { address: "192.168.70.2", netmask: "255.255.255.0", gateway: "192.168.70.1" },
        true,
        [],
      ).edits[0].values,
    ).not.toHaveProperty("dns");
  });
  test("DNS 支持 IPv6、去重，并在恢复自动 DNS 时删除旧列表", () => {
    const snapshot = settingsFixture();
    expect(dnsPlan(snapshot, "1.1.1.1\n2606:4700:4700::1111\n1.1.1.1").edits[0].values).toEqual({
      server: ["1.1.1.1", "2606:4700:4700::1111"],
      noresolv: "1",
    });
    expect(() => dnsPlan(snapshot, "not-a-server")).toThrow();
    snapshot.dhcp.cfg01411c.server = ["1.1.1.1"];
    snapshot.dhcp.cfg01411c.noresolv = "1";
    expect(dnsPlan(snapshot, "").edits[0]).toMatchObject({
      values: { noresolv: "0" },
      remove: ["server"],
    });
  });
  test("首次启用无线要求密码，并同时启用被禁用的射频", () => {
    const snapshot = settingsFixture();
    const draft = { ...wifiDrafts(snapshot)[0], enabled: true };
    expect(() => wifiPlan(snapshot, draft)).toThrow("密码");
    const plan = wifiPlan(snapshot, { ...draft, password: "new-test-password" });
    expect(plan.edits).toContainEqual({
      config: "wireless",
      section: "radio0",
      values: { disabled: "0" },
    });
    expect(plan.edits[0].values).toMatchObject({
      key: "new-test-password",
      encryption: "psk2",
      disabled: "0",
    });
    expect(() =>
      wifiPlan(snapshot, {
        ...draft,
        password: "new-test-password",
        ssid: "路由器名称太长的测试测试测试",
      }),
    ).toThrow("字节");
  });
  test("保留已有无线密码，拒绝覆盖企业等高级配置", () => {
    const snapshot = settingsFixture();
    snapshot.wireless.default_radio0.encryption = "psk2";
    snapshot.wireless.default_radio0.key = "existing-test-password";
    const draft = wifiDrafts(snapshot)[0];
    expect(draft.password).toBe("");
    expect(wifiPlan(snapshot, { ...draft, ssid: "new-ssid" }).edits[0].values).toEqual({
      ssid: "new-ssid",
    });
    snapshot.wireless.default_radio0.encryption = "wpa2";
    expect(() => wifiPlan(snapshot, { ...draft, ssid: "new-ssid" })).toThrow("高级");
  });
});

function harness(
  options: { ambiguous?: boolean; otherChanges?: boolean; failStage?: boolean } = {},
) {
  const snapshot = settingsFixture();
  const calls: { object: string; method: string; args: Record<string, unknown> }[] = [];
  const client = new ConfigClient(
    new RouterClient(
      axios.create({
        adapter: async (config) => {
          const [, object, method, args] = JSON.parse(config.data).params;
          calls.push({ object, method, args });
          let result: unknown[] = [0, {}];
          if (object === "uci" && method === "get")
            result = [0, { values: snapshot[args.config as keyof typeof snapshot] }];
          if (object === "uci" && method === "changes")
            result = [0, { changes: options.otherChanges ? { network: [["set", "lan"]] } : {} }];
          if (method === "apply" && options.ambiguous) throw new Error("connection interrupted");
          if (method === "set" && options.failStage) result = [6];
          if (object === "network.interface")
            result = [
              0,
              {
                interface: [
                  { interface: "lan", up: true, "ipv4-address": [{ address: "192.168.69.1" }] },
                ],
              },
            ];
          return { data: { result }, status: 200, statusText: "OK", headers: {}, config };
        },
      }),
    ),
  );
  const store = createSettingsStore(client);
  store.getState().bind("a".repeat(32));
  const plan = dnsPlan(snapshot, "1.1.1.1");
  return { store, calls, plan, options };
}

describe("应用确认与恢复", () => {
  test("应用始终开启设备端回滚，不调用直接提交", async () => {
    const { store, calls, plan } = harness();
    await store.getState().load();
    await store.getState().apply(plan, "https://192.168.69.1");
    expect(calls.find((call) => call.method === "apply")?.args).toEqual({
      rollback: true,
      timeout: 120,
    });
    expect(calls.some((call) => call.method === "commit")).toBe(false);
    expect(store.getState().pending).not.toBeNull();
    expect(store.getState().reachable).toBe(false);
    await store.getState().confirm();
    expect(calls.some((call) => call.method === "confirm")).toBe(false);
    await store.getState().probe();
    await store.getState().confirm();
    expect(store.getState().pending).toBeNull();
  });
  test("应用响应因断网丢失时仍保留倒计时", async () => {
    const { store, plan } = harness({ ambiguous: true });
    await store.getState().load();
    await store.getState().apply(plan, "https://192.168.69.1");
    expect(store.getState().phase).toBe("waiting");
    expect(store.getState().pending?.configs).toEqual(["dhcp"]);
    expect(store.getState().error).toContain("恢复");
  });
  test("已有暂存改动不被新操作丢弃，暂存失败则清理本次改动", async () => {
    const { store, calls, plan, options } = harness();
    await store.getState().load();
    options.otherChanges = true;
    await store.getState().apply(plan, "https://192.168.69.1");
    expect(calls.some((call) => call.method === "revert" || call.method === "set")).toBe(false);
    const failed = harness({ failStage: true });
    await failed.store.getState().load();
    await failed.store.getState().apply(failed.plan, "https://192.168.69.1");
    expect(failed.calls.some((call) => call.method === "revert")).toBe(true);
    expect(failed.calls.some((call) => call.method === "apply")).toBe(false);
    expect(failed.store.getState().pending).toBeNull();
  });
  test("恢复后清除 rpcd 留下的暂存差异，超时不允许确认", async () => {
    const { store, calls, plan } = harness();
    await store.getState().load();
    await store.getState().apply(plan, "https://192.168.69.1");
    store.setState({
      pending: { ...store.getState().pending!, deadline: Date.now() - 2000 },
      reachable: true,
    });
    await store.getState().confirm();
    expect(calls.some((call) => call.method === "confirm")).toBe(false);
    await store.getState().probe();
    expect(calls.some((call) => call.method === "rollback")).toBe(true);
    expect(calls.some((call) => call.method === "revert" && call.args.config === "dhcp")).toBe(
      true,
    );
    expect(store.getState().pending).toBeNull();
  });
  test("会话已改变时，迟到的配置读取不能重新写入状态", async () => {
    const { store } = harness();
    const loading = store.getState().load();
    store.getState().bind(null);
    await loading;
    expect(store.getState().snapshot).toBeNull();
    expect(store.getState().session).toBeNull();
    expect(new RpcError("busy", 6).code).toBe(6);
  });
});
