import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { memoryUsage } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

export function DeviceInfoCard({ snapshot }: { snapshot: Snapshot }) {
  const { board, info } = snapshot;
  const memory = memoryUsage(info.memory);
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
        <Separator className="my-4" />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">内存占用</span>
          <span>{memory.percent}%</span>
        </div>
        <Progress value={memory.percent} aria-label="内存占用" className="mt-2 h-1" />
      </CardContent>
    </Card>
  );
}
