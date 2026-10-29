import { expect, test } from "bun:test";
import {
  sameSchedule,
  ScheduleClient,
  scheduleSummary,
  validateSchedulePolicy,
  type SchedulePolicy,
} from "../../frontend/src/lib/schedule";
import type { RouterClient } from "../../frontend/src/lib/rpc";
import { createSessionResource } from "../../frontend/src/stores/resource";

const policy: SchedulePolicy = { enabled: false, time: "03:00", days: [0, 1, 2, 3, 4, 5, 6] };
const status = {
  ok: true,
  policy,
  localTime: "2026-10-27 12:00:00",
  timezone: "Asia/Shanghai",
  next: null,
  last: null,
  cronRunning: true,
  cronSynchronized: true,
};

test("定时重启严格验证24小时制和不重复的星期，关闭时仍保存有效计划", () => {
  validateSchedulePolicy(policy);
  validateSchedulePolicy({ enabled: true, time: "23:59", days: [0] });
  for (const time of ["3:00", "24:00", "03:60", "03:00;reboot", "03:00\n", ""]) {
    expect(() => validateSchedulePolicy({ ...policy, time })).toThrow();
  }
  for (const days of [[], [0, 0], [-1], [7], [1.2], [NaN]]) {
    expect(() => validateSchedulePolicy({ ...policy, days })).toThrow();
  }
  expect(scheduleSummary({ ...policy, days: [5, 2, 3, 4, 1] })).toBe("每周一至周五 03:00");
  expect(scheduleSummary(policy)).toBe("每天 03:00");
  expect(scheduleSummary({ ...policy, days: [6, 0] })).toBe("每周日、周六 03:00");
  expect(sameSchedule({ ...policy, days: [0, 6] }, { ...policy, days: [6, 0] })).toBe(true);
  expect(sameSchedule(policy, { ...policy, enabled: true })).toBe(false);
});

test("只读专用状态，保存仅写允许的计划字段且按星期排序", async () => {
  const calls: unknown[][] = [];
  const client = new ScheduleClient({
    call: async (...args: unknown[]) => {
      calls.push(args);
      return args[2] === "schedule_status" ? structuredClone(status) : { ok: true };
    },
  } as unknown as RouterClient);
  const snapshot = await client.read("sid");
  expect(snapshot.policy).toEqual(policy);
  expect(snapshot.cronRunning).toBe(true);
  expect(snapshot.next).toBeNull();
  expect(snapshot.updatedAt).toBeGreaterThan(0);
  await client.save("sid", {
    enabled: true,
    time: "04:30",
    days: [6, 0],
    command: "reboot",
  } as SchedulePolicy);
  expect(calls).toEqual([
    ["sid", "router.maintenance", "schedule_status", {}, 15000],
    [
      "sid",
      "router.maintenance",
      "schedule_save",
      { enabled: true, time: "04:30", days: [0, 6] },
      15000,
    ],
  ]);
  await expect(client.save("sid", { ...policy, time: "bad" })).rejects.toThrow();
  expect(calls).toHaveLength(2);
});

test("设备错误保留可操作提示，状态和执行记录不完整时拒绝使用", async () => {
  for (const [code, message] of [
    ["configuration_busy", "网络设置"],
    ["operation_busy", "维护操作"],
    ["schedule_invalid", "配置无效"],
    ["schedule_state_failed", "存储空间"],
    ["schedule_restore_failed", "原计划未能完全恢复"],
    ["schedule_cron_busy", "其他操作修改"],
  ]) {
    const client = new ScheduleClient({
      call: async () => ({ ok: false, error: code }),
    } as unknown as RouterClient);
    await expect(client.save("sid", policy)).rejects.toThrow(message);
  }
  for (const invalid of [
    { ...status, policy: { ...policy, days: [0, 0] } },
    { ...status, cronRunning: "yes" },
    { ...status, next: 42 },
    { ...status, last: {} },
    {
      ...status,
      last: { at: 1, localTime: "now", outcome: "unknown", reason: "unknown", slot: null },
    },
  ]) {
    const client = new ScheduleClient({ call: async () => invalid } as unknown as RouterClient);
    await expect(client.read("sid")).rejects.toThrow();
  }
  const record = {
    at: 1793088000,
    localTime: "2026-10-27 03:00:00",
    outcome: "skipped",
    reason: "configuration_busy",
    slot: "2026-10-27 03:00",
  };
  const client = new ScheduleClient({
    call: async () => ({ ...status, last: record }),
  } as unknown as RouterClient);
  expect((await client.read("sid")).last).toEqual(record);
});

test("计划按页面请求读取，切换会话后丢弃迟到的状态", async () => {
  let finish!: (value: typeof status) => void;
  let reads = 0;
  const store = createSessionResource(() => {
    reads++;
    return new Promise<typeof status>((resolve) => {
      finish = resolve;
    });
  });
  await store.getState().load();
  expect(reads).toBe(0);
  store.getState().bind("old");
  const pending = store.getState().load();
  store.getState().bind("new");
  finish(status);
  await pending;
  expect(reads).toBe(1);
  expect(store.getState().snapshot).toBeNull();
  expect(store.getState().loading).toBe(false);
});
