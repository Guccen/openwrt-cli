import { useEffect, useState, type FormEvent } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  dnsPlan,
  dnsServers,
  lanDraft,
  lanPlan,
  wifiDrafts,
  wifiPlan,
  type ConfigPlan,
  type SettingsSnapshot,
  type WifiDraft,
} from "@/lib/settings";
import { useRouter } from "@/stores/router";
import { useSettings } from "@/stores/settings";

type SettingsPageName = "lan" | "dns" | "wireless";
type Review = (makePlan: () => ConfigPlan) => void;

function LanForm({
  snapshot,
  review,
  disabled,
}: {
  snapshot: SettingsSnapshot;
  review: Review;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(() => lanDraft(snapshot));
  const device = useRouter((state) => state.device);
  const routerSnapshot = useRouter((state) => state.snapshot);
  const interfaces = routerSnapshot?.interfaces ?? [];
  const bypass = device?.role === "bypass";
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>LAN 地址</CardTitle>
        <CardDescription>选择未被其他设备占用的地址，应用后需重新确认连接。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            review(() => lanPlan(snapshot, draft, bypass, interfaces));
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lan-address">LAN IPv4 地址</Label>
              <Input
                id="lan-address"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                disabled={disabled}
                required
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lan-mask">子网掩码</Label>
              <Input
                id="lan-mask"
                value={draft.netmask}
                onChange={(e) => setDraft({ ...draft, netmask: e.target.value })}
                disabled={disabled}
                required
                autoComplete="off"
              />
            </div>
            {bypass && (
              <div className="space-y-1.5">
                <Label htmlFor="lan-gateway">上游网关</Label>
                <Input
                  id="lan-gateway"
                  value={draft.gateway}
                  onChange={(e) => setDraft({ ...draft, gateway: e.target.value })}
                  disabled={disabled}
                  required
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">填写主路由的 LAN 地址。</p>
              </div>
            )}
          </div>
          <Button disabled={disabled}>应用 LAN 设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DnsForm({
  snapshot,
  review,
  disabled,
}: {
  snapshot: SettingsSnapshot;
  review: Review;
  disabled: boolean;
}) {
  const [servers, setServers] = useState(() => dnsServers(snapshot).join("\n"));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>上游 DNS</CardTitle>
        <CardDescription>为设备与局域网的 DNS 服务指定上游解析器。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            review(() => dnsPlan(snapshot, servers));
          }}
          className="space-y-4"
        >
          <div className="max-w-lg space-y-1.5">
            <Label htmlFor="dns-servers">DNS 服务器</Label>
            <Textarea
              id="dns-servers"
              rows={4}
              value={servers}
              onChange={(e) => setServers(e.target.value)}
              disabled={disabled}
              placeholder={"1.1.1.1\n2606:4700:4700::1111"}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              每行一个 IPv4 或 IPv6 地址，最多 4 个。留空使用上游自动分配的 DNS。
            </p>
          </div>
          <Button disabled={disabled}>应用 DNS 设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function WifiForm({
  snapshot,
  initial,
  review,
  disabled,
}: {
  snapshot: SettingsSnapshot;
  initial: WifiDraft;
  review: Review;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const locked = disabled || !initial.editable;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    review(() => wifiPlan(snapshot, draft));
  };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{initial.ssid || "无线网络"}</CardTitle>
        <CardDescription>
          {!initial.editable
            ? "此接口使用高级无线配置，请通过 SSH 管理。"
            : "修改后无线连接可能中断，请重新连接后确认。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`wifi-enabled-${initial.section}`}>启用无线网络</Label>
            <Switch
              id={`wifi-enabled-${initial.section}`}
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              disabled={locked}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`wifi-ssid-${initial.section}`}>WiFi 名称</Label>
              <Input
                id={`wifi-ssid-${initial.section}`}
                value={draft.ssid}
                onChange={(e) => setDraft({ ...draft, ssid: e.target.value })}
                disabled={locked}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`wifi-encryption-${initial.section}`}>加密方式</Label>
              <Select
                value={draft.encryption}
                onValueChange={(encryption) => setDraft({ ...draft, encryption })}
                disabled={locked}
              >
                <SelectTrigger id={`wifi-encryption-${initial.section}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="psk2">WPA2 个人版</SelectItem>
                  <SelectItem value="sae-mixed">WPA2 / WPA3 兼容</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`wifi-password-${initial.section}`}>WiFi 密码</Label>
              <Input
                id={`wifi-password-${initial.section}`}
                type="password"
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                disabled={locked}
                placeholder={initial.hasPassword ? "留空保留现有密码" : "首次启用请设置密码"}
              />
              <p className="text-[11px] text-muted-foreground">8 至 63 字节，已有密码不会显示。</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`wifi-hidden-${initial.section}`}>隐藏 WiFi 名称</Label>
            <Switch
              id={`wifi-hidden-${initial.section}`}
              checked={draft.hidden}
              onCheckedChange={(hidden) => setDraft({ ...draft, hidden })}
              disabled={locked}
            />
          </div>
          <Button disabled={locked}>应用无线设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsPage({ page }: { page: SettingsPageName }) {
  const {
    session,
    snapshot,
    load,
    loading,
    pending,
    staged,
    discard,
    apply,
    error,
    destination,
    revision,
  } = useSettings();
  const [plan, setPlan] = useState<ConfigPlan | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  useEffect(() => {
    if (session) void load();
  }, [load, page, session]);
  const review: Review = (makePlan) => {
    try {
      const value = makePlan();
      if (!value.edits.length) throw new Error("没有需要应用的改动");
      setPlan(value);
      setValidation(null);
    } catch (e) {
      setValidation(e instanceof Error ? e.message : "请检查输入");
    }
  };
  let unsupported: string | null = null;
  try {
    if (snapshot) lanDraft(snapshot);
  } catch (e) {
    unsupported = e instanceof Error ? e.message : "无法读取配置";
  }
  const disabled = loading || !!pending || staged || !!destination;
  const radios = snapshot ? wifiDrafts(snapshot) : [];
  return (
    <div className="space-y-3">
      {(error || validation || unsupported) && (
        <Alert variant="destructive">
          <AlertDescription>{validation || error || unsupported}</AlertDescription>
        </Alert>
      )}
      {staged && !pending && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            当前会话有未应用改动，请先丢弃；如果设备仍在恢复中，请稍后重试。
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void discard()}>
              丢弃暂存改动
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!snapshot && !pending && !error && <Skeleton className="h-64" />}
      {snapshot && !unsupported && (
        <div key={`${page}-${revision}`}>
          {page === "lan" && <LanForm snapshot={snapshot} review={review} disabled={disabled} />}
          {page === "dns" && <DnsForm snapshot={snapshot} review={review} disabled={disabled} />}
          {page === "wireless" &&
            (radios.length ? (
              <div className="space-y-3">
                {radios.map((radio) => (
                  <WifiForm
                    key={radio.section}
                    snapshot={snapshot}
                    initial={radio}
                    review={review}
                    disabled={disabled}
                  />
                ))}
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  未检测到无线接口。请确认 WiFi 驱动和设备配置已正确加载。
                </AlertDescription>
              </Alert>
            ))}
        </div>
      )}
      <AlertDialog
        open={!!plan}
        onOpenChange={(open) => {
          if (!open) setPlan(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认应用{plan?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              应用后有 120 秒确认连接，未确认会自动恢复。请不要在确认前关闭或刷新页面。
              {plan &&
                snapshot &&
                plan.address !== String(snapshot.network.lan.ipaddr) &&
                ` 新管理地址：${plan.address}。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (plan) void apply(plan, window.location.origin);
              }}
            >
              应用并开始计时
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
