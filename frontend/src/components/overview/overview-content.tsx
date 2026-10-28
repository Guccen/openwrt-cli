import type { ReactNode } from "react";
import type { Snapshot } from "@/lib/types";
import { SystemStats } from "./system-stats";
import { DeviceInfoCard } from "./device-info-card";
import { HealthCard } from "./health-card";
import { StorageDevicesCard } from "./storage-devices-card";
import { UpstreamCard } from "@/components/network/upstream-card";
import { ErrorAlert } from "@/components/status/error-alert";

export function OverviewContent({
  snapshot,
  children,
}: {
  snapshot: Snapshot;
  children?: ReactNode;
}) {
  return (
    <>
      <SystemStats info={snapshot.info} />
      {children}
      <ErrorAlert message={snapshot.telemetryError ?? null} />
      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <DeviceInfoCard snapshot={snapshot} />
        {snapshot.telemetry && <HealthCard telemetry={snapshot.telemetry} />}
      </div>
      <StorageDevicesCard disks={snapshot.telemetry?.blockDisks ?? []} />
      <UpstreamCard snapshot={snapshot} />
    </>
  );
}
