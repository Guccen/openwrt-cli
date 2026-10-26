import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Snapshot } from "@/lib/types";

export function NetworkTable({ snapshot }: { snapshot: Snapshot }) {
  const interfaces = snapshot.interfaces.filter((item) => item.interface !== "loopback");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>接口</TableHead>
          <TableHead>连接</TableHead>
          <TableHead>协议</TableHead>
          <TableHead>地址</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {interfaces.length ? (
          interfaces.map((item) => (
            <TableRow key={item.interface}>
              <TableCell className="font-medium">
                {item.interface}
                <div className="text-[11px] text-muted-foreground">
                  {item.l3_device ?? item.device ?? "—"}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={item.up ? "secondary" : "outline"}>
                  {item.up ? "已连接" : "未连接"}
                </Badge>
              </TableCell>
              <TableCell className="uppercase">{item.proto}</TableCell>
              <TableCell className="font-mono text-[11px]">
                {[...(item["ipv4-address"] ?? []), ...(item["ipv6-address"] ?? [])].map(
                  (address) => (
                    <div key={address.address}>
                      {address.address}/{address.mask}
                    </div>
                  ),
                )}
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
              暂无网络接口
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
