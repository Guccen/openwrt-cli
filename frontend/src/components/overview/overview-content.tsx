import type { Snapshot } from "@/lib/types";
import { SystemStats } from "./system-stats";
import { DeviceInfoCard } from "./device-info-card";

export function OverviewContent({ snapshot }: { snapshot: Snapshot }) {
  return (
    <>
      <SystemStats info={snapshot.info} />
      <DeviceInfoCard snapshot={snapshot} />
    </>
  );
}
