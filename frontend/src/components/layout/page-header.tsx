import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageRoutes, type Page } from "@/lib/routes";
import { useRouter } from "@/stores/router";
import { useSettings } from "@/stores/settings";

export function PageHeader({ page }: { page: Page | null }) {
  const { device, snapshot, loading, refresh } = useRouter();
  const settings = useSettings();
  const busy = loading || settings.loading;
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="text-base font-semibold">{page ? pageRoutes[page].title : "页面未找到"}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {device?.model ?? snapshot?.board.model ?? "设备状态"}
        </p>
      </div>
      <Button
        variant="outline"
        disabled={busy || !!settings.pending || !!settings.destination}
        onClick={() => {
          if (page && pageRoutes[page].settings) void settings.load();
          else void refresh();
        }}
      >
        <RefreshCw className={busy ? "animate-spin" : ""} />
        刷新
      </Button>
    </div>
  );
}
