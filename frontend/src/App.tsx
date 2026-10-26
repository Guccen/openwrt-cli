import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  CircleCheck,
  Cpu,
  Globe,
  LoaderCircle,
  RefreshCw,
  Router,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DeviceSidebar, pageTitles, type Page } from "@/components/device-sidebar";
import { SettingsPage } from "@/components/settings-page";
import { ApplyStatus } from "@/components/apply-status";
import { registerApplyHandoff } from "@/lib/apply-handoff";
import { useSettings } from "@/stores/settings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bytes, memoryUsage, uptime } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { useRouter } from "@/stores/router";

export function NetworkTable({ snapshot }: { snapshot: Snapshot }) {
  const interfaces = snapshot.interfaces.filter((item) => item.interface !== "loopback");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>接口</TableHead>
          <TableHead>连接</TableHead>
          <TableHead>协议</TableHead>
          <TableHead>地址</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {interfaces.length ? (
          interfaces.map((item) => (
            <TableRow key={item.interface}>
              <TableCell className="font-medium">
                {item.interface}
                <div className="text-[11px] text-muted-foreground">
                  {item.l3_device ?? item.device ?? "—"}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={item.up ? "secondary" : "outline"}>
                  {item.up ? "已连接" : "未连接"}
                </Badge>
              </TableCell>
              <TableCell className="uppercase">{item.proto}</TableCell>
              <TableCell className="font-mono text-[11px]">
                {[...(item["ipv4-address"] ?? []), ...(item["ipv6-address"] ?? [])].map(
                  (address) => (
                    <div key={address.address}>
                      {address.address}/{address.mask}
                    </div>
                  ),
                )}
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
              暂无网络接口
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export function Overview({ snapshot }: { snapshot: Snapshot }) {
  const { board, info } = snapshot;
  const memory = memoryUsage(info.memory);
  const stats = [
    { label: "运行时间", value: uptime(info.uptime), icon: Activity, detail: "自上次启动" },
    {
      label: "内存使用",
      value: `${memory.percent}%`,
      icon: Cpu,
      detail: `${bytes(memory.used)} / ${bytes(info.memory.total)}`,
    },
    {
      label: "系统负载",
      value: (info.load ?? []).map((value) => (value / 65536).toFixed(2)).join(" / "),
      icon: Globe,
      detail: "1 / 5 / 15 分钟平均负载",
    },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, detail }) => (
          <Card size="sm" key={label}>
            <CardHeader>
              <CardDescription className="flex items-center justify-between">
                {label}
                <Icon className="size-3.5" aria-hidden="true" />
              </CardDescription>
              <CardTitle className="pt-1 text-lg tabular-nums">{value || "—"}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-muted-foreground">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>设备信息</CardTitle>
          <CardDescription>系统与固件版本</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs break-words sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-x-6">
            <dt className="text-muted-foreground">设备型号</dt>
            <dd>{board.model ?? board.system ?? "未知设备"}</dd>
            <dt className="text-muted-foreground">主机名称</dt>
            <dd>{board.hostname}</dd>
            <dt className="text-muted-foreground">系统版本</dt>
            <dd>
              {board.release.distribution} {board.release.version}
            </dd>
            <dt className="text-muted-foreground">内核版本</dt>
            <dd>{board.kernel}</dd>
          </dl>
          <Separator className="my-4" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">内存占用</span>
            <span>{memory.percent}%</span>
          </div>
          <Progress value={memory.percent} aria-label="内存占用" className="mt-2 h-1" />
        </CardContent>
      </Card>
    </>
  );
}

export function App() {
  const { session, device, snapshot, loading, error, loadDevice, login, logout, refresh } =
    useRouter();
  const [password, setPassword] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const settings = useSettings();
  const bindSettings = settings.bind;
  const configurationPage = page === "lan" || page === "dns" || page === "wireless";
  useEffect(() => registerApplyHandoff(), []);
  useEffect(() => {
    bindSettings(session);
  }, [session, bindSettings]);
  useEffect(() => {
    void loadDevice();
  }, [loadDevice]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = password;
    setPassword("");
    await login(value);
  }

  const message = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
  if (!session)
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
              <form
                onSubmit={(event) => {
                  void submit(event);
                }}
                className="space-y-4"
              >
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
                {message}
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

  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider style={{ "--sidebar-width": "13rem" } as CSSProperties}>
        <DeviceSidebar
          page={page}
          onNavigate={setPage}
          onLogout={() => {
            void logout();
          }}
          disabled={!!settings.pending || settings.loading}
        />
        <SidebarInset className="min-w-0">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
            <SidebarTrigger aria-label="切换菜单" />
            <Separator orientation="vertical" className="h-4!" />
            <span className="truncate text-xs text-muted-foreground">
              {device?.model ?? snapshot?.board.model ?? "设备控制台"}
            </span>
            <Badge variant="secondary" className="ml-auto shrink-0">
              {device?.role === "bypass" ? "旁路由" : "主路由"}
            </Badge>
          </header>
          <main className="mx-auto w-full max-w-6xl min-w-0 space-y-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-base font-semibold">{pageTitles[page]}</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {device?.model ?? snapshot?.board.model ?? "设备状态"}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={
                  loading || settings.loading || !!settings.pending || !!settings.destination
                }
                onClick={() => {
                  if (configurationPage) void settings.load();
                  else void refresh();
                }}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
                刷新
              </Button>
            </div>
            {message}
            <ApplyStatus />
            {configurationPage ? (
              <SettingsPage page={page} />
            ) : snapshot ? (
              page === "overview" ? (
                <Overview snapshot={snapshot} />
              ) : (
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>网络接口</CardTitle>
                    <CardDescription>当前连接及地址</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <NetworkTable snapshot={snapshot} />
                  </CardContent>
                </Card>
              )
            ) : (
              <div className="space-y-3" aria-label="正在读取设备状态">
                <Skeleton className="h-28" />
                <Skeleton className="h-60" />
              </div>
            )}
            <footer className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <CircleCheck className="size-3" />
              {snapshot
                ? `更新于 ${new Date(snapshot.updatedAt).toLocaleTimeString("zh-CN")}`
                : "等待设备状态"}
              <span className="ml-auto">手动刷新 · 按需读取</span>
            </footer>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
