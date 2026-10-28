import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { bytes } from "@/lib/format";
import { temperatureLabel } from "@/lib/status";
import type { Telemetry } from "@/lib/types";

export function HealthCard({ telemetry }: { telemetry: Telemetry }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>温度与存储</CardTitle>
        <CardDescription>设备本地时间 {telemetry.localTime || "暂不可用"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {telemetry.temperatures.length ? (
            telemetry.temperatures.map((sensor, index) => (
              <div key={`${sensor.name}-${index}`}>
                <span className="text-muted-foreground">
                  {temperatureLabel(sensor.name, index)}
                </span>
                <span className="ml-2 font-medium tabular-nums">
                  {sensor.celsius.toFixed(1)} °C
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">温度暂不可用，设备未提供可读取的传感器。</p>
          )}
        </div>
        {telemetry.storage.map((disk) => {
          const percent = Math.max(0, Math.min(100, Math.round((disk.used / disk.total) * 100)));
          return (
            <div key={disk.path} className="space-y-2">
              <div className="flex flex-wrap justify-between gap-1">
                <span>
                  {disk.name} <span className="text-muted-foreground">{disk.path}</span>
                  {disk.source?.startsWith("/dev/") && (
                    <span className="ml-2 text-muted-foreground">{disk.source}</span>
                  )}
                </span>
                <span className="tabular-nums">
                  可用 {bytes(disk.available)} / 总计 {bytes(disk.total)}
                </span>
              </div>
              <Progress
                value={percent}
                aria-label={`${disk.name}已用 ${percent}%`}
                className="h-1.5"
              />
              {percent >= 90 && (
                <p className="text-destructive">空间使用已达 {percent}%，建议及时清理。</p>
              )}
            </div>
          );
        })}
        {!telemetry.storage.length && <p className="text-muted-foreground">存储状态暂不可用。</p>}
        <p className="text-[11px] text-muted-foreground">临时空间通常使用内存，重启后清空。</p>
        {!!telemetry.blockDisks?.length && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">整盘与分区容量</summary>
            <div className="mt-3 space-y-3">
              {telemetry.blockDisks.map((disk) => (
                <div key={disk.device} className="space-y-1">
                  <p className="font-medium">
                    {disk.system ? "系统磁盘" : "磁盘"} {disk.device}
                  </p>
                  <p className="text-muted-foreground">
                    整盘 {bytes(disk.total)}
                    {disk.partitioned !== null && ` · 已分区 ${bytes(disk.partitioned)}`}
                    {disk.unallocated !== null && ` · 尾部未分配 ${bytes(disk.unallocated)}`}
                  </p>
                  {disk.system && (disk.unallocated ?? 0) > 512 * 1024 * 1024 && (
                    <p className="leading-relaxed text-amber-700 dark:text-amber-400">
                      当前系统分区只使用了磁盘的一部分。剩余空间可在备份后扩容，或另建数据分区；不属于上方文件系统的可用容量。
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
