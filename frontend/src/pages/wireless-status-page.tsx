import { useEffect } from "react";
import { RadioCard } from "@/components/wireless/radio-card";
import { ErrorAlert } from "@/components/status/error-alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRouter } from "@/stores/router";
import { useWireless } from "@/stores/wireless";

export function WirelessStatusPage() {
  const device = useRouter((state) => state.device);
  const { session, snapshot, load, cancel, error } = useWireless();
  useEffect(() => {
    if (session && device) void load();
    return cancel;
  }, [device, session, load, cancel]);
  if (!device) return <DeviceLoading />;
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
        手动刷新运行状态。信号是路由器接收到的客户端信号，可能与手机显示不同；信噪比仅在驱动同时提供有效信号和底噪时显示。协商速率不等于实际传输速度，底噪不代表信道占用率。
      </p>
    </div>
  );
}
