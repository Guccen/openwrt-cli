import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewTrends } from "../../frontend/src/components/overview/overview-trends";
import {
  appendOverviewSample,
  startOverviewRefresh,
} from "../../frontend/src/lib/overview-history";
import { createRouterStore } from "../../frontend/src/stores/router";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import type { Snapshot } from "../../frontend/src/lib/types";

const snapshot = (time: number, uptime = 100): Snapshot => ({
  board: {
    hostname: "N1",
    kernel: "6.18",
    release: { distribution: "test", version: "1", revision: "1", target: "test" },
  },
  info: { uptime, load: [32768], memory: { total: 1000, free: 100, available: 750 } },
  interfaces: [],
  updatedAt: time,
});

test("概况使用可访问的图表容器，并说明负载含义和初始采样状态", () => {
  const html = renderToStaticMarkup(<OverviewTrends history={[]} />);
  expect(html).toContain("系统负载趋势");
  expect(html).toContain("平均负载不是 CPU 使用率");
  expect(html).toContain("内存占用趋势");
  expect(html).toContain("正在收集趋势样本");
  expect(html.match(/data-slot="chart"/g)).toHaveLength(2);
});

test("趋势区分平均负载和内存比例，暂停或失败留空，重启后重新采样", () => {
  let history = appendOverviewSample([], snapshot(1000));
  expect(history[0]).toEqual({ time: 1000, uptime: 100, memory: 25, load: 0.5 });
  expect(appendOverviewSample(history, snapshot(1000))).toBe(history);
  history = appendOverviewSample(history, snapshot(21000, 120));
  expect(history[1].memory).toBeNull();
  expect(history[1].load).toBeNull();
  expect(history[2].load).toBe(0.5);
  expect(appendOverviewSample(history, snapshot(22000, 10))).toHaveLength(1);
  const missing = snapshot(23000);
  missing.info.load = [];
  missing.info.memory.total = 0;
  expect(appendOverviewSample([], missing)[0]).toMatchObject({ memory: null, load: null });
});

test("趋势仅保留最近五分钟和有限样本，失败保留历史，退出或换会话清空", async () => {
  let history = [] as ReturnType<typeof appendOverviewSample>;
  for (let index = 1; index < 100; index++)
    history = appendOverviewSample(history, snapshot(index * 5000, index * 5));
  expect(history).toHaveLength(61);
  expect(history.at(-1)!.time - history[0].time).toBe(300000);
  expect(appendOverviewSample(history, snapshot(1000000, 1000))).toHaveLength(1);
  let fail = false;
  const client = {
    snapshot: async () => {
      if (fail) throw new RpcError("连接失败");
      return snapshot(1000);
    },
  } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.getState().adoptSession("a".repeat(32));
  await store.getState().refresh();
  expect(store.getState().history).toHaveLength(1);
  fail = true;
  await store.getState().refresh();
  expect(store.getState().history).toHaveLength(1);
  store.getState().adoptSession("b".repeat(32));
  expect(store.getState().history).toEqual([]);
  store.getState().forgetSession();
  expect(store.getState().history).toEqual([]);
});

test("自动刷新隐藏时暂停、恢复可见时重读、请求不重叠且离开页面后停止", async () => {
  const listeners = new Set<() => void>();
  const tasks = new Set<() => void>();
  const page = {
    hidden: false,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  let reads = 0;
  let finish!: () => void;
  let allowed = true;
  const stop = startOverviewRefresh(
    () => {
      reads++;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    () => allowed,
    page as unknown as Document,
    (callback) => {
      tasks.add(callback);
      return () => {
        tasks.delete(callback);
      };
    },
  );
  const tick = () => [...tasks][0]?.();
  tick();
  expect(reads).toBe(1);
  for (const listener of listeners) listener();
  expect(reads).toBe(1);
  page.hidden = true;
  for (const listener of listeners) listener();
  finish();
  await Promise.resolve();
  expect(tasks.size).toBe(0);
  page.hidden = false;
  allowed = false;
  for (const listener of listeners) listener();
  expect(reads).toBe(1);
  allowed = true;
  tick();
  expect(reads).toBe(2);
  stop();
  finish();
  await Promise.resolve();
  expect(tasks.size).toBe(0);
  expect(listeners.size).toBe(0);
});
