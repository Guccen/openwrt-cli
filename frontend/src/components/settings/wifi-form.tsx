import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { wifiPlan, type WifiDraft } from "@/lib/settings";
import { wifiBandLabel } from "@/lib/wifi-band";
import type { SettingsFormProps } from "./settings-section";

export function WifiForm({
  snapshot,
  initial,
  review,
  disabled,
}: SettingsFormProps & { initial: WifiDraft }) {
  const [draft, setDraft] = useState(initial);
  const locked = disabled || !initial.editable;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    review(() => wifiPlan(snapshot, draft));
  };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{wifiBandLabel(initial.band)} WiFi</span>
          <Badge variant={draft.enabled ? "secondary" : "outline"}>
            {draft.enabled ? "已启用" : "已关闭"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {initial.ssid || "未命名网络"} · {initial.device}
        </CardDescription>
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
