import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/status/error-alert";
import { useRouter } from "@/stores/router";
import { maintenanceClient } from "@/stores/maintenance";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";

export function SystemBackupCard({ disabled }: { disabled: boolean }) {
  const { session, device } = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function download() {
    if (!session || disabled || busy) return;
    const token = useMaintenanceOperation.getState().begin("backup");
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const bytes = await maintenanceClient.backup(session);
      if (useRouter.getState().session !== session) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/gzip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${device?.device ?? "openwrt"}-${device?.role ?? "router"}-system-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("系统配置备份已通过 SHA-256 校验并下载。");
    } catch (e) {
      if (useRouter.getState().session === session)
        setError(e instanceof Error ? e.message : "系统备份失败");
    } finally {
      useMaintenanceOperation.getState().finish(token);
      setBusy(false);
    }
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>系统配置备份</CardTitle>
        <CardDescription>导出 OpenWrt 标准 sysupgrade 配置归档，最大 128 KiB。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          包含系统列出的配置文件，可能含设备密码哈希、SSH 私钥和 WiFi
          密钥。请妥善保管，仅用于同设备、相同固件版本恢复。归档不包含完整磁盘、已安装程序或 N1
          引导分区。
        </p>
        <ErrorAlert message={error} />
        <Button disabled={disabled || busy} onClick={() => void download()}>
          <Download />
          {busy ? "正在生成…" : "导出系统配置"}
        </Button>
        {notice && <output className="block text-xs text-muted-foreground">{notice}</output>}
        <p className="text-[11px] text-muted-foreground">
          网页恢复需要本项目新版导出的归档；旧归档或含链接的自定义归档请通过 SSH 检查后恢复。
        </p>
      </CardContent>
    </Card>
  );
}
