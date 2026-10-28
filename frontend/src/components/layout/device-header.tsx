import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useRouter } from "@/stores/router";

export function DeviceHeader() {
  const { device, snapshot } = useRouter();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
      <SidebarTrigger className="-ml-2 size-8 [&_svg]:size-4!" aria-label="切换菜单" />
      <Separator orientation="vertical" className="h-4! self-center!" />
      <span className="truncate text-xs text-muted-foreground">
        {device?.model ?? snapshot?.board.model ?? "设备控制台"}
      </span>
      <Badge
        variant={device?.role === "bypass" ? "secondary" : "default"}
        className="ml-auto shrink-0"
      >
        {device?.role === "bypass" ? "旁路由" : "主路由"}
      </Badge>
    </header>
  );
}
