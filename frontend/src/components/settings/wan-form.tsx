import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  wanPlan,
  wanProtocolNames,
  wirelessWan,
  type WanDraft,
  type WanProtocol,
} from "@/lib/wan-settings";
import type { SettingsFormProps } from "./settings-section";

export function WanForm({
  snapshot,
  initial,
  review,
  disabled,
}: SettingsFormProps & { initial: WanDraft }) {
  const [draft, setDraft] = useState(initial);
  const station = wirelessWan(snapshot);
  const field = (key: keyof WanDraft, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          上网方式
          <Badge variant="secondary">
            {station
              ? "无线连接上游"
              : String(snapshot.network.wan.device ?? snapshot.network.wan.ifname ?? "由系统管理")}
          </Badge>
        </CardTitle>
        <CardDescription>修改会中断上网。管理地址保持不变，检查连接后再确认保留。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            review(() => wanPlan(snapshot, draft, false));
          }}
        >
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="wan-protocol">WAN 上网方式</Label>
            <Select
              value={draft.protocol}
              disabled={disabled}
              onValueChange={(value) => {
                const protocol = value as WanProtocol;
                setDraft({
                  ...draft,
                  protocol,
                  autoDns:
                    protocol === "static"
                      ? false
                      : draft.protocol === "static"
                        ? true
                        : draft.autoDns,
                });
              }}
            >
              <SelectTrigger id="wan-protocol" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(wanProtocolNames)
                  .filter(([value]) => !station || value === "dhcp")
                  .map(([value, title]) => (
                    <SelectItem key={value} value={value}>
                      {title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {draft.protocol === "static" && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["address", "WAN IPv4 地址"],
                  ["netmask", "WAN 子网掩码"],
                  ["gateway", "WAN 网关"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`wan-${key}`}>{label}</Label>
                  <Input
                    id={`wan-${key}`}
                    value={draft[key]}
                    disabled={disabled}
                    required
                    autoComplete="off"
                    onChange={(e) => field(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          {draft.protocol === "pppoe" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wan-username">宽带账号</Label>
                <Input
                  id="wan-username"
                  value={draft.username}
                  required
                  disabled={disabled}
                  autoComplete="off"
                  onChange={(e) => field("username", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wan-password">宽带密码</Label>
                <Input
                  id="wan-password"
                  type="password"
                  value={draft.password}
                  disabled={disabled}
                  required={!initial.hasPassword}
                  autoComplete="new-password"
                  placeholder={initial.hasPassword ? "留空保留已有密码" : "填写运营商提供的密码"}
                  onChange={(e) => field("password", e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  已有密码不会显示，恢复自动上网时会清除拨号凭据。
                </p>
              </div>
            </div>
          )}
          {draft.protocol !== "static" && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="wan-auto-dns">使用上游提供的 DNS</Label>
              <Switch
                id="wan-auto-dns"
                checked={draft.autoDns}
                disabled={disabled}
                onCheckedChange={(value) => field("autoDns", value)}
              />
            </div>
          )}
          {!draft.autoDns && (
            <div className="max-w-lg space-y-1.5">
              <Label htmlFor="wan-dns">WAN DNS 服务器</Label>
              <Textarea
                id="wan-dns"
                value={draft.dns}
                disabled={disabled}
                required
                autoComplete="off"
                placeholder={"1.1.1.1\n2606:4700:4700::1111"}
                onChange={(e) => field("dns", e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                每行一个，最多 4 个。DNS 设置页指定的上游规则仍会优先使用。
              </p>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            WAN 网口、VLAN 和 IPv6 接口沿用当前配置。N1 主路由需连接独立的 USB WAN 网卡。
          </p>
          <Button disabled={disabled}>应用 WAN 设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}
