import { DeviceLoading } from "@/components/status/device-loading";
import { ErrorAlert } from "@/components/status/error-alert";
import { SettingsSection } from "@/components/settings/settings-section";
import { DhcpForm } from "@/components/settings/dhcp-form";
import { dhcpDraft } from "@/lib/dhcp-settings";
import { useRouter } from "@/stores/router";
import { NotFoundPage } from "./not-found-page";

export function DhcpPage() {
  const device = useRouter((state) => state.device);
  if (!device) return <DeviceLoading />;
  if (device.role !== "router")
    return <NotFoundPage message="旁路由不开放 DHCP 地址分配，请使用主路由的 DHCP 服务。" />;
  return (
    <SettingsSection>
      {(props) => {
        try {
          return <DhcpForm {...props} initial={dhcpDraft(props.snapshot)} />;
        } catch (error) {
          return (
            <ErrorAlert message={error instanceof Error ? error.message : "无法读取 DHCP 配置"} />
          );
        }
      }}
    </SettingsSection>
  );
}
