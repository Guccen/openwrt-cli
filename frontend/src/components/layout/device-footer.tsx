import { CircleCheck } from "lucide-react";
import { useRouter } from "@/stores/router";

export function DeviceFooter() {
  const snapshot = useRouter((state) => state.snapshot);
  return (
    <footer className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <CircleCheck className="size-3" />
      {snapshot
        ? `更新于 ${new Date(snapshot.updatedAt).toLocaleTimeString("zh-CN")}`
        : "等待设备状态"}
      <span className="ml-auto">手动刷新 · 按需读取</span>
    </footer>
  );
}
