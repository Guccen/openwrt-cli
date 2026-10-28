import { expect, test } from "bun:test";
import { LedClient, ledDraft, validateLedPolicy } from "../../frontend/src/lib/led-client";
import { ledFixture } from "../helpers/led-fixture";
import type { RouterClient } from "../../frontend/src/lib/rpc";

test("四种系统状态按实际灯选择，N1 单色灯仍可独立配置闪烁节奏", () => {
  for (const device of ["jdcloud-ax1800", "phicomm-n1"]) {
    const snapshot = { ...ledFixture(device), updatedAt: 1 };
    const policy = ledDraft(snapshot);
    policy.enabled = true;
    validateLedPolicy(policy, snapshot.leds);
    expect(policy.states.offline.onMs).toBe(1000);
    expect(policy.states.fault.onMs).toBe(100);
    expect(policy.states.normal.led).toBe(
      device === "jdcloud-ax1800" ? "green:status" : "n1:white:status",
    );
  }
});
test("指示灯拒绝未知硬件、不支持的闪烁、危险探测输入和无效间隔", () => {
  const snapshot = { ...ledFixture(), updatedAt: 1 };
  const policy = ledDraft(snapshot);
  policy.enabled = true;
  expect(() =>
    validateLedPolicy({ ...policy, targets: ["223.5.5.5; reboot"] }, snapshot.leds),
  ).toThrow();
  expect(() => validateLedPolicy({ ...policy, targets: ["127.0.0.1"] }, snapshot.leds)).toThrow();
  expect(() => validateLedPolicy(policy, [])).toThrow();
  expect(() =>
    validateLedPolicy(
      policy,
      snapshot.leds.map((led) => ({ ...led, timer: false })),
    ),
  ).toThrow();
  policy.states.fault.onMs = 0;
  expect(() => validateLedPolicy(policy, snapshot.leds)).toThrow();
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
  await client.save("sid", policy, snapshot.leds);
  expect(calls[0]).toEqual([
    "sid",
    "router.maintenance",
    "led_save",
    { policy: JSON.stringify(policy) },
    15000,
  ]);
});
