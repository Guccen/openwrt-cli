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
      </CardContent>
    </Card>
  );
}
