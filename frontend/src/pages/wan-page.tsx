import { DeviceLoading } from "@/components/status/device-loading";
import { ErrorAlert } from "@/components/status/error-alert";
import { SettingsSection } from "@/components/settings/settings-section";
import { WanForm } from "@/components/settings/wan-form";
import { WanLinkForm } from "@/components/settings/wan-link-form";
import { wanLinkDraft } from "@/lib/wan-link";
import { wanDraft, wirelessWan } from "@/lib/wan-settings";
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
          let link;
          try {
            link = wirelessWan(props.snapshot) ? (
              <p className="text-xs text-muted-foreground">
                无线 WAN 的名称、密码和频段请在无线设置管理。
              </p>
            ) : (
              <WanLinkForm {...props} initial={wanLinkDraft(props.snapshot)} />
            );
          } catch (error) {
            link = (
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "链路参数不可用"}
              </p>
            );
          }
          return (
            <div className="space-y-3">
              <WanForm {...props} initial={wanDraft(props.snapshot)} />
              {link}
            </div>
          );
        } catch (error) {
          return (
            <ErrorAlert message={error instanceof Error ? error.message : "无法读取 WAN 配置"} />
          );
        }
      }}
    </SettingsSection>
  );
}
