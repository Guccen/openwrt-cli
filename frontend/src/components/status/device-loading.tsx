import { Skeleton } from "@/components/ui/skeleton";

export function DeviceLoading() {
  return (
    <div className="space-y-3" aria-label="正在读取设备状态">
      <Skeleton className="h-28" />
      <Skeleton className="h-60" />
    </div>
  );
}
