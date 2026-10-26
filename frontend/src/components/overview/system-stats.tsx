import { Activity, Cpu, Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { bytes, memoryUsage, uptime } from "@/lib/format";
import type { SystemInfo } from "@/lib/types";

export function SystemStats({ info }: { info: SystemInfo }) {
  const memory = memoryUsage(info.memory);
  const stats = [
    { label: "运行时间", value: uptime(info.uptime), icon: Activity, detail: "自上次启动" },
    {
      label: "内存使用",
      value: `${memory.percent}%`,
      icon: Cpu,
      detail: `${bytes(memory.used)} / ${bytes(info.memory.total)}`,
    },
    {
      label: "系统负载",
      value: (info.load ?? []).map((value) => (value / 65536).toFixed(2)).join(" / "),
      icon: Globe,
      detail: "1 / 5 / 15 分钟平均负载",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {stats.map(({ label, value, icon: Icon, detail }) => (
        <Card size="sm" key={label}>
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              {label}
              <Icon className="size-3.5" aria-hidden="true" />
            </CardDescription>
            <CardTitle className="pt-1 text-lg tabular-nums">{value || "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] text-muted-foreground">{detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
