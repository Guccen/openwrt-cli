import { Button } from "@/components/ui/button";
import { useRouter } from "@/stores/router";
import { DeviceLoading } from "./device-loading";
import { ErrorAlert } from "./error-alert";

export function DeviceIdentityStatus() {
  const error = useRouter((state) => state.deviceError);
  const loading = useRouter((state) => state.deviceLoading);
  const retry = useRouter((state) => state.loadDevice);
  if (!error) return <DeviceLoading />;
  return (
    <div className="space-y-3" aria-live="polite">
      <ErrorAlert message={error} />
      <Button variant="outline" disabled={loading} onClick={() => void retry()}>
        重试读取设备信息
      </Button>
    </div>
  );
}
