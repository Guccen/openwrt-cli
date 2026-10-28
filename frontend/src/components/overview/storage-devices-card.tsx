import { Card, CardContent } from "@/components/ui/card";
import { bytes } from "@/lib/format";
import type { Telemetry } from "@/lib/types";

export function StorageDevicesCard({ disks }: { disks: NonNullable<Telemetry["blockDisks"]> }) {
  if (!disks.length) return null;

  return (
    <Card size="sm">
      <CardContent className="text-xs">
        <details>
          <summary className="cursor-pointer font-medium">整盘与分区容量</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {disks.map((disk) => (
              <div key={disk.device} className="min-w-0 space-y-1 break-words">
                <p className="font-medium">
                  {disk.system ? "系统磁盘" : "磁盘"} {disk.device}
                </p>
                <p className="text-muted-foreground">
                  整盘 {bytes(disk.total)}
                  {disk.partitioned !== null && ` · 已分区 ${bytes(disk.partitioned)}`}
                  {disk.unallocated !== null && ` · 尾部未分配 ${bytes(disk.unallocated)}`}
                </p>
                {disk.system && (disk.unallocated ?? 0) > 512 * 1024 * 1024 && (
                  <p className="leading-relaxed text-amber-700 dark:text-amber-400">
                    当前系统分区只使用了磁盘的一部分。剩余空间可在备份后扩容，或另建数据分区；不属于上方文件系统的可用容量。
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
