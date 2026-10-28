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
import type { Device } from "@/lib/types";
import { n1Topology, n1Topologies, n1WifiPlan, type N1Topology } from "@/lib/n1-wireless";

export function WifiForm({
  snapshot,
  initial,
  review,
  disabled,
  n1,
}: SettingsFormProps & { initial: WifiDraft; n1?: Device }) {
  const [draft, setDraft] = useState(initial);
  const [topology, setTopology] = useState<N1Topology>(() =>
    n1 ? n1Topology(snapshot, n1) : "usb",
  );
  const locked = disabled || !initial.editable;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    review(() => (n1 ? n1WifiPlan(snapshot, draft, topology, n1) : wifiPlan(snapshot, draft)));
  };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{wifiBandLabel(initial.band)} WiFi</span>
          <Badge variant={draft.enabled ? "success" : "outline"}>
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
          {n1 && (
            <div className="space-y-1.5">
              {n1.role === "router" ? (
                <>
                  <Label htmlFor="n1-topology">接线方案</Label>
                  <Select
                    value={topology}
                    disabled={locked}
                    onValueChange={(value) => {
                      setTopology(value as N1Topology);
                      setDraft({ ...draft, password: "", hidden: false });
                    }}
                  >
                    <SelectTrigger id="n1-topology" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(n1Topologies).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  旁路由热点接入现有 LAN，由上游路由器分配地址。
                </p>
              )}
              {n1.role === "router" && (
                <p className="text-xs text-destructive">
                  切换方案会中断连接，并将 WAN 改为自动获取地址。内置网口上网时，应用后需改用 WiFi
                  连接并确认保留。
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                N1 为单射频，2.4 / 5 GHz 二选一，热点与无线连接上游二选一。请先在下方选择所需频段。
              </p>
            </div>
          )}
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
              <Label htmlFor={`wifi-ssid-${initial.section}`}>
                {topology === "station" ? "上游 WiFi 名称" : "WiFi 名称"}
              </Label>
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
                  {!n1 && <SelectItem value="sae-mixed">WPA2 / WPA3 兼容</SelectItem>}
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
                placeholder={
                  n1 &&
                  (snapshot.wireless[initial.section].mode === "sta") !== (topology === "station")
                    ? "切换用途请重新输入密码"
                    : initial.hasPassword
                      ? "留空保留现有密码"
                      : "首次启用请设置密码"
                }
              />
              <p className="text-[11px] text-muted-foreground">8 至 63 字节，已有密码不会显示。</p>
            </div>
          </div>
          {topology !== "station" && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`wifi-hidden-${initial.section}`}>隐藏 WiFi 名称</Label>
              <Switch
                id={`wifi-hidden-${initial.section}`}
                checked={draft.hidden}
                onCheckedChange={(hidden) => setDraft({ ...draft, hidden })}
                disabled={locked}
              />
            </div>
          )}
          <Button disabled={locked}>应用无线设置</Button>
        </form>
      </CardContent>
    </Card>
  );
}
