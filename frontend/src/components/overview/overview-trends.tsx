import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewSample } from "@/lib/overview-history";

const timeLabel = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
const metrics = [
  {
    key: "load",
    title: "系统负载趋势",
    label: "1 分钟平均负载",
    description: "平均负载不是 CPU 使用率",
    color: "var(--chart-1)",
  },
  {
    key: "memory",
    title: "内存占用趋势",
    label: "内存使用率",
    description: "按可用内存计算 · 单位 %",
    color: "var(--chart-2)",
  },
] as const;

export function OverviewTrends({ history }: { history: OverviewSample[] }) {
  return (
    <section aria-label="运行趋势" className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        每 5 秒自动刷新 · 最近 5 分钟 · 仅保留本次会话样本，页面隐藏时暂停
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {metrics.map((metric) => (
          <Card size="sm" key={metric.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: metric.color }}
                />
                {metric.title}
              </CardTitle>
              <CardDescription>{metric.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{ [metric.key]: { label: metric.label, color: metric.color } }}
                className="h-48 w-full aspect-auto"
                aria-label={`${metric.label}趋势图`}
              >
                <LineChart
                  accessibilityLayer
                  data={history}
                  margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="time"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={timeLabel}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    width={36}
                    domain={metric.key === "memory" ? [0, 100] : [0, "auto"]}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_label, payload) =>
                          timeLabel(Number(payload?.[0]?.payload?.time))
                        }
                      />
                    }
                  />
                  <Line
                    type="linear"
                    dataKey={metric.key}
                    stroke={`var(--color-${metric.key})`}
                    strokeWidth={2.5}
                    dot={history.length < 2}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
              {history.length < 2 && (
                <p className="mt-2 text-[11px] text-muted-foreground">正在收集趋势样本…</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
