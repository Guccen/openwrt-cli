import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/status/error-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DiagnosticsClient,
  type DiagnosticOperation,
  type DiagnosticResult,
} from "@/lib/diagnostics";
import { useRouter } from "@/stores/router";
const client = new DiagnosticsClient();
export function DiagnosticsPage() {
  const session = useRouter((s) => s.session),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [target, setTarget] = useState(""),
    [operation, setOperation] = useState<DiagnosticOperation>("ping4"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<DiagnosticResult | null>(null),
    [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await client.run(session, operation, target);
      if (active.current && useRouter.getState().session === session) setResult(response);
    } catch (e) {
      if (active.current && useRouter.getState().session === session)
        setError(e instanceof Error ? e.message : "诊断失败");
    } finally {
      if (active.current && useRouter.getState().session === session) setBusy(false);
    }
  };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>网络诊断与系统日志</CardTitle>
        <CardDescription>
          从路由器发起探测，每次最长 6 秒。可分别检查 IPv4、IPv6 和 DNS，日志按需读取最近 100 条。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorAlert message={error} />
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="diagnostic-operation">诊断项目</Label>
              <Select
                value={operation}
                disabled={busy}
                onValueChange={(value) => {
                  setOperation(value as DiagnosticOperation);
                  setResult(null);
                }}
              >
                <SelectTrigger id="diagnostic-operation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      ["ping4", "IPv4 Ping"],
                      ["ping6", "IPv6 Ping"],
                      ["dns", "DNS 查询"],
                      ["logs", "系统日志"],
                    ] as const
                  ).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {operation !== "logs" && (
              <div className="space-y-1.5">
                <Label htmlFor="diagnostic-target">目标 IP 或域名</Label>
                <Input
                  id="diagnostic-target"
                  value={target}
                  disabled={busy}
                  required
                  maxLength={253}
                  placeholder="例如 one.one.one.one"
                  autoComplete="off"
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
            )}
          </div>
          <Button disabled={busy}>
            {busy ? "正在执行…" : operation === "logs" ? "读取系统日志" : "开始诊断"}
          </Button>
        </form>
        {result && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {result.success
                ? "执行完成"
                : `未成功（退出码 ${result.code}）。请结合输出判断地址、路由、DNS 或上游连接问题。`}
              {result.limited ? " 输出已截断至 16 KiB。" : ""}
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
              {result.output || "没有输出。"}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
