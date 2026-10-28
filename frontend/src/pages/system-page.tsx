import { useEffect } from "react";
import { Link } from "wouter";
import { SystemBackupCard } from "@/components/system/system-backup-card";
import { RebootCard } from "@/components/system/reboot-card";
import { RecoveryCard } from "@/components/system/recovery-card";
import { PasswordCard } from "@/components/system/password-card";
import { TimeCard } from "@/components/system/time-card";
import { ErrorAlert } from "@/components/status/error-alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pageRoutes } from "@/lib/routes";
import { useMaintenance } from "@/stores/maintenance";
import { useSettings } from "@/stores/settings";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";

export function SystemPage() {
  const { session, load, snapshot, loading, error } = useMaintenance();
  const {
    pending,
    staged,
    phase,
    loading: checkingSettings,
    destination,
    load: loadSettings,
    snapshot: settingsSnapshot,
    error: settingsError,
  } = useSettings();
  const operation = useMaintenanceOperation((state) => state.kind);
  const localConfigurationBusy = !!pending || staged || !!destination || phase !== "idle";
  useEffect(() => {
    // 刷新页面后仍需读取当前会话的暂存状态，不能只依赖内存中的表单状态。
    if (session) void loadSettings();
  }, [session, loadSettings]);
  useEffect(() => {
    if (session && !localConfigurationBusy && !operation) void load();
  }, [session, load, localConfigurationBusy, operation]);
  const checkingExternalOperation =
    !localConfigurationBusy &&
    !operation &&
    !!(snapshot?.configurationBusy || snapshot?.operationBusy);
  useEffect(() => {
    if (!session || !checkingExternalOperation) return;
    // 仅在当前维护页被设备端事务阻塞时检查，离页或解除阻塞后立即停止。
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 3000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session, load, checkingExternalOperation]);
  const busy = localConfigurationBusy || snapshot?.configurationBusy || snapshot?.operationBusy;
  const disabled =
    !snapshot ||
    !settingsSnapshot ||
    loading ||
    checkingSettings ||
    !!settingsError ||
    !!error ||
    !!busy ||
    !!operation;
  const busyMessage = pending
    ? "网络配置正在等待确认，请先确认保留或恢复原设置。"
    : staged
      ? "当前会话有未应用的网络改动，请前往网络设置查看或丢弃暂存改动。"
      : destination
        ? "请返回配置完成后的管理地址，再继续维护。"
        : localConfigurationBusy
          ? "正在处理网络配置，请等待操作完成。"
          : snapshot?.configurationBusy
            ? "设备仍有暂存或待确认的网络配置，可能来自其他页面。完成或丢弃对应改动后会自动更新状态，失效会话的暂存会自动清理。"
            : "设备正在执行其他维护操作，完成后会自动更新状态。";
  return (
    <div className="space-y-3">
      <ErrorAlert message={error || settingsError} />
      {!snapshot && !error && <DeviceLoading />}
      {busy && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>{busyMessage}</p>
            {staged && !pending && (
              <Button asChild size="sm" variant="outline">
                <Link href={pageRoutes.lan.path}>查看暂存改动</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <PasswordCard disabled={disabled} />
      <TimeCard disabled={disabled} />
      <SystemBackupCard disabled={disabled} />
      <RecoveryCard kind="restore" disabled={disabled} />
      <RecoveryCard
        kind="upgrade"
        supported={snapshot?.upgradeSupported ?? false}
        disabled={disabled}
      />
      <RecoveryCard
        kind="reset"
        supported={snapshot?.resetSupported ?? false}
        disabled={disabled}
      />
      <RebootCard disabled={disabled} />
    </div>
  );
}
