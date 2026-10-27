import { useEffect } from "react";
import { SystemBackupCard } from "@/components/system/system-backup-card";
import { RebootCard } from "@/components/system/reboot-card";
import { RecoveryCard } from "@/components/system/recovery-card";
import { ErrorAlert } from "@/components/status/error-alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMaintenance } from "@/stores/maintenance";
import { useSettings } from "@/stores/settings";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";

export function SystemPage() {
  const { session, load, snapshot, loading, error } = useMaintenance();
  const { pending, staged, loading: applying, destination } = useSettings();
  const operation = useMaintenanceOperation((state) => state.kind);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  const busy =
    !!pending ||
    staged ||
    applying ||
    !!destination ||
    snapshot?.configurationBusy ||
    snapshot?.operationBusy;
  return (
    <div className="space-y-3">
      <ErrorAlert message={error} />
      {!snapshot && !error && <DeviceLoading />}
      {busy && (
        <Alert>
          <AlertDescription>请先完成或丢弃网络配置，等待其他维护操作结束后刷新。</AlertDescription>
        </Alert>
      )}
      <SystemBackupCard disabled={!snapshot || loading || !!busy || !!operation} />
      <RecoveryCard kind="restore" disabled={!snapshot || loading || !!busy || !!operation} />
      <RecoveryCard
        kind="upgrade"
        supported={snapshot?.upgradeSupported ?? false}
        disabled={!snapshot || loading || !!busy || !!operation}
      />
      <RecoveryCard
        kind="reset"
        supported={snapshot?.resetSupported ?? false}
        disabled={!snapshot || loading || !!busy || !!operation}
      />
      <RebootCard disabled={!snapshot || loading || !!busy || !!operation} />
    </div>
  );
}
