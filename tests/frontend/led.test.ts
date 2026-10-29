import { expect, test } from "bun:test";
import {
  LedClient,
  ledDraft,
  triggerLabel,
  validateLedPolicy,
} from "../../frontend/src/lib/led-client";
import { ledFixture } from "../helpers/led-fixture";
import type { RouterClient } from "../../frontend/src/lib/rpc";

test("AX1800 与 N1 按真实触发器生成智能状态灯默认值", () => {
  for (const device of ["jdcloud-ax1800", "phicomm-n1"]) {
    const snapshot = { ...ledFixture(device), updatedAt: 1 };
    const policy = ledDraft(snapshot);
    policy.enabled = true;
    validateLedPolicy(policy, snapshot.leds, snapshot.networkDevices);
    const selected = policy.leds.find((item) => item.trigger !== "preserve");
    expect(selected?.trigger).toBe("netdev");
    expect(selected?.deviceName).toBe("wan");
  }
});

test("动态显示内核触发器名称并拒绝无效网卡和触发器", () => {
  const snapshot = { ...ledFixture(), updatedAt: 1 };
  const policy = ledDraft(snapshot);
  policy.enabled = true;
  expect(triggerLabel("phy0rx")).toContain("接收活动");
  expect(() => validateLedPolicy(policy, snapshot.leds, snapshot.networkDevices)).not.toThrow();
  expect(() =>
    validateLedPolicy(
      {
        ...policy,
        leds: policy.leds.map((rule) =>
          rule.trigger === "netdev" ? { ...rule, deviceName: "../../etc/passwd" } : rule,
        ),
      },
      snapshot.leds,
      snapshot.networkDevices,
    ),
  ).toThrow();
  expect(() =>
    validateLedPolicy(
      { ...policy, leds: policy.leds.map((rule) => ({ ...rule, trigger: "unknown-trigger" })) },
      snapshot.leds,
      snapshot.networkDevices,
    ),
  ).toThrow();
  const noNetdev = snapshot.leds.map((led) => ({ ...led, triggers: ["heartbeat"] }));
  expect(() => validateLedPolicy(policy, noNetdev, snapshot.networkDevices)).toThrow();
});

test("灯效保存只调用专用配置接口，不开放 system UCI 写入", async () => {
  const calls: unknown[] = [];
  const client = new LedClient({
    call: async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true };
    },
  } as unknown as RouterClient);
  const snapshot = { ...ledFixture(), updatedAt: 1 };
  const policy = ledDraft(snapshot);
  await client.save("sid", policy, snapshot);
  expect(calls[0]).toEqual([
    "sid",
    "router.maintenance",
    "led_save",
    { policy: JSON.stringify(policy) },
    15000,
  ]);
});
