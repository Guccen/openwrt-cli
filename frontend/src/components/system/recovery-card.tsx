import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { maintenanceClient } from "@/stores/maintenance";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
import { useRouter } from "@/stores/router";
import { RpcError } from "@/lib/rpc";
import type { DestructiveOperation, PreparedUpload } from "@/lib/maintenance-client";

const titles = { restore: "恢复系统配置", upgrade: "升级固件", reset: "恢复出厂设置" };
export function RecoveryCard({
  kind,
  disabled,
  supported = true,
}: {
  kind: DestructiveOperation;
  disabled: boolean;
  supported?: boolean;
}) {
  const session = useRouter((state) => state.session);
  const [file, setFile] = useState<File | null>(null);
  const [checksum, setChecksum] = useState("");
  const [prepared, setPrepared] = useState<PreparedUpload | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const alive = useRef(true);
  const uploaded = useRef<{ session: string; token: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = uploaded.current;
      if (current) void maintenanceClient.cancel(current.session, current.token).catch(() => {});
    };
  }, []);
  async function prepare() {
    if (!session || !file || disabled || !supported) return;
    const operation = useMaintenanceOperation.getState().begin("upload");
    if (!operation) return;
    setError(null);
    setProgress(0);
    try {
      const candidate = await maintenanceClient.prepare(
        session,
        kind as "restore" | "upgrade",
        file,
        checksum,
        (value) => {
          if (alive.current) setProgress(value);
        },
      );
      if (!alive.current || useRouter.getState().session !== session) {
        await maintenanceClient.cancel(session, candidate.token).catch(() => {});
        return;
      }
      uploaded.current = { session, token: candidate.token };
      setPrepared(candidate);
      setConfirmation("");
      setOpen(true);
    } catch (e) {
      if (alive.current && useRouter.getState().session === session)
        setError(e instanceof Error ? e.message : "文件校验失败");
    } finally {
      useMaintenanceOperation.getState().finish(operation);
      if (alive.current) setProgress(null);
    }
  }
  async function close() {
    setOpen(false);
    const current = uploaded.current;
    uploaded.current = null;
    setPrepared(null);
    if (current) {
      try {
        await maintenanceClient.cancel(current.session, current.token);
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : "取消失败，请等待上传过期");
      }
    }
  }
  async function execute() {
    if (
      !session ||
      disabled ||
      !supported ||
      confirmation !== titles[kind] ||
      (kind !== "reset" && !prepared)
    )
      return;
    const operation = useMaintenanceOperation.getState().begin(kind);
    if (!operation) return;
    setError(null);
    setOpen(false);
    try {
      await maintenanceClient.execute(session, kind, prepared?.token);
      uploaded.current = null;
      setPrepared(null);
    } catch (e) {
      if (useRouter.getState().session !== session) return;
      setError(e instanceof Error ? e.message : "维护操作失败");
      // 网络响应可能在重启时丢失，保留互斥状态并提示手动重新连接。
      if (!(e instanceof RpcError && e.code === undefined))
        useMaintenanceOperation.getState().finish(operation);
    }
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{titles[kind]}</CardTitle>
        <CardDescription>
          {kind === "restore"
            ? "上传本项目导出的系统归档，核对设备、模式和固件版本后恢复并重启。"
            : kind === "upgrade"
              ? "上传 AX1800 sysupgrade 镜像，设备校验后刷入，全新配置启动。"
              : "清除 AX1800 的可写配置并重启，恢复当前固件默认值。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-xs text-muted-foreground">
            当前设备或存储布局不支持此操作。N1 请按刷机文档重新写入启动卡，保留旧卡用于回滚。
          </p>
        ) : (
          <>
            {kind !== "reset" && (
              <div className="space-y-2">
                <Label htmlFor={`${kind}-file`}>
                  {kind === "restore" ? "系统配置归档" : "固件镜像"}
                </Label>
                <Input
                  id={`${kind}-file`}
                  type="file"
                  accept={kind === "restore" ? ".tar.gz,.tgz" : ".bin"}
                  disabled={disabled || progress !== null || !!prepared}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setError(null);
                  }}
                />
                {kind === "upgrade" && (
                  <>
                    <Label htmlFor="firmware-sha256">构建产物 SHA-256</Label>
                    <Input
                      id="firmware-sha256"
                      value={checksum}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={disabled || !!prepared}
                      onChange={(event) => setChecksum(event.target.value)}
                      placeholder="填写 sha256sums 中的 64 位校验值"
                    />
                  </>
                )}
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {kind === "restore"
                ? "归档可能覆盖登录密码、SSH 密钥和管理地址；仅恢复可信的同设备、同模式、相同固件版本备份。网页恢复不提供 120 秒回滚。"
                : "操作不可撤销，请先导出备份并记录宽带账号。使用网线连接，操作期间保持供电，完成后按固件默认地址重新登录。"}
            </p>
            <ErrorAlert message={error} />
            <Button
              variant={kind === "reset" ? "destructive" : "outline"}
              disabled={disabled || progress !== null || (kind !== "reset" && !file)}
              onClick={() =>
                kind === "reset" || prepared ? (setConfirmation(""), setOpen(true)) : void prepare()
              }
            >
              {progress !== null
                ? `上传并校验… ${progress}%`
                : kind === "reset"
                  ? titles[kind]
                  : prepared
                    ? "查看校验结果"
                    : "上传并校验"}
            </Button>
          </>
        )}
      </CardContent>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!value) void close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{titles[kind]}？</AlertDialogTitle>
            <AlertDialogDescription>
              设备将断开连接并重启。
              {kind === "restore" ? "登录密码和管理地址可能改变。" : "现有配置将被清除。"}{" "}
              此操作没有自动回滚。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {prepared && (
            <div className="space-y-1 text-xs">
              <p>
                已验证 {prepared.size} 字节{prepared.files ? `，${prepared.files} 个归档成员` : ""}
              </p>
              <p className="break-all font-mono">SHA-256: {prepared.sha256}</p>
            </div>
          )}
          <Label htmlFor={`${kind}-confirmation`}>输入“{titles[kind]}”确认</Label>
          <Input
            id={`${kind}-confirmation`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || confirmation !== titles[kind]}
              onClick={(event) => {
                event.preventDefault();
                void execute();
              }}
            >
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
