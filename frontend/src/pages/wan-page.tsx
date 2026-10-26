import { DeviceLoading } from "@/components/status/device-loading";
import { ErrorAlert } from "@/components/status/error-alert";
import { SettingsSection } from "@/components/settings/settings-section";
import { WanForm } from "@/components/settings/wan-form";
import { wanDraft } from "@/lib/wan-settings";
import { useRouter } from "@/stores/router";
import { NotFoundPage } from "./not-found-page";

export function WanPage() {
  const device = useRouter((state) => state.device);
  if (!device) return <DeviceLoading />;
  if (device.role !== "router")
    return <NotFoundPage message="旁路由通过 LAN 网关上网，不开放独立 WAN 配置。" />;
  return (
    <SettingsSection>
      {(props) => {
        try {
          return <WanForm {...props} initial={wanDraft(props.snapshot)} />;
        } catch (error) {
          return (
            <ErrorAlert message={error instanceof Error ? error.message : "无法读取 WAN 配置"} />
          );
        }
      }}
    </SettingsSection>
  );
}
