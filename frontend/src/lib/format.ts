export function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}

export function uptime(seconds: number) {
  const minutes = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) / 60);
  return `${Math.floor(minutes / 1440)} 天 ${Math.floor((minutes % 1440) / 60)} 小时 ${minutes % 60} 分`;
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
