import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipv6Plan, ipv6Modes, type Ipv6Draft, type Ipv6Mode } from "@/lib/ipv6-settings";
import type { SettingsFormProps } from "./settings-section";

export function Ipv6Form({
  snapshot,
  review,
  disabled,
  initial,
  bypass,
}: SettingsFormProps & { initial: Ipv6Draft; bypass: boolean }) {
  const [draft, setDraft] = useState(initial);
  const field = <K extends keyof Ipv6Draft>(key: K, value: Ipv6Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{bypass ? "旁路由自身 IPv6" : "IPv6 上网与分配"}</CardTitle>
        <CardDescription>
          {bypass
            ? "仅为本机获取 IPv6，局域网地址和默认路由仍由主路由负责。"
            : "默认使用自动获取；上游需提供 IPv6 地址、路由或委派前缀。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            review(() => ipv6Plan(snapshot, draft, bypass));
          }}
        >
          <div className="max-w-lg space-y-1.5">
            <Label htmlFor="ipv6-mode">IPv6 上网方式</Label>
            <Select
              value={draft.mode}
              disabled={disabled}
              onValueChange={(value) => field("mode", value as Ipv6Mode)}
            >
              <SelectTrigger id="ipv6-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ipv6Modes)
                  .filter(([mode]) => !bypass || (mode !== "relay" && mode !== "nat66"))
                  .map(([mode, title]) => (
                    <SelectItem key={mode} value={mode}>
                      {title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {draft.mode === "auto" && !bypass && (
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="ipv6-prefix-hint">请求的前缀长度</Label>
              <Select
                value={draft.prefixHint}
                disabled={disabled}
                onValueChange={(value) => field("prefixHint", value)}
              >
                <SelectTrigger id="ipv6-prefix-hint" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!["auto", "48", "56", "60", "64"].includes(initial.prefixHint) && (
                    <SelectItem value={initial.prefixHint}>
                      当前高级请求：{initial.prefixHint}
                    </SelectItem>
                  )}
                  {["auto", "48", "56", "60", "64"].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "auto" ? "自动（推荐）" : `/${value}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                这是向上游提出的请求，实际长度由运营商决定。
              </p>
            </div>
          )}
          {draft.mode === "nat66" && (
            <p className="text-xs text-muted-foreground">
              使用本地 ULA 前缀并通过 IPv6 NAT
              出网，适用于光猫拨号且仅下发单地址（不提供前缀委派）的情况。
            </p>
          )}
          {draft.mode === "relay" && (
            <p className="text-xs text-muted-foreground">
              中继 RA、DHCPv6 和邻居发现，适用于上级路由仅提供同网段 IPv6
              的情况；运营商或上级路由仍需允许此方式。
            </p>
          )}
          {draft.mode === "static" && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["address", "WAN IPv6 地址/前缀长度", "2001:db8:1::2/64"],
                  ["gateway", "IPv6 网关", "fe80::1"],
                  ...(!bypass ? [["prefix", "分配给 LAN 的 IPv6 前缀", "2001:db8:200::/56"]] : []),
                ] as ["address" | "gateway" | "prefix", string, string][]
              ).map(([key, title, placeholder]) => (
                <div className="space-y-1.5" key={key}>
                  <Label htmlFor={`ipv6-${key}`}>{title}</Label>
                  <Input
                    id={`ipv6-${key}`}
                    disabled={disabled}
                    value={draft[key]}
                    placeholder={placeholder}
                    autoComplete="off"
                    onChange={(event) => field(key, event.target.value)}
                    required={key !== "prefix"}
                  />
                </div>
              ))}
            </div>
          )}
          {draft.mode !== "off" && (
            <>
              {!bypass && (
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="ipv6-lan">向 LAN 提供 IPv6（SLAAC / DHCPv6）</Label>
                  <Switch
                    id="ipv6-lan"
                    checked={draft.lan}
                    disabled={disabled}
                    onCheckedChange={(value) => field("lan", value)}
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ipv6-dns-auto">使用上游提供的 IPv6 DNS</Label>
                <Switch
                  id="ipv6-dns-auto"
                  checked={draft.autoDns}
                  disabled={disabled}
                  onCheckedChange={(value) => field("autoDns", value)}
                />
              </div>
              {!draft.autoDns && (
                <div className="max-w-lg space-y-1.5">
                  <Label htmlFor="ipv6-dns">IPv6 DNS 服务器</Label>
                  <Textarea
                    id="ipv6-dns"
                    value={draft.dns}
                    disabled={disabled}
                    required
                    autoComplete="off"
                    onChange={(event) => field("dns", event.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    每行一个，最多 4 个。DNS 设置页的自定义上游规则仍会优先使用。
                  </p>
                </div>
              )}
            </>
          )}
          <p className="text-[11px] text-muted-foreground">
            应用后有 120 秒确认，失联会回滚。建议通过 IPv4 管理地址调整
            IPv6；部分终端可能需要重连网络。
          </p>
          <Button disabled={disabled}>应用 IPv6 设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}
