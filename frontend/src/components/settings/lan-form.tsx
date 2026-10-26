import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lanDraft, lanPlan } from "@/lib/settings";
import { useRouter } from "@/stores/router";
import type { SettingsFormProps } from "./settings-section";

export function LanForm({ snapshot, review, disabled }: SettingsFormProps) {
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
