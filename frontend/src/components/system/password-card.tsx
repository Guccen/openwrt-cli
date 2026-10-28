import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/status/error-alert";
import { useRouter } from "@/stores/router";
import { maintenanceClient } from "@/stores/maintenance";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
import { loginPath } from "@/lib/routes";

export function PasswordCard({ disabled }: { disabled: boolean }) {
  const session = useRouter((state) => state.session);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || disabled || busy) return;
    const operation = useMaintenanceOperation.getState().begin("password");
    if (!operation) return;
    setBusy(true);
    setError(null);
    const values = [current, password, confirmation] as const;
    setCurrent("");
    setPassword("");
    setConfirmation("");
    try {
      const revoked = await maintenanceClient.changePassword(session, ...values);
      const active = useRouter.getState().session;
      if (active && active !== session) return;
      useRouter.getState().forgetSession();
      window.location.assign(`${loginPath}?passwordChanged=1${revoked ? "" : "&revokeFailed=1"}`);
    } catch (e) {
      if (useRouter.getState().session === session)
        setError(e instanceof Error ? e.message : "修改密码失败");
    } finally {
      useMaintenanceOperation.getState().finish(operation);
      setBusy(false);
    }
  }
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>修改登录密码</CardTitle>
        <CardDescription>修改设备 root 密码，同时用于网页和 SSH 登录。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          <input type="text" name="username" value="root" autoComplete="username" readOnly hidden />
          <div className="space-y-2">
            <Label htmlFor="root-current-password">当前登录密码</Label>
            <Input
              id="root-current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
              disabled={disabled || busy}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="root-new-password">新登录密码</Label>
              <Input
                id="root-new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={disabled || busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="root-confirm-password">确认新登录密码</Label>
              <Input
                id="root-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                disabled={disabled || busy}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            新密码需要 8–128 字节。修改成功后网页会话失效，请使用新密码重新登录。
          </p>
          <ErrorAlert message={error} />
          <Button type="submit" variant="outline" disabled={disabled || busy}>
            {busy ? "正在修改…" : "修改登录密码"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
