import { memoryUsage } from "./format";
import type { Snapshot } from "./types";

export interface OverviewSample {
  time: number;
  uptime: number;
  memory: number | null;
  load: number | null;
}

export function appendOverviewSample(history: OverviewSample[], snapshot: Snapshot) {
  const { info, updatedAt: time } = snapshot;
  if (!info?.memory || !Number.isFinite(info.uptime)) return history;
  const previous = history.at(-1);
  if (!Number.isFinite(time) || (previous && time <= previous.time)) return history;
  // 重启后清空旧曲线；采样失败或暂停造成的空档不连线，也不填成零。
  const samples =
    previous && info.uptime < previous.uptime
      ? []
      : history.filter((item) => time - item.time <= 300000);
  if (samples.length && time - samples.at(-1)!.time > 15000)
    samples.push({ time: time - 1, uptime: info.uptime, memory: null, load: null });
  samples.push({
    time,
    uptime: info.uptime,
    memory:
      Number.isFinite(info.memory.total) &&
      info.memory.total > 0 &&
      Number.isFinite(memoryUsage(info.memory).percent)
        ? memoryUsage(info.memory).percent
        : null,
    load: Number.isFinite(info.load?.[0]) && info.load[0] >= 0 ? info.load[0] / 65536 : null,
  });
  return samples.slice(-61);
}

type Visibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
type Schedule = (callback: () => void) => () => void;
const scheduleRefresh: Schedule = (callback) => {
  const timer = setTimeout(callback, 5000);
  return () => clearTimeout(timer);
};

export function startOverviewRefresh(
  refresh: () => Promise<void>,
  allowed: () => boolean,
  page: Visibility = document,
  schedule: Schedule = scheduleRefresh,
) {
  let stopped = false;
  let running = false;
  let cancel = () => {};
  const queue = () => {
    cancel();
    if (!stopped && !page.hidden) cancel = schedule(tick);
  };
  const tick = async () => {
    cancel();
    if (stopped || page.hidden || running) return;
    if (allowed()) {
      running = true;
      try {
        await refresh();
      } catch {
        /* 失败保留上一份状态，下一轮继续尝试。 */
      } finally {
        running = false;
      }
    }
    queue();
  };
  const visibility = () => {
    cancel();
    if (!page.hidden) void tick();
  };
  page.addEventListener("visibilitychange", visibility);
  queue();
  return () => {
    stopped = true;
    cancel();
    page.removeEventListener("visibilitychange", visibility);
  };
}
