import { useEffect, useState } from "react";
import { notify } from "@/lib/notifications";
import { HelpTip } from "@/components/help-tip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { DeviceLoading } from "@/components/status/device-loading";
import { ErrorAlert } from "@/components/status/error-alert";
import {
  sameSchedule,
  scheduleDays,
  scheduleReasons,
  scheduleSummary,
  validateSchedulePolicy,
  type SchedulePolicy,
  type ScheduleSnapshot,
} from "@/lib/schedule";
import { useRouter } from "@/stores/router";
import { useSettings } from "@/stores/settings";
import { useMaintenanceOperation } from "@/stores/maintenance-operation";
import { scheduleClient, useSchedule } from "@/stores/schedule";

const scheduleHours = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0"));
const scheduleMinutes = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));

function ScheduleTimePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (part: "hour" | "minute", value: string) => void;
}) {
  const [hour, minute] = value.split(":");
  return (
    <div
      role="group"
      aria-label="执行时间"
      className="flex h-8 w-full items-center gap-1 rounded-md border border-input bg-input/20 px-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 sm:max-w-40 dark:bg-input/30"
    >
      <Select value={hour} onValueChange={(next) => onChange("hour", next)} disabled={disabled}>
        <SelectTrigger
          id="schedule-time-hour"
          aria-label="小时"
          size="sm"
          className="h-6 min-w-0 flex-1 justify-center border-0 bg-transparent px-1 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="min-w-16">
          {scheduleHours.map((option) => (
            <SelectItem key={option} value={option} className="justify-center pr-6">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-hidden="true" className="text-muted-foreground">
        :
      </span>
      <Select value={minute} onValueChange={(next) => onChange("minute", next)} disabled={disabled}>
        <SelectTrigger
          aria-label="分钟"
          size="sm"
          className="h-6 min-w-0 flex-1 justify-center border-0 bg-transparent px-1 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="min-w-16">
          {scheduleMinutes.map((option) => (
            <SelectItem key={option} value={option} className="justify-center pr-6">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function configurationBusy() {
  const settings = useSettings.getState();
  return (
    settings.loading ||
    !!settings.pending ||
    settings.staged ||
    !!settings.destination ||
    !!useMaintenanceOperation.getState().kind
  );
}

function ScheduleForm({ snapshot, disabled }: { snapshot: ScheduleSnapshot; disabled: boolean }) {
  const [policy, setPolicy] = useState<SchedulePolicy>(() => structuredClone(snapshot.policy));
  const [confirmation, setConfirmation] = useState<SchedulePolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  function update(values: Partial<SchedulePolicy>) {
    setPolicy((current) => ({ ...current, ...values }));
    setError(null);
  }
  function toggleEnabled(enabled: boolean) {
    if (!enabled) {
      try {
        validateSchedulePolicy(policy);
      } catch {
        // 草稿尚未填完时，仍可立即停用设备中已保存的有效计划。
        update({ ...structuredClone(snapshot.policy), enabled: false });
        return;
      }
    }
    update({ enabled });
  }
  async function save(value: SchedulePolicy) {
    setConfirmation(null);
    const session = useRouter.getState().session;
    if (!session || disabled || configurationBusy() || useSchedule.getState().session !== session)
      return;
    const token = useMaintenanceOperation.getState().begin("schedule");
    if (!token) return;
    setError(null);
    notify.dismiss("schedule");
    try {
      await scheduleClient.save(session, value);
      if (useRouter.getState().session === session) {
        notify.success("schedule", value.enabled ? "定时重启计划已保存" : "定时重启已关闭");
        await useSchedule.getState().load();
      }
    } catch (cause) {
      if (useRouter.getState().session === session)
        notify.error("schedule", cause, "定时任务保存失败，请重试。");
    } finally {
      useMaintenanceOperation.getState().finish(token);
    }
  }
  function submit() {
    if (disabled || configurationBusy()) return;
    try {
      validateSchedulePolicy(policy);
      if (policy.enabled) setConfirmation(structuredClone(policy));
      else void save(policy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请检查执行时间和日期。");
    }
  }
  return (
    <>
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>定时重启</CardTitle>
            <HelpTip label="定时重启说明">
              按设备时区执行，每个计划时段最多触发一次。修改系统时间或时区后，执行时间也会相应改变。
            </HelpTip>
          </div>
          <CardDescription>
            当前状态：{snapshot.policy.enabled ? scheduleSummary(snapshot.policy) : "关闭"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="schedule-enabled">启用定时重启</Label>
              <Switch
                id="schedule-enabled"
                checked={policy.enabled}
                disabled={disabled}
                onCheckedChange={toggleEnabled}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="schedule-time-hour">执行时间</Label>
                <HelpTip label="执行时间说明">
                  使用设备本地时间，时区见下方运行状态。建议选择网络空闲时段。
                </HelpTip>
              </div>
              <ScheduleTimePicker
                value={policy.time}
                disabled={disabled || !policy.enabled}
                onChange={(part, value) => {
                  setPolicy((current) => {
                    const [hour, minute] = current.time.split(":");
                    return {
                      ...current,
                      time: part === "hour" ? `${value}:${minute}` : `${hour}:${value}`,
                    };
                  });
                  setError(null);
                }}
              />
            </div>
            <fieldset className="space-y-2" disabled={disabled || !policy.enabled}>
              <legend className="mb-2 text-xs font-medium">执行日期</legend>
              <div className="flex flex-wrap gap-1.5">
                {scheduleDays.map((label, day) => (
                  <Button
                    key={label}
                    type="button"
                    variant={policy.days.includes(day) ? "secondary" : "outline"}
                    aria-pressed={policy.days.includes(day)}
                    onClick={() =>
                      update({
                        days: policy.days.includes(day)
                          ? policy.days.filter((value) => value !== day)
                          : [...policy.days, day].sort((left, right) => left - right),
                      })
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ days: [0, 1, 2, 3, 4, 5, 6] })}
                >
                  每天
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ days: [1, 2, 3, 4, 5] })}
                >
                  工作日
                </Button>
              </div>
            </fieldset>
            <Alert>
              <AlertDescription>
                重启会短暂中断所有客户端的网络连接。存在待确认配置或维护操作时，设备会跳过本次任务。
              </AlertDescription>
            </Alert>
            <ErrorAlert message={error} />
            <Button disabled={disabled || sameSchedule(policy, snapshot.policy)}>
              保存定时任务
            </Button>
          </form>
        </CardContent>
      </Card>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认保存定时重启计划？</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation && `${scheduleSummary(confirmation)}（${snapshot.timezone}）重启设备。`}
              所有客户端的网络连接会短暂中断，请确认执行时段适合。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                if (confirmation) void save(confirmation);
              }}
            >
              确认保存计划
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ScheduleStatus({ snapshot }: { snapshot: ScheduleSnapshot }) {
  const last = snapshot.last;
  const outcomes = { requested: "已请求重启", skipped: "已跳过", failed: "执行失败" };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>运行状态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">设备时间</dt>
          <dd className="min-w-0 break-words">{snapshot.localTime}</dd>
          <dt className="text-muted-foreground">设备时区</dt>
          <dd className="min-w-0 break-words">{snapshot.timezone}</dd>
          <dt className="text-muted-foreground">下次执行</dt>
          <dd className="min-w-0 break-words">
            {snapshot.policy.enabled
              ? (snapshot.next ?? "暂无执行时间，请检查设备时间")
              : "计划未启用"}
          </dd>
          <dt className="text-muted-foreground">上次记录</dt>
          <dd className="min-w-0 break-words">
            {last ? `${last.localTime} · ${outcomes[last.outcome]}` : "暂无执行记录"}
          </dd>
          {last && (
            <>
              <dt className="text-muted-foreground">记录原因</dt>
              <dd className="min-w-0 break-words">{scheduleReasons[last.reason] ?? last.reason}</dd>
            </>
          )}
        </dl>
        {!snapshot.cronRunning && (
          <Alert variant="destructive">
            <AlertDescription>
              cron 服务未运行，定时任务无法触发。请先启动 cron 服务，再重新读取状态。
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function SchedulePage() {
  const { session, snapshot, load, loading, error } = useSchedule();
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
      {(settings.pending || settings.staged || settings.destination) && (
        <Alert>
          <AlertDescription>
            存在待确认或暂存的网络配置，请先确认或恢复，完成前无法保存定时任务。
          </AlertDescription>
        </Alert>
      )}
      {operation && operation !== "schedule" && (
        <Alert>
          <AlertDescription>其他系统维护操作正在进行，完成后才能保存定时任务。</AlertDescription>
        </Alert>
      )}
      {error && (
        <Button variant="outline" disabled={loading || !!operation} onClick={() => void load()}>
          重新读取计划
        </Button>
      )}
      {!snapshot && !error && <DeviceLoading />}
      {snapshot && (
        <>
          <ScheduleForm
            key={`${session}:${snapshot.updatedAt}`}
            snapshot={snapshot}
            disabled={disabled}
          />
          <ScheduleStatus snapshot={snapshot} />
        </>
      )}
    </div>
  );
}
