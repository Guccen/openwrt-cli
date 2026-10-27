import { useEffect } from "react";
import { SettingsSection } from "@/components/settings/settings-section";
import { Ipv6Form } from "@/components/settings/ipv6-form";
import { ErrorAlert } from "@/components/status/error-alert";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeviceLoading } from "@/components/status/device-loading";
import { UpstreamCard } from "@/components/network/upstream-card";
import { ipv6Draft, ipv6Number } from "@/lib/ipv6-settings";
import { defaultRoutes } from "@/lib/status";
import { useRouter } from "@/stores/router";

export function Ipv6Page() {
  const { device, snapshot, refresh } = useRouter();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!device) return <DeviceLoading />;
  const bypass = device.role === "bypass";
  const uplink = snapshot?.interfaces.find((item) => item.interface === (bypass ? "lan6" : "wan6"));
  const address = uplink?.["ipv6-address"]?.some((item) => {
    const n = ipv6Number(item.address);
    return n !== null && n > 1n && n >> 118n !== 1018n;
  });
  const route = uplink && defaultRoutes(uplink).some((item) => item.target === "::");
  return (
    <div className="space-y-3">
      <SettingsSection>
        {(props) => {
          try {
            return (
              <Ipv6Form {...props} initial={ipv6Draft(props.snapshot, bypass)} bypass={bypass} />
            );
          } catch (error) {
            return (
              <ErrorAlert message={error instanceof Error ? error.message : "无法读取 IPv6 配置"} />
            );
          }
        }}
      </SettingsSection>
      <Alert>
        <AlertDescription>
          {!uplink?.up
            ? "IPv6 接口尚未连接。请检查上网方式、光猫及上游 IPv6 服务。"
            : !address
              ? "尚未获取可用的 IPv6 地址，请检查上游地址分配。"
              : !route
                ? "已获取 IPv6 地址，但没有默认 IPv6 路由。"
                : !bypass && !uplink["ipv6-prefix"]?.length
                  ? "已获取上游地址和默认路由；若使用自动分配且 LAN 无法上网，请检查前缀委派，或确认上游是否要求中继。"
                  : "已获取上游 IPv6 地址及默认路由；仍需通过连通性诊断确认外网可达。"}
        </AlertDescription>
      </Alert>
      {snapshot && <UpstreamCard snapshot={snapshot} />}
    </div>
  );
}
