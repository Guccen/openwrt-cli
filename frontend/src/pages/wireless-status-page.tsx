import { useEffect } from "react";
import { RadioCard } from "@/components/wireless/radio-card";
import { ErrorAlert } from "@/components/status/error-alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRouter } from "@/stores/router";
import { useWireless } from "@/stores/wireless";
import { NotFoundPage } from "./not-found-page";

export function WirelessStatusPage() {
  const device = useRouter((state) => state.device);
  const { session, snapshot, load, error } = useWireless();
  useEffect(() => {
    if (session && device?.device === "jdcloud-ax1800") void load();
  }, [device?.device, session, load]);
  if (!device) return <DeviceLoading />;
  if (device.device !== "jdcloud-ax1800") return <NotFoundPage message="此设备未开放无线状态。" />;
  return (
    <div className="space-y-3">
      <ErrorAlert message={error} />
      {!snapshot && !error && <DeviceLoading />}
      {snapshot && !snapshot.radios.length && (
        <Alert>
          <AlertDescription>未检测到无线运行设备。请检查驱动与无线配置。</AlertDescription>
        </Alert>
      )}
      {snapshot?.radios.map((radio) => (
        <RadioCard key={radio.name} radio={radio} />
      ))}
      <p className="text-[11px] text-muted-foreground">
        手动刷新运行状态。协商速率由设备驱动报告，实际传输速度取决于连接环境。
      </p>
    </div>
  );
}
