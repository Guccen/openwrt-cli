import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Snapshot } from "@/lib/types";

export function DeviceInfoCard({ snapshot }: { snapshot: Snapshot }) {
  const { board } = snapshot;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>设备信息</CardTitle>
        <CardDescription>系统与固件版本</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs break-words sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-x-6">
          <dt className="text-muted-foreground">设备型号</dt>
          <dd>{board.model ?? board.system ?? "未知设备"}</dd>
          <dt className="text-muted-foreground">主机名称</dt>
          <dd>{board.hostname}</dd>
          <dt className="text-muted-foreground">系统版本</dt>
          <dd>
            {board.release.distribution} {board.release.version}
          </dd>
          <dt className="text-muted-foreground">内核版本</dt>
          <dd>{board.kernel}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
