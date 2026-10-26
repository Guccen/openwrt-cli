import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dnsPlan, dnsServers } from "@/lib/settings";
import type { SettingsFormProps } from "./settings-section";

export function DnsForm({ snapshot, review, disabled }: SettingsFormProps) {
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
