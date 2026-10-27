import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Router, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/status/error-alert";
import { useSearch } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRouter } from "@/stores/router";

export function LoginPage() {
  const { device, loading, error, login } = useRouter();
  const query = new URLSearchParams(useSearch());
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = password;
    setPassword("");
    await login(value);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-5">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2">
          <Router className="size-5" />
          <span className="text-sm font-semibold">设备控制台</span>
          <Badge variant="outline" className="ml-auto">
            轻量版
          </Badge>
        </div>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-base">登录设备</CardTitle>
            <CardDescription>
              {device?.model ?? "OpenWrt"} · {device?.role === "bypass" ? "旁路由" : "路由器"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {query.get("passwordChanged") === "1" && (
              <Alert className="mb-4">
                <AlertDescription>
                  {query.get("revokeFailed") === "1"
                    ? "密码已修改，请使用新密码登录。部分旧会话清理失败，请重启设备使其失效。"
                    : "密码已修改，请使用新密码重新登录。"}
                </AlertDescription>
              </Alert>
            )}
            <form onSubmit={(event) => void submit(event)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">用户名</Label>
                <Input id="username" value="root" autoComplete="username" readOnly />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">设备密码</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <ErrorAlert message={error} />
              <Button className="w-full" size="lg" disabled={loading}>
                {loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{" "}
                {loading ? "正在登录" : "登录"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          首次使用请通过 SSH 设置 root 密码。网络设置应用后需确认连接，超时自动恢复。
        </p>
      </div>
    </main>
  );
}
