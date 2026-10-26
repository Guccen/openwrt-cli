import { NetworkTable } from "@/components/network/network-table";
import { DeviceLoading } from "@/components/status/device-loading";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/stores/router";

export function NetworkPage() {
  const snapshot = useRouter((state) => state.snapshot);
  return snapshot ? (
    <Card size="sm">
      <CardHeader>
        <CardTitle>网络接口</CardTitle>
        <CardDescription>当前连接及地址</CardDescription>
      </CardHeader>
      <CardContent>
        <NetworkTable snapshot={snapshot} />
      </CardContent>
    </Card>
  ) : (
    <DeviceLoading />
  );
}
