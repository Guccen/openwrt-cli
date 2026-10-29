import { RouterClient } from "./rpc";
import { ipv4 } from "./ipv4";

export const ledStates = { boot: "开机", normal: "正常", offline: "断网", fault: "故障" } as const;
export type LedState = keyof typeof ledStates;

const ledColorLabels: Record<string, string> = {
  amber: "琥珀色",
  blue: "蓝色",
  green: "绿色",
  orange: "橙色",
  red: "红色",
  white: "白色",
  yellow: "黄色",
};
const ledRoleLabels: Record<string, string> = {
  internet: "网络灯",
  lan: "局域网灯",
  power: "电源灯",
  status: "状态灯",
  wan: "广域网灯",
  wifi: "无线灯",
  wlan: "无线灯",
};
const ledGroupLabels: Record<string, string> = { system: "系统", usb: "USB" };

export function ledLabel(id: string, index: number) {
  const parts = id.toLowerCase().split(/[:_-]+/);
  const color = parts.find((part) => ledColorLabels[part]);
  const role = parts.find((part) => ledRoleLabels[part]);
  const group = parts.find((part) => ledGroupLabels[part]);
  if (color && role) return `${ledColorLabels[color]}${ledRoleLabels[role]}`;
  if (group && role) return `${ledGroupLabels[group]}${ledRoleLabels[role]}`;
  if (color) return `${ledColorLabels[color]}指示灯`;
  if (role) return ledRoleLabels[role];
  return `设备指示灯 ${index + 1}`;
}

export interface LedEffect {
  led: string;
  effect: "on" | "off" | "blink";
  onMs: number;
  offMs: number;
}
export interface LedPolicy {
  enabled: boolean;
  targets: string[];
  states: Record<LedState, LedEffect>;
}
export interface LedSnapshot {
  leds: { id: string; timer: boolean; maxBrightness: number }[];
  policy: LedPolicy;
  current: { state: LedState; checkedAt: number } | null;
  updatedAt: number;
}
export function validateLedPolicy(policy: LedPolicy, leds: LedSnapshot["leds"]) {
  if (
    typeof policy.enabled !== "boolean" ||
    !Array.isArray(policy.targets) ||
    !policy.targets.length ||
    policy.targets.length > 2
  )
    throw new Error("请填写 1–2 个 IPv4 探测目标，用英文逗号分隔。");
  for (const target of policy.targets) {
    const value = typeof target === "string" ? ipv4(target) : null;
    if (value === null || value >>> 24 === 0 || value >>> 24 === 127 || value >>> 24 >= 224)
      throw new Error("探测目标必须是有效的单播 IPv4 地址。");
  }
  for (const name of Object.keys(ledStates) as LedState[]) {
    const state = policy.states?.[name];
    if (!state || typeof state.led !== "string" || !["on", "off", "blink"].includes(state.effect))
      throw new Error("指示灯状态配置不完整。");
    if (
      ![state.onMs, state.offMs].every(
        (value) => Number.isInteger(value) && value >= 50 && value <= 10000,
      )
    )
      throw new Error("闪烁亮起和熄灭时间均需为 50–10000 毫秒。");
    const led = leds.find((item) => item.id === state.led);
    if (policy.enabled && (!led || (state.effect === "blink" && !led.timer)))
      throw new Error("所选指示灯不存在，或不支持定时闪烁。");
  }
}
export function ledDraft(snapshot: LedSnapshot): LedPolicy {
  const policy = structuredClone(snapshot.policy);
  for (const name of Object.keys(ledStates) as LedState[]) {
    const state = policy.states[name];
    const preferred = name === "normal" ? "green" : name === "boot" ? "blue" : "red";
    if (!snapshot.leds.some((led) => led.id === state.led))
      state.led =
        snapshot.leds.find((led) => led.id.startsWith(preferred + ":"))?.id ??
        snapshot.leds[0]?.id ??
        "";
    if (state.effect === "blink" && !snapshot.leds.find((led) => led.id === state.led)?.timer)
      state.effect = "on";
  }
  return policy;
}
export class LedClient {
  constructor(readonly rpc = new RouterClient()) {}
  private async call(session: string, method: string, args = {}) {
    const result = await this.rpc.call<Record<string, unknown>>(
      session,
      "router.maintenance",
      method,
      args,
      15000,
    );
    if (result?.ok !== true) {
      const messages: Record<string, string> = {
        configuration_busy: "设备存在暂存或待确认的配置，请先完成确认或恢复。",
        operation_busy: "设备正在执行其他维护操作，请稍后重试。",
        led_invalid: "指示灯配置或探测地址不正确。",
        led_unsupported: "设备没有所选指示灯，或不支持定时闪烁。",
        led_write_failed: "设备无法保存配置或设置指示灯，请检查驱动及存储。",
        led_apply_failed: "配置已保存，但应用灯效失败，请刷新检查并重试。",
      };
      throw new Error(messages[String(result?.error)] ?? "指示灯操作失败");
    }
    return result;
  }
  async read(session: string): Promise<LedSnapshot> {
    const result = await this.call(session, "led_status");
    if (!Array.isArray(result.leds) || !result.policy || typeof result.policy !== "object")
      throw new Error("指示灯状态格式不正确");
    const leds = result.leds as LedSnapshot["leds"];
    if (
      leds.some(
        (led) =>
          typeof led.id !== "string" ||
          typeof led.timer !== "boolean" ||
          !Number.isInteger(led.maxBrightness),
      )
    )
      throw new Error("指示灯能力格式不正确");
    const policy = result.policy as LedPolicy;
    validateLedPolicy({ ...policy, enabled: false }, leds);
    if (typeof policy.enabled !== "boolean") throw new Error("指示灯配置格式不正确");
    const current = result.current as LedSnapshot["current"];
    return {
      leds,
      policy,
      current:
        current && Object.hasOwn(ledStates, current.state) && typeof current.checkedAt === "number"
          ? current
          : null,
      updatedAt: Date.now(),
    };
  }
  async save(session: string, policy: LedPolicy, leds: LedSnapshot["leds"]) {
    validateLedPolicy(policy, leds);
    await this.call(session, "led_save", { policy: JSON.stringify(policy) });
  }
}
