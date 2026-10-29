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
  ledLabel,
  ledDraft,
  triggerLabel,
  validateLedPolicy,
  type LedPolicy,
  type LedRule,
  type LedSnapshot,
} from "@/lib/led-client";
import { ledClient, useLeds } from "@/stores/leds";
import { useSettings } from "@/stores/settings";
import { useRouter } from "@/stores/router";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
import { notify } from "@/lib/notifications";

function LedForm({ snapshot, disabled }: { snapshot: LedSnapshot; disabled: boolean }) {
  const [policy, setPolicy] = useState(() => ledDraft(snapshot));
  const [error, setError] = useState<string | null>(null);
  function updateBoot(values: Partial<LedPolicy["boot"]>) {
    setPolicy((current) => ({ ...current, boot: { ...current.boot, ...values } }));
  }
  function updateLed(id: string, values: Partial<LedRule>) {
    setPolicy((current) => ({
      ...current,
      leds: current.leds.map((item) => (item.id === id ? { ...item, ...values } : item)),
    }));
  }
  async function save() {
    const session = useRouter.getState().session;
    if (!session || disabled) return;
    try {
      validateLedPolicy(policy, snapshot.leds, snapshot.networkDevices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请检查指示灯触发器设置。");
      return;
    }
    const operation = useMaintenanceOperation.getState().begin("led");
    if (!operation) return;
    setError(null);
    notify.dismiss("led");
    try {
      await ledClient.save(session, policy, snapshot);
      if (useRouter.getState().session === session) {
        notify.success("led", "指示灯触发器已保存并应用", "内核会按所选事件实时控制灯效。");
        await useLeds.getState().load();
      }
    } catch (e) {
      if (useRouter.getState().session === session) notify.error("led", e, "指示灯配置保存失败");
    } finally {
      useMaintenanceOperation.getState().finish(operation);
    }
  }

  const available = snapshot.leds.length > 0;
  const savedDraft = ledDraft(snapshot);
  const hasUnsavedChanges = JSON.stringify(policy) !== JSON.stringify(savedDraft);
  return (
    <div className="space-y-3">
      <Card size="sm">
        <CardHeader>
          <CardTitle>智能状态灯</CardTitle>
          <CardDescription>
            根据网卡、Wi‑Fi、存储和系统事件控制指示灯，具体选项由设备驱动决定。
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
              <Label htmlFor="led-policy-enabled">启用内核触发器控制</Label>
              <HelpTip label="内核触发器说明">
                Linux LED 驱动会根据所选事件控制指示灯。不同设备提供的触发方式不同。
              </HelpTip>
            </div>
            <Switch
              id="led-policy-enabled"
              checked={policy.enabled}
              disabled={disabled || (!available && !policy.enabled)}
              onCheckedChange={(enabled) => setPolicy((current) => ({ ...current, enabled }))}
            />
          </div>
        </CardContent>
      </Card>

      {available && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>开机效果</CardTitle>
            <CardDescription>
              启动早期短暂显示所选灯效，系统启动完成后切换为下方配置的内核触发器。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="led-boot">使用指示灯</Label>
              <Select
                value={policy.boot.led}
                disabled={disabled}
                onValueChange={(led) => updateBoot({ led })}
              >
                <SelectTrigger id="led-boot" className="w-full">
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="led-boot-effect">开机灯效</Label>
              <Select
                value={policy.boot.effect}
                disabled={disabled}
                onValueChange={(effect) =>
                  updateBoot({ effect: effect as LedPolicy["boot"]["effect"] })
                }
              >
                <SelectTrigger id="led-boot-effect" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">熄灭</SelectItem>
                  <SelectItem value="on">常亮</SelectItem>
                  {snapshot.leds
                    .find((item) => item.id === policy.boot.led)
                    ?.triggers.includes("timer") && <SelectItem value="blink">闪烁</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            {policy.boot.effect === "blink" && (
              <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                {(["onMs", "offMs"] as const).map((key) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={`boot-${key}`}>
                      {key === "onMs" ? "亮起" : "熄灭"}时间（毫秒）
                    </Label>
                    <Input
                      id={`boot-${key}`}
                      type="number"
                      min={50}
                      max={10000}
                      value={policy.boot[key]}
                      disabled={disabled}
                      onChange={(event) => updateBoot({ [key]: Number(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {available && (
        <div className="grid gap-3 md:grid-cols-2">
          {snapshot.leds.map((led, index) => {
            const rule = policy.leds.find((item) => item.id === led.id);
            if (!rule) return null;
            const triggerOptions = led.triggers.filter(
              (trigger) => trigger !== "none" && trigger !== "default-on",
            );
            return (
              <Card size="sm" key={led.id}>
                <CardHeader>
                  <CardTitle>{ledLabel(led.id, index)}</CardTitle>
                  <CardDescription>当前触发器：{triggerLabel(led.currentTrigger)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Label htmlFor={`trigger-${led.id}`}>触发方式</Label>
                  <Select
                    value={rule.trigger}
                    disabled={disabled}
                    onValueChange={(trigger) => updateLed(led.id, { trigger })}
                  >
                    <SelectTrigger id={`trigger-${led.id}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preserve">保持设备原有灯效</SelectItem>
                      <SelectItem value="off">关闭</SelectItem>
                      <SelectItem value="on">常亮</SelectItem>
                      {triggerOptions.map((trigger) => (
                        <SelectItem key={trigger} value={trigger}>
                          {triggerLabel(trigger)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {rule.trigger === "timer" && (
                    <div className="grid grid-cols-2 gap-3">
                      {(["onMs", "offMs"] as const).map((key) => (
                        <div className="space-y-2" key={key}>
                          <Label htmlFor={`${led.id}-${key}`}>
                            {key === "onMs" ? "亮起" : "熄灭"}时间（毫秒）
                          </Label>
                          <Input
                            id={`${led.id}-${key}`}
                            type="number"
                            min={50}
                            max={10000}
                            value={rule[key]}
                            disabled={disabled}
                            onChange={(event) =>
                              updateLed(led.id, { [key]: Number(event.target.value) })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {rule.trigger === "netdev" && (
                    <div className="space-y-3 rounded-lg border p-3">
                      <div className="space-y-2">
                        <Label htmlFor={`${led.id}-device`}>网络接口</Label>
                        <Select
                          value={rule.deviceName}
                          disabled={disabled || !snapshot.networkDevices.length}
                          onValueChange={(deviceName) => updateLed(led.id, { deviceName })}
                        >
                          <SelectTrigger id={`${led.id}-device`} className="w-full">
                            <SelectValue placeholder="选择网络接口" />
                          </SelectTrigger>
                          <SelectContent>
                            {snapshot.networkDevices.map((device) => (
                              <SelectItem key={device} value={device}>
                                {device}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {(["link", "rx", "tx"] as const).map((key) => {
                          const label = { link: "链路", rx: "接收", tx: "发送" }[key];
                          return (
                            <div className="flex items-center justify-between gap-2" key={key}>
                              <Label htmlFor={`${led.id}-${key}`} className="text-xs">
                                {label}
                              </Label>
                              <Switch
                                id={`${led.id}-${key}`}
                                checked={rule[key]}
                                disabled={disabled}
                                onCheckedChange={(checked) => updateLed(led.id, { [key]: checked })}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${led.id}-interval`}>活动检测间隔（毫秒）</Label>
                        <Input
                          id={`${led.id}-interval`}
                          type="number"
                          min={10}
                          max={10000}
                          value={rule.interval}
                          disabled={disabled}
                          onChange={(event) =>
                            updateLed(led.id, { interval: Number(event.target.value) })
                          }
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        显示所选接口的链路与数据收发活动。
                      </p>
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
        AX1800、N1
        等设备会按实际驱动支持的触发器显示选项。开机灯效在用户空间启动阶段执行一次；网络和无线活动由内核触发器实时处理。
      </p>
      {hasUnsavedChanges && <span className="sr-only">有未保存的指示灯设置</span>}
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
