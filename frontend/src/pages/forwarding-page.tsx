import { useState } from "react";
import { SettingsSection, type SettingsFormProps } from "@/components/settings/settings-section";
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
import {
  forwardingPlan,
  forwardingRows,
  type Forwarding,
  dmzDraft,
  dmzPlan,
  ipv6RulePlan,
  ipv6RuleRows,
  type Ipv6Rule,
  securityDraft,
  securityPlan,
} from "@/lib/forwarding";
import { useRouter } from "@/stores/router";
import { NotFoundPage } from "./not-found-page";

function ForwardingRow({
  snapshot,
  disabled,
  review,
  initial,
}: SettingsFormProps & { initial: Forwarding }) {
  const [draft, setDraft] = useState(initial),
    id = `forward-${initial.section || "new"}`,
    locked = disabled || !initial.editable;
  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        review(() => forwardingPlan(snapshot, draft));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(
          [
            ["name", "转发名称"],
            ["external", "外部端口"],
            ["address", "内网目标 IPv4"],
            ["internal", "内部端口"],
          ] as const
        ).map(([key, title]) => (
          <div className="space-y-1.5" key={key}>
            <Label htmlFor={`${id}-${key}`}>{title}</Label>
            <Input
              id={`${id}-${key}`}
              disabled={locked}
              value={draft[key]}
              required
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-protocol`}>协议</Label>
          <Select
            value={draft.protocol}
            disabled={locked}
            onValueChange={(protocol) => setDraft({ ...draft, protocol })}
          >
            <SelectTrigger id={`${id}-protocol`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["tcp", "udp", "tcp udp"].map((p) => (
                <SelectItem key={p} value={p}>
                  {p.toUpperCase().replace(" ", " + ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor={`${id}-enabled`}>启用转发</Label>
          <Switch
            id={`${id}-enabled`}
            disabled={locked}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
      </div>
      {initial.editable ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled}>{initial.section ? "保存端口转发" : "添加端口转发"}</Button>
          {initial.section && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => review(() => forwardingPlan(snapshot, draft, true))}
            >
              删除端口转发
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          此规则包含端口范围或其他高级选项，请通过 SSH 管理。
        </p>
      )}
    </form>
  );
}

function Ipv6RuleRow({
  snapshot,
  disabled,
  review,
  initial,
}: SettingsFormProps & { initial: Ipv6Rule }) {
  const [draft, setDraft] = useState(initial),
    id = `ipv6-rule-${initial.section || "new"}`,
    locked = disabled || !initial.editable;
  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        review(() => ipv6RulePlan(snapshot, draft));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>放行名称</Label>
          <Input
            id={`${id}-name`}
            disabled={locked}
            value={draft.name}
            required
            autoComplete="off"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-port`}>目标端口</Label>
          <Input
            id={`${id}-port`}
            disabled={locked}
            value={draft.port}
            required
            autoComplete="off"
            onChange={(e) => setDraft({ ...draft, port: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-protocol`}>协议</Label>
          <Select
            value={draft.protocol}
            disabled={locked}
            onValueChange={(protocol) => setDraft({ ...draft, protocol })}
          >
            <SelectTrigger id={`${id}-protocol`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["tcp", "udp", "tcp udp"].map((p) => (
                <SelectItem key={p} value={p}>
                  {p.toUpperCase().replace(" ", " + ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${id}-address`}>目标 IPv6 地址（可选）</Label>
          <Input
            id={`${id}-address`}
            disabled={locked}
            value={draft.address}
            placeholder="留空代表放行该端口至任意 LAN 设备，或指定单播 IPv6 地址"
            autoComplete="off"
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor={`${id}-enabled`}>启用放行</Label>
          <Switch
            id={`${id}-enabled`}
            disabled={locked}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
      </div>
      {initial.editable ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled}>
            {initial.section ? "保存 IPv6 放行" : "添加 IPv6 放行"}
          </Button>
          {initial.section && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => review(() => ipv6RulePlan(snapshot, draft, true))}
            >
              删除 IPv6 放行
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">此规则包含高级过滤选项，请通过 SSH 管理。</p>
      )}
    </form>
  );
}

function DmzCard(props: SettingsFormProps) {
  const [draft, setDraft] = useState(() => dmzDraft(props.snapshot));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>DMZ 主机</CardTitle>
        <CardDescription>
          将所有未被端口转发规则匹配的 WAN 入站 IPv4
          流量全部定向至内网指定主机。通常用于解决游戏主机 NAT
          类型限制，开启后目标主机完全暴露在公网，存在安全风险。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            props.review(() => dmzPlan(props.snapshot, draft));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <Label htmlFor="dmz-enabled">启用 DMZ</Label>
              <Switch
                id="dmz-enabled"
                disabled={props.disabled}
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dmz-address">DMZ 目标 IPv4</Label>
              <Input
                id="dmz-address"
                disabled={props.disabled || !draft.enabled}
                value={draft.address}
                required={draft.enabled}
                placeholder="例如 192.168.68.100"
                autoComplete="off"
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Button disabled={props.disabled}>保存 DMZ 设置</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SecurityCard(props: SettingsFormProps) {
  const [draft, setDraft] = useState(() => securityDraft(props.snapshot));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>安全与远程访问</CardTitle>
        <CardDescription>
          管理路由器自身对 WAN 外网请求的响应策略。外网访问管理页面需配合公网 IP 或 DDNS
          使用，请务必先修改为强密码。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            props.review(() => securityPlan(props.snapshot, draft));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="wan-ping">响应外网 Ping (ICMP)</Label>
                <p className="text-xs text-muted-foreground">
                  允许上游或公网探测路由器是否在线；关闭后可在外网隐身。
                </p>
              </div>
              <Switch
                id="wan-ping"
                disabled={props.disabled}
                checked={draft.wanPing}
                onCheckedChange={(wanPing) => setDraft({ ...draft, wanPing })}
              />
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="remote-web">外网访问管理页面</Label>
                  <p className="text-xs text-muted-foreground">
                    允许从 WAN 外部网络访问此路由器管理控制台。
                  </p>
                </div>
                <Switch
                  id="remote-web"
                  disabled={props.disabled}
                  checked={draft.remoteWebEnabled}
                  onCheckedChange={(remoteWebEnabled) => setDraft({ ...draft, remoteWebEnabled })}
                />
              </div>
              {draft.remoteWebEnabled && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="remote-port">外部访问端口</Label>
                  <Input
                    id="remote-port"
                    disabled={props.disabled}
                    value={draft.remoteWebPort}
                    required
                    placeholder="8443"
                    autoComplete="off"
                    onChange={(e) => setDraft({ ...draft, remoteWebPort: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    建议使用大于 1024 的非标准端口（如 8443）。外网访问地址为：http://[公网IP]:
                    {draft.remoteWebPort || "8443"}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div>
            <Button disabled={props.disabled}>保存安全设置</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ForwardingPage() {
  const device = useRouter((s) => s.device);
  if (device?.role !== "router")
    return <NotFoundPage message="旁路由不开放 WAN 端口转发与安全设置。" />;
  return (
    <SettingsSection>
      {(props) => (
        <div className="space-y-4">
          <SecurityCard {...props} />
          <Card size="sm">
            <CardHeader>
              <CardTitle>IPv4 端口转发</CardTitle>
              <CardDescription>
                将 WAN 指定端口转发至内网设备，建议先为目标设备保留 DHCP
                地址。需要上游允许入站；光猫二次 NAT 或运营商内网地址下还需处理上游转发。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {forwardingRows(props.snapshot).map((row) => (
                <ForwardingRow {...props} key={row.section} initial={row} />
              ))}
              <ForwardingRow
                {...props}
                initial={{
                  section: "",
                  name: "",
                  protocol: "tcp",
                  external: "",
                  address: "",
                  internal: "",
                  enabled: true,
                  editable: true,
                }}
              />
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>IPv6 端口放行</CardTitle>
              <CardDescription>
                允许外网访问内网设备的公网 IPv6 端口（针孔放行）。IPv6
                属于端到端直连，无需进行端口映射；目标设备需已获取到有效的公网 IPv6 地址。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {ipv6RuleRows(props.snapshot).map((row) => (
                <Ipv6RuleRow {...props} key={row.section} initial={row} />
              ))}
              <Ipv6RuleRow
                {...props}
                initial={{
                  section: "",
                  name: "",
                  protocol: "tcp",
                  port: "",
                  address: "",
                  enabled: true,
                  editable: true,
                }}
              />
            </CardContent>
          </Card>
          <DmzCard {...props} />
        </div>
      )}
    </SettingsSection>
  );
}
