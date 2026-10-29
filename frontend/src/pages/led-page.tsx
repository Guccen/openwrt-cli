import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpTip } from "@/components/help-tip";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert } from "@/components/status/error-alert";
import { DeviceLoading } from "@/components/status/device-loading";
import {
  ledStates,
  ledLabel,
  ledDraft,
  validateLedPolicy,
  type LedState,
  type LedSnapshot,
  type LedEffect,
} from "@/lib/led-client";
import { ledClient, useLeds } from "@/stores/leds";
import { useSettings } from "@/stores/settings";
import { useRouter } from "@/stores/router";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
import { notify } from "@/lib/notifications";

function LedForm({ snapshot, disabled }: { snapshot: LedSnapshot; disabled: boolean }) {
  const [policy, setPolicy] = useState(() => ledDraft(snapshot));
  const [targets, setTargets] = useState(policy.targets.join(", "));
  const [error, setError] = useState<string | null>(null);
  function update(name: LedState, values: Partial<LedEffect>) {
    setPolicy((current) => ({
      ...current,
      states: { ...current.states, [name]: { ...current.states[name], ...values } },
    }));
  }
  async function save() {
    const session = useRouter.getState().session;
    if (!session || disabled) return;
    const value = {
      ...policy,
      targets: targets
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
    try {
      validateLedPolicy(value, snapshot.leds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请检查指示灯配置。");
      return;
    }
    const operation = useMaintenanceOperation.getState().begin("led");
    if (!operation) return;
    setError(null);
    notify.dismiss("led");
    try {
      await ledClient.save(session, value, snapshot.leds);
      if (useRouter.getState().session === session) {
        notify.success("led", "指示灯配置已保存并应用", "状态每分钟检测一次。");
        // 读取设备实际保存的配置与状态。
        await useLeds.getState().load();
      }
    } catch (e) {
      if (useRouter.getState().session === session) notify.error("led", e, "指示灯配置保存失败");
    } finally {
      useMaintenanceOperation.getState().finish(operation);
    }
  }
  async function repairTask() {
    const session = useRouter.getState().session;
    if (!session || disabled) return;
    const operation = useMaintenanceOperation.getState().begin("led");
    if (!operation) return;
    setError(null);
    notify.dismiss("led");
    try {
      await ledClient.repair(session);
      if (useRouter.getState().session === session) {
        notify.success(
          "led",
          "指示灯定时任务已同步",
          snapshot.policy.enabled ? "每分钟状态检查已恢复。" : "残留任务已清理。",
        );
        await useLeds.getState().load();
      }
    } catch (e) {
      if (useRouter.getState().session === session) notify.error("led", e, "指示灯任务修复失败");
    } finally {
      useMaintenanceOperation.getState().finish(operation);
    }
  }
  const available = snapshot.leds.length > 0;
  const savedDraft = ledDraft(snapshot);
  const hasUnsavedChanges =
    JSON.stringify(policy) !== JSON.stringify(savedDraft) ||
    targets !== savedDraft.targets.join(", ");
  const taskNeedsRepair =
    !snapshot.cronSynchronized || (snapshot.policy.enabled && !snapshot.cronRunning);
  return (
    <div className="space-y-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>系统状态灯</CardTitle>
          <CardDescription>
            {snapshot.current
              ? `最近状态：${ledStates[snapshot.current.state]} · ${new Date(snapshot.current.checkedAt * 1000).toLocaleTimeString("zh-CN")}`
              : "尚未启用状态灯控制"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!available && (
            <p className="text-xs text-muted-foreground">
              设备没有可配置的指示灯。通用 QEMU 不模拟物理灯，请在真实设备上检查。
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="led-policy-enabled">按系统状态控制指示灯</Label>
              <HelpTip label="状态灯控制说明">
                每分钟及网络接口变化时更新状态。仅接管选中的灯，停用后恢复接管前的灯效。
              </HelpTip>
            </div>
            <Switch
              id="led-policy-enabled"
              checked={policy.enabled}
              disabled={disabled || (!available && !policy.enabled)}
              onCheckedChange={(enabled) => setPolicy((current) => ({ ...current, enabled }))}
            />
          </div>
          <div className="flex items-center gap-1">
            <Label htmlFor="led-targets">连通性探测目标（1–2 个 IPv4）</Label>
            <HelpTip label="连通性探测说明">
              两个目标均无法响应 ping 时显示断网；任一目标可达则正常。故障指 netifd、rpcd 或 uhttpd
              关键进程缺失。ICMP 被拦截可能误判，不能检测断电、内核崩溃或所有业务故障。
            </HelpTip>
          </div>
          <Input
            id="led-targets"
            value={targets}
            onChange={(event) => setTargets(event.target.value)}
            disabled={disabled || !available}
          />
          {taskNeedsRepair && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  指示灯定时任务{snapshot.cronSynchronized ? "未运行" : "与配置不一致"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {snapshot.policy.enabled
                    ? "状态控制已启用，但每分钟检查任务缺失或 cron 服务未运行。"
                    : "状态控制已关闭，检测到残留的指示灯定时任务。"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || hasUnsavedChanges}
                onClick={() => void repairTask()}
              >
                {snapshot.policy.enabled ? "重新同步任务" : "清理残留任务"}
              </Button>
            </div>
          )}
          {taskNeedsRepair && hasUnsavedChanges && (
            <p className="text-xs text-muted-foreground">
              请先保存或撤销未保存的指示灯设置，再修复定时任务。
            </p>
          )}
        </CardContent>
      </Card>
      {available && (
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(ledStates) as LedState[]).map((name) => {
            const effect = policy.states[name];
            const led = snapshot.leds.find((item) => item.id === effect.led);
            return (
              <Card size="sm" key={name}>
                <CardHeader>
                  <CardTitle>{ledStates[name]}时</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label htmlFor={`led-${name}`}>使用指示灯</Label>
                  <Select
                    value={effect.led}
                    disabled={disabled}
                    onValueChange={(value) =>
                      update(name, {
                        led: value,
                        ...(!snapshot.leds.find((item) => item.id === value)?.timer &&
                        effect.effect === "blink"
                          ? { effect: "on" as const }
                          : {}),
                      })
                    }
                  >
                    <SelectTrigger id={`led-${name}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {snapshot.leds.map((item, index) => (
                        <SelectItem key={item.id} value={item.id}>
                          {ledLabel(item.id, index)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label htmlFor={`effect-${name}`}>灯效</Label>
                  <Select
                    value={effect.effect}
                    disabled={disabled}
                    onValueChange={(value) =>
                      update(name, { effect: value as LedEffect["effect"] })
                    }
                  >
                    <SelectTrigger id={`effect-${name}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on">常亮</SelectItem>
                      <SelectItem value="off">熄灭</SelectItem>
                      {led?.timer && <SelectItem value="blink">闪烁</SelectItem>}
                    </SelectContent>
                  </Select>
                  {effect.effect === "blink" && (
                    <div className="grid grid-cols-2 gap-3">
                      {(["onMs", "offMs"] as const).map((key) => (
                        <div className="space-y-2" key={key}>
                          <Label htmlFor={`${name}-${key}`}>
                            {key === "onMs" ? "亮起" : "熄灭"}时间（毫秒）
                          </Label>
                          <Input
                            id={`${name}-${key}`}
                            type="number"
                            min={50}
                            max={10000}
                            value={effect[key]}
                            disabled={disabled}
                            onChange={(event) =>
                              update(name, { [key]: Number(event.target.value) })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <ErrorAlert message={error} />
      <Button
        disabled={disabled || (!available && !snapshot.policy.enabled)}
        onClick={() => void save()}
      >
        保存指示灯配置
      </Button>
      <p className="text-xs text-muted-foreground">
        开机灯效从用户空间启动阶段生效；更早的启动及救援模式由固件控制。N1
        单色灯可通过闪烁节奏区分状态，颜色以设备实际列出的灯为准。
      </p>
    </div>
  );
}
export function LedPage() {
  const { session, snapshot, load, loading, error } = useLeds();
  const settings = useSettings();
  const operation = useMaintenanceOperation((state) => state.kind);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  const disabled =
    loading ||
    !!operation ||
    settings.loading ||
    !!settings.pending ||
    settings.staged ||
    !!settings.destination;
  return (
    <div className="space-y-3">
      <ErrorAlert message={error} />
      {!snapshot && !error && <DeviceLoading />}
      {snapshot && (
        <LedForm key={`${session}:${snapshot.updatedAt}`} snapshot={snapshot} disabled={disabled} />
      )}
    </div>
  );
}
