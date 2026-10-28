import { useEffect } from "react";
import { OverviewContent } from "@/components/overview/overview-content";
import { OverviewTrends } from "@/components/overview/overview-trends";
import { DeviceLoading } from "@/components/status/device-loading";
import { useRouter } from "@/stores/router";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
import { useSettings } from "@/stores/settings";
import { startOverviewRefresh } from "@/lib/overview-history";

export function OverviewPage() {
  const snapshot = useRouter((state) => state.snapshot);
  const session = useRouter((state) => state.session);
  const history = useRouter((state) => state.history);
  useEffect(() => {
    if (!session) return;
    return startOverviewRefresh(
      () => useRouter.getState().refresh(),
      () => {
        const router = useRouter.getState();
        const settings = useSettings.getState();
        return (
          !!router.session &&
          !router.loading &&
          !useMaintenanceOperation.getState().kind &&
          !settings.pending &&
          !settings.destination &&
          settings.phase === "idle"
        );
      },
    );
  }, [session]);
  return snapshot ? (
    <OverviewContent snapshot={snapshot}>
      <OverviewTrends history={history} />
    </OverviewContent>
  ) : (
    <DeviceLoading />
  );
}
