import { RouterClient } from "./rpc";

export interface SchedulePolicy {
  enabled: boolean;
  time: string;
  days: number[];
}

export interface ScheduleRecord {
  at: number;
  localTime: string;
  outcome: "requested" | "skipped" | "failed";
  reason: string;
  slot: string | null;
}

export interface ScheduleSnapshot {
  policy: SchedulePolicy;
  localTime: string;
  timezone: string;
  next: string | null;
  last: ScheduleRecord | null;
  cronRunning: boolean;
  updatedAt: number;
}

export const scheduleDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function validateSchedulePolicy(policy: SchedulePolicy) {
  if (!policy || typeof policy.enabled !== "boolean") throw new Error("定时任务配置不完整。");
  if (typeof policy.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(policy.time))
    throw new Error("请选择有效的执行时间，格式为 00:00–23:59。");
  if (
    !Array.isArray(policy.days) ||
    !policy.days.length ||
    policy.days.length > 7 ||
    new Set(policy.days).size !== policy.days.length ||
    policy.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  )
    throw new Error("请至少选择一个执行日期，同一天不可重复。");
}

export function scheduleSummary(policy: SchedulePolicy) {
  validateSchedulePolicy(policy);
  const days = [...policy.days].sort((left, right) => left - right);
  const label =
    days.length === 7
      ? "每天"
      : days.join(",") === "1,2,3,4,5"
        ? "每周一至周五"
        : `每${days.map((day) => scheduleDays[day]).join("、")}`;
  return `${label} ${policy.time}`;
}

export function sameSchedule(left: SchedulePolicy, right: SchedulePolicy) {
  return (
    left.enabled === right.enabled &&
    left.time === right.time &&
    [...left.days].sort().join(",") === [...right.days].sort().join(",")
  );
}

export const scheduleReasons: Record<string, string> = {
  requested: "已发出重启请求",
  disabled: "定时重启未启用",
  invalid_clock: "设备时间尚未校准",
  not_due: "尚未到达执行时间",
  duplicate: "本次计划已处理，避免重复重启",
  boot_grace: "设备刚开机，处于启动保护期",
  configuration_busy: "存在暂存或待确认的网络配置",
  maintenance_busy: "其他系统维护操作正在进行",
  reboot_failed: "设备未能执行重启请求",
};

function validText(value: unknown, limit = 80): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

export class ScheduleClient {
  constructor(readonly rpc = new RouterClient()) {}

  private async call(session: string, method: string, args = {}) {
    const response = await this.rpc.call<Record<string, unknown>>(
      session,
      "router.maintenance",
      method,
      args,
      15000,
    );
    if (response?.ok !== true) {
      const messages: Record<string, string> = {
        configuration_busy: "设备存在暂存或待确认的配置，请先确认或恢复网络设置。",
        operation_busy: "设备正在执行其他维护操作，请稍后重试。",
        schedule_invalid: "定时任务配置无效，请检查执行时间和日期。",
        schedule_invalid_state: "设备中保存的定时任务配置已损坏，请检查配置后重试。",
        schedule_state_failed: "设备无法记录定时任务状态，请检查存储空间和权限后重试。",
        schedule_apply_failed: "定时任务应用失败，请重新读取计划并检查 cron 服务。",
        schedule_restore_failed:
          "保存失败，且原计划未能完全恢复。请重新读取并检查已保存的计划与 cron 配置。",
        schedule_crontab_too_large: "设备的计划任务文件过大，无法更新。请先清理不需要的任务。",
        schedule_cron_busy: "计划任务正被其他操作修改，请稍后重试。",
        unsupported_method: "设备尚不支持定时任务，请更新设备端组件。",
      };
      throw new Error(messages[String(response?.error)] ?? "定时任务操作失败，请稍后重试。");
    }
    return response;
  }

  async read(session: string): Promise<ScheduleSnapshot> {
    const response = await this.call(session, "schedule_status");
    const policy = response.policy as SchedulePolicy;
    validateSchedulePolicy(policy);
    if (
      !validText(response.localTime) ||
      !validText(response.timezone, 128) ||
      (response.next !== null && !validText(response.next)) ||
      typeof response.cronRunning !== "boolean"
    )
      throw new Error("定时任务状态格式不正确，请确认设备组件已更新。");
    const last = response.last as ScheduleRecord | null;
    if (
      last !== null &&
      (!last ||
        !Number.isSafeInteger(last.at) ||
        last.at < 0 ||
        !validText(last.localTime) ||
        !["requested", "skipped", "failed"].includes(last.outcome) ||
        !validText(last.reason, 120) ||
        (last.slot !== null && !validText(last.slot)))
    )
      throw new Error("定时任务执行记录格式不正确，请重新读取。");
    return {
      policy: { ...policy, days: [...policy.days].sort((left, right) => left - right) },
      localTime: response.localTime,
      timezone: response.timezone,
      next: response.next,
      last,
      cronRunning: response.cronRunning,
      updatedAt: Date.now(),
    };
  }

  async save(session: string, policy: SchedulePolicy) {
    validateSchedulePolicy(policy);
    await this.call(session, "schedule_save", {
      enabled: policy.enabled,
      time: policy.time,
      days: [...policy.days].sort((left, right) => left - right),
    });
  }
}
