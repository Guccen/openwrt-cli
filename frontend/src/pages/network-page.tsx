import { NetworkTable } from "@/components/network/network-table";
import { DeviceLoading } from "@/components/status/device-loading";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/stores/router";
import { PortsCard } from "@/components/network/ports-card";
import { UpstreamCard } from "@/components/network/upstream-card";
import { ErrorAlert } from "@/components/status/error-alert";

export function NetworkPage() {
  const snapshot = useRouter((state) => state.snapshot);
  return snapshot ? (
    <div className="space-y-3">
      <ErrorAlert message={snapshot.telemetryError ?? null} />
      {snapshot.telemetry && <PortsCard ports={snapshot.telemetry.ports} />}
      <UpstreamCard snapshot={snapshot} />
      <Card size="sm">
        <CardHeader>
          <CardTitle>网络接口</CardTitle>
          <CardDescription>当前连接及地址</CardDescription>
        </CardHeader>
        <CardContent>
          <NetworkTable snapshot={snapshot} />
        </CardContent>
      </Card>
    </div>
  ) : (
    <DeviceLoading />
  );
}
