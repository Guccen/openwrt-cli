import { OverviewContent } from "@/components/overview/overview-content";
import { DeviceLoading } from "@/components/status/device-loading";
import { useRouter } from "@/stores/router";

export function OverviewPage() {
  const snapshot = useRouter((state) => state.snapshot);
  return snapshot ? <OverviewContent snapshot={snapshot} /> : <DeviceLoading />;
}
