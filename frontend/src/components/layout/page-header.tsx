import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageRoutes, type Page } from "@/lib/routes";
import { useRouter } from "@/stores/router";
import { useSettings } from "@/stores/settings";
import { useWireless } from "@/stores/wireless";
import { useMaintenance } from "@/stores/maintenance";
import { useLeds } from "@/stores/leds";
import { useSchedule } from "@/stores/schedule";
import { useClients } from "@/stores/clients";

export function PageHeader({ page }: { page: Page | null }) {
  const { device, snapshot, loading, refresh } = useRouter();
  const settings = useSettings();
  const wireless = useWireless();
  const maintenance = useMaintenance();
  const leds = useLeds();
  const schedule = useSchedule();
  const clients = useClients();
  const busy =
    loading ||
    settings.loading ||
    wireless.loading ||
    maintenance.loading ||
    leds.loading ||
    schedule.loading ||
    clients.loading;
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
          if (page === "wirelessStatus") void wireless.load();
          else if (page === "clients") void clients.load();
          else if (page === "leds") void leds.load();
          else if (page === "schedule") void schedule.load();
          else if (page === "system") {
            void settings.load();
            void maintenance.load();
          } else if (page && pageRoutes[page].settings) {
            void settings.load();
            if (page === "ipv6") void refresh();
          } else void refresh();
        }}
      >
        <RefreshCw className={busy ? "animate-spin" : ""} />
        刷新
      </Button>
    </div>
  );
}
