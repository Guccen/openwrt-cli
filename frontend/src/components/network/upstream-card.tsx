import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { uptime } from "@/lib/format";
import { defaultRoutes, upstreamInterfaces } from "@/lib/status";
import type { Snapshot } from "@/lib/types";

export function UpstreamCard({ snapshot }: { snapshot: Snapshot }) {
  const upstreams = upstreamInterfaces(snapshot.interfaces);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>上游网络</CardTitle>
        <CardDescription>WAN 及承载默认路由的接口；连接状态由设备报告</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {!upstreams.length && <p className="text-muted-foreground">未检测到 WAN 或默认路由。</p>}
        {!!upstreams.length && (
          <div className={upstreams.length > 1 ? "grid gap-3 md:grid-cols-2" : "space-y-3"}>
            {upstreams.map((iface) => (
              <div key={iface.interface} className="min-w-0 space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{iface.interface}</span>
                  <Badge variant={iface.up ? "success" : "warning"}>
                    {iface.up ? "接口已连接" : "接口未连接"}
                  </Badge>
                  <span className="text-muted-foreground">
                    {iface.proto.toUpperCase()} · {iface.l3_device ?? iface.device ?? "—"}
                  </span>
                </div>
                <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 break-all lg:grid-cols-[64px_minmax(0,1fr)_64px_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">IPv4</dt>
                  <dd>
                    {(iface["ipv4-address"] ?? [])
                      .map((a) => `${a.address}/${a.mask}`)
                      .join("、") || "暂无地址"}
                  </dd>
                  <dt className="text-muted-foreground">IPv6</dt>
                  <dd>
                    {(iface["ipv6-address"] ?? [])
                      .map((a) => `${a.address}/${a.mask}`)
                      .join("、") || "暂无地址"}
                  </dd>
                  {!!iface["ipv6-prefix"]?.length && (
                    <>
                      <dt className="text-muted-foreground">IPv6 前缀</dt>
                      <dd>
                        {iface["ipv6-prefix"].map((a) => `${a.address}/${a.mask}`).join("、")}
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">网关</dt>
                  <dd>
                    {defaultRoutes(iface)
                      .map((r) => r.nexthop || "直连")
                      .join("、") || "暂无默认路由"}
                  </dd>
                  <dt className="text-muted-foreground">DNS</dt>
                  <dd>{iface["dns-server"]?.join("、") || "未报告"}</dd>
                  {iface.up && iface.uptime !== undefined && (
                    <>
                      <dt className="text-muted-foreground">连接时长</dt>
                      <dd>{uptime(iface.uptime)}</dd>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          接口连接与默认路由不代表互联网一定可达。
        </p>
      </CardContent>
    </Card>
  );
}
