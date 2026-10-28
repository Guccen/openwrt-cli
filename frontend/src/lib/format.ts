export function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

export function uptime(seconds: number) {
  const minutes = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60);
  return `${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小时 ${minutes % 60} 分`;
}

const buildTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function buildTime(seconds?: number) {
  // 构建元数据使用秒级时间戳；旧镜像或无效值不能伪装成当前时间。
  if (!Number.isSafeInteger(seconds) || !seconds || seconds < 0 || seconds > 253402271999)
    return null;
  const parts = Object.fromEntries(
    buildTimeFormatter
      .formatToParts(new Date(seconds * 1000))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function memoryUsage(memory: {
  total: number;
  free: number;
  available?: number;
  buffered?: number;
  cached?: number;
}) {
  const available = memory.available ?? memory.free + (memory.buffered ?? 0) + (memory.cached ?? 0);
  const used = Math.max(0, Math.min(memory.total, memory.total - available));
  return { used, percent: memory.total > 0 ? Math.round((used / memory.total) * 100) : 0 };
}
