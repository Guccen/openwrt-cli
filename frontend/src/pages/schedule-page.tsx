import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { cn } from "cn";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

function TimeOptionList({
  label,
  prefix,
  options,
  value,
  open,
  onChange,
}: {
  label: string;
  prefix: string;
  options: string[];
  value: string;
  open: boolean;
  onChange: (value: string) => void;
}) {
  const list = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-value="${value}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [open, value]);

  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, currentValue: string) {
    const current = options.indexOf(currentValue);
    let next = current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = Math.min(current + 1, options.length - 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(current - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "PageDown") next = Math.min(current + 5, options.length - 1);
    else if (event.key === "PageUp") next = Math.max(current - 5, 0);
    else return;
    event.preventDefault();
    const nextValue = options[next];
    onChange(nextValue);
    list.current?.querySelector<HTMLButtonElement>(`[data-value="${nextValue}"]`)?.focus();
  }

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <fieldset
        ref={list}
        aria-label={label}
        className="h-44 overflow-y-auto overscroll-contain rounded-md border bg-background p-1"
      >
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <button
            id={`${prefix}-${option}`}
            data-value={option}
            key={option}
            type="button"
            aria-label={`${option} ${label}`}
            aria-pressed={option === value}
            tabIndex={option === value ? 0 : -1}
            onKeyDown={(event) => moveSelection(event, option)}
            onClick={() => onChange(option)}
            className={cn(
              "flex h-8 w-full items-center justify-center rounded-sm text-sm tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground",
              option === value && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {option}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

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
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="schedule-time-hour"
          type="button"
          variant="outline"
          size="lg"
          disabled={disabled}
          aria-label={`执行时间 ${hour}时${minute}分`}
          aria-expanded={open}
          className="w-full justify-between font-normal sm:max-w-40"
        >
          <span className="flex items-center gap-2">
            <Clock3 className="text-muted-foreground" />
            <span className="font-mono text-sm tabular-nums">
              {hour}:{minute}
            </span>
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-2rem)] space-y-3 p-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium">选择执行时间</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">24 小时制</p>
          </div>
          <span className="rounded-md bg-muted px-2.5 py-1 font-mono text-sm font-semibold tabular-nums">
            {hour}:{minute}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TimeOptionList
            label="小时"
            prefix="schedule-hour"
            options={scheduleHours}
            value={hour}
            open={open}
            onChange={(next) => onChange("hour", next)}
          />
          <TimeOptionList
            label="分钟"
            prefix="schedule-minute"
            options={scheduleMinutes}
            value={minute}
            open={open}
            onChange={(next) => onChange("minute", next)}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">可滚动选择，或使用方向键调整</p>
      </PopoverContent>
    </Popover>
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
  const needsRepair =
    !snapshot.cronSynchronized || (snapshot.policy.enabled && !snapshot.cronRunning);
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
  async function save(value: SchedulePolicy, repairing = false) {
    setConfirmation(null);
    const session = useRouter.getState().session;
    if (!session || disabled || configurationBusy() || useSchedule.getState().session !== session)
      return;
    if (repairing && !sameSchedule(policy, snapshot.policy)) return;
    const token = useMaintenanceOperation.getState().begin("schedule");
    if (!token) return;
    setError(null);
    notify.dismiss("schedule");
    try {
      await scheduleClient.save(session, value);
      if (useRouter.getState().session === session) {
        notify.success(
          "schedule",
          repairing
            ? "定时任务已重新同步"
            : value.enabled
              ? "定时重启计划已保存"
              : "定时重启已关闭",
          repairing ? "已根据设备中保存的计划修复 cron 任务。" : undefined,
        );
        await useSchedule.getState().load();
      }
    } catch (cause) {
      if (useRouter.getState().session === session)
        notify.error(
          "schedule",
          cause,
          repairing ? "定时任务同步失败，请检查 cron 服务后重试。" : "定时任务保存失败，请重试。",
        );
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
            {needsRepair && (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {!snapshot.policy.enabled
                      ? "计划已关闭，但 cron 中仍有本功能的任务行。"
                      : !snapshot.cronRunning
                        ? "cron 服务未运行，已启用的计划无法触发。"
                        : "已保存的计划与 cron 任务行不同步，计划可能不会执行。"}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {!sameSchedule(policy, snapshot.policy) && (
                      <span className="text-muted-foreground">请先保存或撤销未保存的更改。</span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled || !sameSchedule(policy, snapshot.policy)}
                      onClick={() => void save(snapshot.policy, true)}
                    >
                      {!snapshot.policy.enabled ? "清理残留任务" : "重新同步计划"}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
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
          <dt className="text-muted-foreground">任务同步</dt>
          <dd className="min-w-0 break-words">
            {snapshot.cronSynchronized ? "已同步" : "与 cron 不一致"}
            {snapshot.policy.enabled && !snapshot.cronRunning ? " · cron 服务未运行" : ""}
          </dd>
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
