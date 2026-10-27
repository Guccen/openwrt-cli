import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wanLinkDraft, wanLinkPlan } from "@/lib/wan-link";
import type { SettingsFormProps } from "./settings-section";
export function WanLinkForm({
  snapshot,
  review,
  disabled,
  initial,
}: SettingsFormProps & { initial: ReturnType<typeof wanLinkDraft> }) {
  const [draft, setDraft] = useState(initial);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>WAN 链路参数</CardTitle>
        <CardDescription>
          通常保持默认。仅在运营商要求或排查连接问题时修改，应用时会重新连接 WAN。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            review(() => wanLinkPlan(snapshot, draft));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wan-mtu">MTU</Label>
              <Input
                id="wan-mtu"
                value={draft.mtu}
                placeholder="留空使用默认值"
                disabled={disabled}
                inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, mtu: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wan-mac">WAN MAC 地址</Label>
              <Input
                id="wan-mac"
                value={draft.mac}
                placeholder="留空使用设备默认 MAC"
                disabled={disabled}
                autoComplete="off"
                onChange={(e) => setDraft({ ...draft, mac: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            PPPoE 常用 MTU 为 1492；启用 IPv6 时最低为 1280。MAC 请填写运营商绑定的地址。
          </p>
          <Button disabled={disabled}>应用链路参数</Button>
        </form>
      </CardContent>
    </Card>
  );
}
