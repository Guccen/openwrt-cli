import { SettingsSection } from "@/components/settings/settings-section";
import { WifiForm } from "@/components/settings/wifi-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { wifiDrafts } from "@/lib/settings";
import { useRouter } from "@/stores/router";
import { NotFoundPage } from "./not-found-page";

export function WirelessPage() {
  const device = useRouter((state) => state.device);
  if (!device) return <DeviceLoading />;
  if (device.device !== "jdcloud-ax1800") return <NotFoundPage message="此设备未开放无线设置。" />;
  return (
    <SettingsSection>
      {(props) => {
        const radios = wifiDrafts(props.snapshot);
        return radios.length ? (
          <div className="space-y-3">
            {radios.map((radio) => (
              <WifiForm key={radio.section} {...props} initial={radio} />
            ))}
          </div>
        ) : (
          <Alert>
            <AlertDescription>
              未检测到无线接口。请确认 WiFi 驱动和设备配置已正确加载。
            </AlertDescription>
          </Alert>
        );
      }}
    </SettingsSection>
  );
}
