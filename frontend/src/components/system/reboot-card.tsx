import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ErrorAlert } from "@/components/status/error-alert";
import { loginPath, pageRoutes } from "@/lib/routes";
import { RouterClient, RpcError } from "@/lib/rpc";
import { useRouter } from "@/stores/router";
import { maintenanceClient } from "@/stores/maintenance";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";

const rpc = new RouterClient();
export function RebootCard({ disabled }: { disabled: boolean }) {
  const session = useRouter((state) => state.session);
  const [open, setOpen] = useState(false);
  const waiting = useMaintenanceOperation((state) => state.kind === "reboot");
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!waiting || !session) return;
    let cancelled = false;
    let polling = false;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (polling || cancelled) return;
      if (Date.now() - started > 180000) {
        setExpired(true);
        clearInterval(timer);
        return;
      }
      polling = true;
      try {
        // 重启后原 rpcd 会话失效；只有管理页恢复且会话失效时才返回登录页。
        await rpc.call(session, "system", "info");
      } catch (e) {
        if (e instanceof RpcError && e.sessionExpired) {
          const device = await rpc.device();
          if (!cancelled && device) useRouter.setState({ session: null, snapshot: null });
        }
      } finally {
        polling = false;
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting, session]);
  async function reboot() {
    setOpen(false);
    if (!session || disabled || waiting) return;
    const token = useMaintenanceOperation.getState().begin("reboot");
    if (!token) return;
    setError(null);
    try {
      await maintenanceClient.reboot(session);
    } catch (e) {
      if (useRouter.getState().session !== session) return;
      setError(e instanceof Error ? e.message : "重启请求失败");
      // 响应可能在设备重启时丢失，不自动重发重启请求。
      if (!(e instanceof RpcError && e.code === undefined))
        useMaintenanceOperation.getState().finish(token);
    }
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>重启设备</CardTitle>
        <CardDescription>网络会短暂中断，配置保持不变。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorAlert message={error} />
        {waiting ? (
          <Alert>
            <AlertDescription>
              {expired
                ? "暂未检测到设备重新上线，请检查连接后重新登录。"
                : "已发送重启请求，正在等待设备恢复连接…"}
            </AlertDescription>
          </Alert>
        ) : (
          <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
            <RotateCw />
            重启设备
          </Button>
        )}
        {waiting && (
          <Button asChild variant="outline">
            <Link
              href={`${loginPath}?next=${encodeURIComponent(pageRoutes.system.path)}`}
              onClick={() => useRouter.setState({ session: null, snapshot: null })}
            >
              重新登录
            </Link>
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">
          存在暂存或待确认配置时，设备端会拒绝维护操作。发送后请等待设备恢复，勿重复操作。
        </p>
      </CardContent>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重启设备？</AlertDialogTitle>
            <AlertDialogDescription>
              所有客户端的网络连接会中断，设备恢复后需要重新登录。请先完成配置确认并保存备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void reboot()}>确认重启</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
