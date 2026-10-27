import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { ErrorAlert } from "@/components/status/error-alert";
import { leaseRemaining } from "@/lib/status";
import { useClients } from "@/stores/clients";
import { useRouter } from "@/stores/router";

export function ClientsPage() {
  const { session, snapshot, load, error } = useClients();
  const device = useRouter((state) => state.device);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  return (
    <div className="space-y-3">
      <ErrorAlert message={error} />
      {!snapshot && !error && <DeviceLoading />}
      <Alert>
        <AlertDescription>
          DHCP 租约表示分配记录，不代表设备当前在线。静态地址及 IPv6 SLAAC 客户端可能不在列表中。
          {device?.role === "bypass" && "旁路由通常不负责分配地址，请到主路由查看完整租约。"}
        </AlertDescription>
      </Alert>
      {snapshot && (
        <>
          {snapshot.limited && (
            <Alert>
              <AlertDescription>租约文件超过读取上限，IPv4 列表暂不可用。</AlertDescription>
            </Alert>
          )}
          <Card size="sm">
            <CardHeader>
              <CardTitle>IPv4 DHCP 租约 · {snapshot.ipv4.length}</CardTitle>
              <CardDescription>
                显示未到期记录，最多 {snapshot.limit} 条；剩余租期以读取时为准
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>主机名</TableHead>
                    <TableHead>IPv4 地址</TableHead>
                    <TableHead>MAC 地址</TableHead>
                    <TableHead>剩余租期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.ipv4.map((lease) => (
                    <TableRow key={`${lease.mac}-${lease.address}`}>
                      <TableCell className="max-w-48 break-all whitespace-normal">
                        {lease.hostname || "未提供"}
                      </TableCell>
                      <TableCell>{lease.address}</TableCell>
                      <TableCell className="font-mono text-[11px]">{lease.mac}</TableCell>
                      <TableCell>{leaseRemaining(lease.remaining)}</TableCell>
                    </TableRow>
                  ))}
                  {!snapshot.ipv4.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        {snapshot.ipv4Available
                          ? "暂无 IPv4 DHCP 租约"
                          : "IPv4 租约来源暂不可用，或本机未启用 DHCP 服务。"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>IPv6 DHCP 租约 · {snapshot.ipv6.length}</CardTitle>
              <CardDescription>
                显示已绑定的地址及委派前缀，最多 {snapshot.limit} 条；剩余租期以读取时为准
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>主机 / 接口</TableHead>
                    <TableHead>IPv6 地址 / 前缀</TableHead>
                    <TableHead>DUID</TableHead>
                    <TableHead>剩余租期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.ipv6.map((lease, index) => (
                    <TableRow key={`${lease.device}-${lease.duid}-${index}`}>
                      <TableCell className="max-w-48 break-all whitespace-normal">
                        {lease.hostname || "未提供"}
                        <div className="text-[11px] text-muted-foreground">{lease.device}</div>
                      </TableCell>
                      <TableCell className="max-w-72 break-all whitespace-normal font-mono text-[11px]">
                        {lease.addresses.map((address) => (
                          <div key={address}>{address}</div>
                        ))}
                      </TableCell>
                      <TableCell className="max-w-48 break-all whitespace-normal font-mono text-[11px]">
                        {lease.duid}
                      </TableCell>
                      <TableCell>{leaseRemaining(lease.remaining)}</TableCell>
                    </TableRow>
                  ))}
                  {!snapshot.ipv6.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        {snapshot.ipv6Available
                          ? "暂无 IPv6 DHCP 租约"
                          : "IPv6 租约服务暂不可用或未启用。"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
