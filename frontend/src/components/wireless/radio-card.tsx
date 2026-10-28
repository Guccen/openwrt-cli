import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WirelessRadio } from "@/lib/wireless-client";
import { StationTable } from "./station-table";
import { wifiBandLabel } from "@/lib/wifi-band";

export function RadioCard({ radio }: { radio: WirelessRadio }) {
  const status = radio.disabled
    ? "已禁用"
    : radio.pending
      ? "正在启动"
      : radio.failed
        ? "启动失败"
        : radio.up
          ? "运行中"
          : "未运行";
  const variant = radio.disabled
    ? "outline"
    : radio.pending
      ? "warning"
      : radio.failed
        ? "destructive"
        : radio.up
          ? "success"
          : "outline";
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          {wifiBandLabel(radio.band)} WiFi
          <Badge variant={variant}>{status}</Badge>
        </CardTitle>
        <CardDescription>
          {radio.name} · 配置信道 {radio.channel || "自动"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!radio.interfaces.length && (
          <p className="text-xs text-muted-foreground">暂无运行接口。</p>
        )}
        {radio.interfaces.map((iface, index) => (
          <div key={`${iface.section}-${index}`} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="break-all font-medium">
                {iface.ssid || iface.section || "未命名接口"}
              </span>
              <span className="text-muted-foreground">
                {iface.name || "未启动"} ·{" "}
                {iface.mode === "sta"
                  ? "连接上游"
                  : iface.mode === "ap"
                    ? "无线热点"
                    : iface.mode || "—"}
                {iface.channel ? ` · 信道 ${iface.channel}` : ""}
                {iface.frequency ? ` · ${iface.frequency} MHz` : ""}
              </span>
            </div>
            {iface.warning && <p className="text-xs text-muted-foreground">{iface.warning}</p>}
            {radio.up && iface.name && <StationTable stations={iface.stations} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
