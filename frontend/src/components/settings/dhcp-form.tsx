import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dhcpPlan, type DhcpDraft } from "@/lib/dhcp-settings";
import type { SettingsFormProps } from "./settings-section";

export function DhcpForm({
  snapshot,
  initial,
  disabled,
  review,
}: SettingsFormProps & { initial: DhcpDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>LAN 地址自动分配</CardTitle>
        <CardDescription>
          为客户端分配 IPv4 地址。关闭后，新连接的客户端需要手动配置地址。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            review(() => dhcpPlan(snapshot, draft, false));
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="dhcp-enabled">启用 IPv4 DHCP</Label>
            <Switch
              id="dhcp-enabled"
              checked={draft.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["start", "DHCP 起始地址"],
                ["end", "DHCP 结束地址"],
                ["lease", "DHCP 租期"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`dhcp-${key}`}>{label}</Label>
                <Input
                  id={`dhcp-${key}`}
                  value={draft[key]}
                  disabled={disabled || !draft.enabled}
                  required={draft.enabled}
                  autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            起止地址必须在 LAN 网段内，不能包含路由器地址。租期支持
            m（分钟）、h（小时）、d（天），范围 2 分钟至 30 天。IPv6 和已有静态租约沿用当前配置。
          </p>
          <Button disabled={disabled}>应用 DHCP 设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}
