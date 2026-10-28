import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bytes } from "@/lib/format";
import type { Telemetry } from "@/lib/types";

export function PortsCard({ ports }: { ports: Telemetry["ports"] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>网口状态</CardTitle>
        <CardDescription>由驱动枚举的以太网设备；累计流量自接口初始化起统计</CardDescription>
      </CardHeader>
      <CardContent>
        {!ports.length && (
          <p className="text-xs text-muted-foreground">未检测到可读取的以太网设备。</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ports.map((port) => (
            <div key={port.name} className="min-w-0 rounded-lg border p-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium break-all">{port.name}</span>
                <Badge variant={port.link ? "success" : "outline"}>
                  {port.link === null ? "未知" : port.link ? "已连接" : "未连接"}
                </Badge>
              </div>
              <p className="tabular-nums">
                {port.speed === null ? "速率未报告" : `${port.speed} Mbps`}
                {port.duplex === "full" ? " · 全双工" : port.duplex === "half" ? " · 半双工" : ""}
              </p>
              <p className="break-all text-muted-foreground">{port.mac || "MAC 未报告"}</p>
              <div className="flex flex-wrap justify-between gap-1 tabular-nums">
                <span>接收 {port.rx === null ? "—" : bytes(port.rx)}</span>
                <span>发送 {port.tx === null ? "—" : bytes(port.tx)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
