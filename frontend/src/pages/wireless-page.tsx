import { SettingsSection } from "@/components/settings/settings-section";
import { WifiForm } from "@/components/settings/wifi-form";
import { RadioForm } from "@/components/settings/radio-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { wifiDrafts } from "@/lib/settings";
import { radioDraft } from "@/lib/radio-settings";
import { useRouter } from "@/stores/router";
import { n1Topology } from "@/lib/n1-wireless";

export function WirelessPage() {
  const device = useRouter((state) => state.device);
  if (!device) return <DeviceLoading />;
  return (
    <SettingsSection>
      {(props) => {
        const n1 = device.device === "phicomm-n1";
        const radios = wifiDrafts(props.snapshot, n1);
        if (n1 && radios.length) {
          try {
            n1Topology(props.snapshot, device);
          } catch (error) {
            return (
              <Alert>
                <AlertDescription>
                  {error instanceof Error ? error.message : "无线配置不可用"}
                </AlertDescription>
              </Alert>
            );
          }
        }
        return radios.length ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              按频段分别设置名称和密码，每次只应用当前无线网络。
            </p>
            <div className="grid gap-3 xl:grid-cols-2">
              {radios.map((radio) => (
                <WifiForm
                  key={radio.section}
                  {...props}
                  initial={radio}
                  n1={n1 ? device : undefined}
                />
              ))}
            </div>
            {[...new Set(radios.map((radio) => radio.device))].map((section) => {
              try {
                radioDraft(props.snapshot, section);
                return <RadioForm key={section} {...props} section={section} singleRadio={n1} />;
              } catch (error) {
                return (
                  <p className="text-xs text-muted-foreground" key={section}>
                    {section}：{error instanceof Error ? error.message : "射频配置不可用"}
                  </p>
                );
              }
            })}
          </div>
        ) : (
          <Alert>
            <AlertDescription>
              未检测到无线接口。请确认 WiFi 驱动和设备配置已正确加载。旧版 N1
              镜像需要刷入包含无线支持的新镜像。
            </AlertDescription>
          </Alert>
        );
      }}
    </SettingsSection>
  );
}
