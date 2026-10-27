import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ErrorAlert } from "@/components/status/error-alert";
import { TimeClient, type TimeSnapshot } from "@/lib/time-settings";
import { useRouter } from "@/stores/router";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
const client = new TimeClient();
const labels: Record<string, string> = {
  UTC: "UTC",
  "Asia/Shanghai": "中国标准时间（上海）",
  "Asia/Hong_Kong": "香港",
  "Asia/Tokyo": "东京",
  "Asia/Singapore": "新加坡",
};
export function TimeCard({ disabled }: { disabled: boolean }) {
  const session = useRouter((s) => s.session),
    alive = useRef(true);
  const [value, setValue] = useState<TimeSnapshot | null>(null),
    [servers, setServers] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    alive.current = true;
    if (session)
      void client
        .read(session)
        .then((response) => {
          if (active) {
            setValue(response);
            setServers(response.settings.servers.join("\n"));
            setError(null);
          }
        })
        .catch((e) => {
          if (active) setError(e instanceof Error ? e.message : "读取失败");
        });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [session, attempt]);
  const save = async () => {
    if (!session || !value || busy || disabled) return;
    const token = useMaintenanceOperation.getState().begin("time");
    if (!token) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await client.save(session, {
        ...value.settings,
        servers: [...new Set(servers.split(/\s+/).filter(Boolean))],
      });
      if (alive.current && useRouter.getState().session === session) {
        setSaved(true);
        void useRouter.getState().refresh();
      }
    } catch (e) {
      if (alive.current && useRouter.getState().session === session)
        setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      useMaintenanceOperation.getState().finish(token);
      if (alive.current && useRouter.getState().session === session) setBusy(false);
    }
  };
  const settings = value?.settings,
    locked = disabled || busy;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>时间与 NTP 校时</CardTitle>
        <CardDescription>
          正确时间用于 HTTPS、日志和故障排查。应用时重载系统时区和校时服务，网络连接保持当前配置。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ErrorAlert message={error} />
        <Button
          type="button"
          variant="outline"
          disabled={locked}
          onClick={() => retry(attempt + 1)}
        >
          重新读取时间设置
        </Button>
        {settings && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="system-timezone">时区</Label>
              <Select
                value={settings.zone}
                disabled={locked}
                onValueChange={(zone) => {
                  setValue({ ...value, settings: { ...settings, zone } });
                  setSaved(false);
                }}
              >
                <SelectTrigger id="system-timezone" className="w-full sm:max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!value.zones.includes(settings.zone) && (
                    <SelectItem value={settings.zone}>{settings.zone}（当前高级时区）</SelectItem>
                  )}
                  {value.zones.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {labels[zone] ?? zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(
              [
                ["enabled", "启用 NTP 自动校时"],
                ["useDhcp", "接受上游 DHCP 提供的时间服务器"],
              ] as const
            ).map(([key, label]) => (
              <div className="flex items-center justify-between gap-3" key={key}>
                <Label htmlFor={`ntp-${key}`}>{label}</Label>
                <Switch
                  id={`ntp-${key}`}
                  checked={settings[key]}
                  disabled={locked || (key === "useDhcp" && !settings.enabled)}
                  onCheckedChange={(checked) => {
                    setValue({ ...value, settings: { ...settings, [key]: checked } });
                    setSaved(false);
                  }}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="ntp-servers">NTP 服务器</Label>
              <Textarea
                id="ntp-servers"
                value={servers}
                disabled={locked || !settings.enabled}
                onChange={(e) => {
                  setServers(e.target.value);
                  setSaved(false);
                }}
                placeholder={"0.openwrt.pool.ntp.org\n1.openwrt.pool.ntp.org"}
              />
              <p className="text-xs text-muted-foreground">
                每行一个域名或 IP，最多 4 个。服务器不可达时请更换可访问的校时源。
              </p>
            </div>
            <Button disabled={locked}>{busy ? "正在应用…" : "应用时间设置"}</Button>
            {saved && (
              <output className="block text-xs text-muted-foreground">
                时间设置已保存，自动校时取决于上游连通性。
              </output>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
