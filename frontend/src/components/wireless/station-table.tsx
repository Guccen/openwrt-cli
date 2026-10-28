import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WirelessStation } from "@/lib/wireless-client";
import { uptime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const rate = (value: number | null) => (value ? `${(value / 1000).toFixed(1)} Mbps` : "—");
export function StationTable({ stations }: { stations: WirelessStation[] | null }) {
  if (stations === null)
    return <p className="text-xs text-muted-foreground">连接设备列表暂不可用。</p>;
  if (!stations.length)
    return <p className="text-xs text-muted-foreground">当前没有连接的无线设备。</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>设备 MAC</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>信号</TableHead>
          <TableHead>接收 / 发送协商速率</TableHead>
          <TableHead>连接时长</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {stations.map((item, index) => (
          <TableRow key={`${item.mac}-${index}`}>
            <TableCell className="font-mono text-xs">{item.mac || "—"}</TableCell>
            <TableCell>
              {item.authorized === null ? (
                "—"
              ) : (
                <Badge variant={item.authorized ? "success" : "warning"}>
                  {item.authorized ? "已授权" : "待授权"}
                </Badge>
              )}
            </TableCell>
            <TableCell>{item.signal === null ? "—" : `${item.signal} dBm`}</TableCell>
            <TableCell>
              {rate(item.rx)} / {rate(item.tx)}
            </TableCell>
            <TableCell>{item.connected === null ? "—" : uptime(item.connected)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
