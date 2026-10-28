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
import { forwardingPlan, forwardingRows, type Forwarding } from "@/lib/forwarding";
import { useRouter } from "@/stores/router";
import { NotFoundPage } from "./not-found-page";
function Row({ snapshot, disabled, review, initial }: SettingsFormProps & { initial: Forwarding }) {
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
export function ForwardingPage() {
  const device = useRouter((s) => s.device);
  if (device?.role !== "router") return <NotFoundPage message="旁路由不开放 WAN 端口转发。" />;
  return (
    <SettingsSection>
      {(props) => (
        <Card size="sm">
          <CardHeader>
            <CardTitle>IPv4 端口转发</CardTitle>
            <CardDescription>
              将 WAN 指定端口转发至内网设备，建议先为目标设备保留 DHCP
              地址。需要上游允许入站；光猫二次 NAT 或运营商内网地址下还需处理上游转发。IPv6
              不使用此处的 IPv4 NAT 规则。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {forwardingRows(props.snapshot).map((row) => (
              <Row {...props} key={row.section} initial={row} />
            ))}
            <Row
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
      )}
    </SettingsSection>
  );
}
