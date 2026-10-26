import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { openApplyAddress, notifyApplyComplete } from "@/lib/apply-handoff";
import { useSettings } from "@/stores/settings";

export function ApplyStatus() {
  const {
    pending,
    loading,
    phase,
    reachable,
    probe,
    confirm,
    rollback,
    error,
    notice,
    destination,
  } = useSettings();
  const [now, setNow] = useState(Date.now);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const clock = setInterval(() => setNow(Date.now()), 500);
    const poll = setInterval(() => void probe(), 2000);
    void probe();
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [pending, probe]);
  if (!pending)
    return notice || destination ? (
      <Alert>
        <AlertTitle>{notice}</AlertTitle>
        {destination && (
          <AlertDescription>
            <Button variant="link" asChild>
              <a href={destination}>打开管理地址 {destination}</a>
            </Button>
          </AlertDescription>
        )}
      </Alert>
    ) : null;
  const seconds = Math.max(0, Math.min(120, Math.ceil((pending.deadline - now) / 1000)));
  const atNewAddress = window.location.origin === pending.newOrigin;
  return (
    <Alert className="space-y-3" aria-live="polite">
      <AlertTitle>{seconds ? `请在 ${seconds} 秒内确认连接` : "正在等待设备恢复原设置"}</AlertTitle>
      <AlertDescription className="block space-y-2">
        <p>{pending.label}正在生效。未确认时，设备会自动恢复原设置；请保持此页面打开。</p>
        {pending.oldOrigin !== pending.newOrigin && (
          <p>
            管理地址将变为 {pending.newOrigin}
            。连接未就绪时会重试打开新页面。如果更换了网段，请重新连接网络；新页面可能需要确认设备证书。
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
        {openError && <p className="text-destructive">{openError}</p>}
        <div className="flex flex-wrap gap-2">
          {seconds > 0 &&
            (atNewAddress ? (
              <Button
                disabled={!reachable || loading || phase === "applying"}
                onClick={() => {
                  void (async () => {
                    await confirm();
                    if (!useSettings.getState().pending) notifyApplyComplete(true);
                  })();
                }}
              >
                连接正常，保留设置
              </Button>
            ) : (
              <Button
                disabled={loading}
                onClick={() => {
                  try {
                    openApplyAddress(pending);
                    setOpenError(null);
                  } catch (e) {
                    setOpenError(e instanceof Error ? e.message : "无法打开新地址");
                  }
                }}
              >
                打开新地址并确认
              </Button>
            ))}
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => {
              void (async () => {
                await rollback();
                if (!useSettings.getState().pending) notifyApplyComplete(false);
              })();
            }}
          >
            恢复原设置
          </Button>
          {window.location.origin !== pending.oldOrigin && (
            <Button variant="link" asChild>
              <a href={pending.oldOrigin}>返回原地址</a>
            </Button>
          )}
        </div>
        {atNewAddress && !reachable && seconds > 0 && (
          <p className="text-xs">正在确认设备连接，连接正常后即可保留设置。</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
