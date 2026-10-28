import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BACKUP_LIMIT,
  createBackup,
  parseBackup,
  restoreBackup,
  type NetworkBackup,
} from "@/lib/backup";
import type { ConfigPlan, SettingsSnapshot } from "@/lib/settings";
import { useRouter } from "@/stores/router";
import { notify } from "@/lib/notifications";

export function BackupForm({
  snapshot,
  disabled,
  review,
}: {
  snapshot: SettingsSnapshot;
  disabled: boolean;
  review: (makePlan: () => ConfigPlan) => void;
}) {
  const device = useRouter((state) => state.device);
  const interfaces = useRouter((state) => state.snapshot?.interfaces) ?? [];
  const [backup, setBackup] = useState<NetworkBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const reads = useRef(0);
  useEffect(
    () => () => {
      ++reads.current;
    },
    [],
  );
  const locked = disabled || reading || !device;
  let preview: ReturnType<typeof restoreBackup> | null = null;
  let previewError: string | null = null;
  try {
    if (backup && device) preview = restoreBackup(snapshot, backup, device, interfaces);
  } catch (e) {
    previewError = e instanceof Error ? e.message : "当前配置已变化，请重新读取备份";
  }

  function download() {
    if (!device || locked) return;
    notify.dismiss("network-backup");
    try {
      const value = createBackup(snapshot, device);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${device.device}-${device.role}-network-${value.createdAt.slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(null);
      if (value.omittedWireless.length)
        notify.warning(
          "network-backup",
          "已发起网络备份下载",
          `未包含的高级无线接口：${value.omittedWireless.join("、")}。`,
        );
      else
        notify.success("network-backup", "已发起网络备份下载", "备份包含 WiFi 密钥，请妥善保管。");
    } catch (e) {
      notify.error("network-backup", e, "无法导出备份");
    }
  }

  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !device || disabled) return;
    const request = ++reads.current;
    setBackup(null);
    setError(null);
    setReading(true);
    try {
      if (file.size > BACKUP_LIMIT) throw new Error("备份文件不能超过 64 KiB");
      const value = parseBackup(await file.text(), device);
      restoreBackup(snapshot, value, device, interfaces);
      if (request === reads.current) setBackup(value);
    } catch (e) {
      if (request === reads.current) setError(e instanceof Error ? e.message : "无法读取备份");
    } finally {
      if (request === reads.current) setReading(false);
    }
  }

  return (
    <div className="space-y-3">
      {(error || previewError) && (
        <Alert variant="destructive">
          <AlertDescription>{error || previewError}</AlertDescription>
        </Alert>
      )}
      <Card size="sm">
        <CardHeader>
          <CardTitle>网络设置备份</CardTitle>
          <CardDescription>
            保存 LAN、DHCP 地址池、上游 DNS 和支持的无线 AP 设置，文件下载到当前客户端。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            备份包含明文 WiFi 密钥，请妥善保存。不包含 WAN、宽带账号、SSH
            密钥、设备登录密码和其他系统设置。
          </p>
          <Button disabled={locked} onClick={download}>
            <Download />
            导出备份
          </Button>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>从备份恢复</CardTitle>
          <CardDescription>
            选择相同设备型号和运行模式的 JSON 备份，检查变更后再应用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-lg space-y-1.5">
            <Label htmlFor="network-backup">备份文件</Label>
            <Input
              id="network-backup"
              type="file"
              accept=".json,application/json"
              disabled={locked}
              onChange={(event) => void select(event)}
            />
            <p className="text-[11px] text-muted-foreground">
              最大 64 KiB，仅在当前浏览器中读取。{reading && "正在读取…"}
            </p>
          </div>
          {backup && preview && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                备份于 {new Date(backup.createdAt).toLocaleString("zh-CN")} ·{" "}
                {backup.role === "bypass" ? "旁路由" : "主路由"}
              </p>
              {backup.omittedWireless.length > 0 && (
                <Alert>
                  <AlertDescription>
                    此备份未包含的高级无线接口：{backup.omittedWireless.join("、")}
                    。这些接口将保留当前设置。
                  </AlertDescription>
                </Alert>
              )}
              {preview.changes.length ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>设置</TableHead>
                        <TableHead>当前</TableHead>
                        <TableHead>恢复为</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.changes.map((change) => (
                        <TableRow key={change.label}>
                          <TableCell className="font-medium">{change.label}</TableCell>
                          <TableCell className="max-w-56 whitespace-normal break-all">
                            {change.before || "—"}
                          </TableCell>
                          <TableCell className="max-w-56 whitespace-normal break-all">
                            {change.after || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="text-[11px] text-muted-foreground">
                    恢复后需在 120 秒内确认连接，未确认由设备自动回滚。WiFi 密钥不会在预览中展示。
                  </p>
                  <Button
                    disabled={locked}
                    onClick={() =>
                      review(() => restoreBackup(snapshot, backup, device!, interfaces).plan)
                    }
                  >
                    <Upload />
                    恢复这些设置
                  </Button>
                </>
              ) : (
                <Alert>
                  <AlertDescription>备份与当前设置一致，无需恢复。</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
