import { RouterClient } from "./rpc";

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

const triggerLabels: Record<string, string> = {
  preserve: "保持设备原有灯效",
  off: "关闭",
  on: "常亮",
  none: "关闭",
  "default-on": "内核常亮",
  heartbeat: "系统心跳",
  timer: "定时闪烁",
  netdev: "网卡链路与流量",
  mmc0: "存储读写",
};

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

export function triggerLabel(trigger: string) {
  if (triggerLabels[trigger]) return triggerLabels[trigger];
  const phy = /^phy(\d+)(rx|tx|assoc|radio)$/.exec(trigger);
  if (phy) {
    const actions = { rx: "接收活动", tx: "发送活动", assoc: "连接状态", radio: "无线开关" };
    return `无线 ${phy[1]} · ${actions[phy[2] as keyof typeof actions]}`;
  }
  return `内核触发器：${trigger}`;
}

export interface LedRule {
  id: string;
  trigger: string;
  deviceName: string;
  link: boolean;
  rx: boolean;
  tx: boolean;
  interval: number;
  onMs: number;
  offMs: number;
}
export interface LedBootEffect {
  led: string;
  effect: "on" | "off" | "blink";
  onMs: number;
  offMs: number;
}
export interface LedPolicy {
  version: 2;
  enabled: boolean;
  boot: LedBootEffect;
  leds: LedRule[];
}
export interface LedSnapshot {
  leds: { id: string; triggers: string[]; currentTrigger: string; maxBrightness: number }[];
  networkDevices: string[];
  policy: LedPolicy;
  updatedAt: number;
}

export function validateLedPolicy(
  policy: LedPolicy,
  leds: LedSnapshot["leds"],
  networkDevices: string[],
) {
  if (
    policy.version !== 2 ||
    typeof policy.enabled !== "boolean" ||
    !policy.boot ||
    typeof policy.boot.led !== "string" ||
    !["on", "off", "blink"].includes(policy.boot.effect) ||
    !Array.isArray(policy.leds) ||
    policy.leds.length > 64
  )
    throw new Error("指示灯触发器配置不完整。");
  const bootLed = leds.find((led) => led.id === policy.boot.led);
  if (
    policy.enabled &&
    policy.boot.effect !== "off" &&
    (!bootLed || (policy.boot.effect === "blink" && !bootLed.triggers.includes("timer")))
  )
    throw new Error("开机灯效所选指示灯不存在，或不支持定时闪烁。");
  if (
    ![policy.boot.onMs, policy.boot.offMs].every(
      (value) => Number.isInteger(value) && value >= 50 && value <= 10000,
    )
  )
    throw new Error("开机闪烁的亮起和熄灭时间均需为 50–10000 毫秒。");

  const ids = new Set<string>();
  for (const rule of policy.leds) {
    if (
      !rule ||
      typeof rule.id !== "string" ||
      typeof rule.trigger !== "string" ||
      ids.has(rule.id)
    )
      throw new Error("指示灯触发器配置不完整。");
    ids.add(rule.id);
    const led = leds.find((item) => item.id === rule.id);
    if (policy.enabled && !led) throw new Error("所选指示灯不存在，请刷新后重试。");
    if (
      ![rule.onMs, rule.offMs].every(
        (value) => Number.isInteger(value) && value >= 50 && value <= 10000,
      ) ||
      !Number.isInteger(rule.interval) ||
      rule.interval < 10 ||
      rule.interval > 10000
    )
      throw new Error("触发器时间间隔超出允许范围。");
    if (![rule.link, rule.rx, rule.tx].every((value) => typeof value === "boolean"))
      throw new Error("网卡触发器参数格式不正确。");
    if (rule.trigger === "preserve" || rule.trigger === "off" || rule.trigger === "on") continue;
    if (led && !led.triggers.includes(rule.trigger))
      throw new Error("设备不支持所选内核触发器，请刷新后重试。");
    if (rule.trigger === "netdev") {
      if (!networkDevices.includes(rule.deviceName) || (!rule.link && !rule.rx && !rule.tx))
        throw new Error("请选择有效网卡，并至少启用链路、接收或发送中的一项。");
    }
  }
}

function preferredLed(leds: LedSnapshot["leds"]) {
  return (
    leds.find((led) => /(^|[:_-])(blue|white)([:_-]|$)/i.test(led.id))?.id ?? leds[0]?.id ?? ""
  );
}
function preferredActivityLed(leds: LedSnapshot["leds"]) {
  return leds.find((led) => /(^|[:_-])(green|white)([:_-]|$)/i.test(led.id)) ?? leds[0];
}

export function ledDraft(snapshot: LedSnapshot): LedPolicy {
  const stored = new Map(snapshot.policy.leds.map((rule) => [rule.id, rule]));
  const networkDevice = snapshot.networkDevices.includes("wan")
    ? "wan"
    : (snapshot.networkDevices.find((device) => device !== "lo") ?? "");
  const bootLed = snapshot.leds.find((led) => led.id === snapshot.policy.boot.led);
  const defaultLed = preferredActivityLed(snapshot.leds);
  const defaultTrigger = defaultLed?.triggers.includes("netdev")
    ? "netdev"
    : defaultLed?.triggers.includes("heartbeat")
      ? "heartbeat"
      : "preserve";
  return {
    version: 2,
    enabled: snapshot.policy.enabled,
    boot: {
      ...snapshot.policy.boot,
      led: bootLed ? snapshot.policy.boot.led : preferredLed(snapshot.leds),
      effect:
        snapshot.policy.boot.effect === "blink" && !bootLed?.triggers.includes("timer")
          ? "on"
          : snapshot.leds.length
            ? snapshot.policy.boot.effect
            : "off",
    },
    leds: snapshot.leds.map((led) => {
      const existing = stored.get(led.id);
      const rule = existing
        ? structuredClone(existing)
        : {
            id: led.id,
            trigger: led.id === defaultLed?.id ? defaultTrigger : "preserve",
            deviceName: networkDevice,
            link: false,
            rx: true,
            tx: true,
            interval: 50,
            onMs: 250,
            offMs: 250,
          };
      if (!["preserve", "off", "on"].includes(rule.trigger) && !led.triggers.includes(rule.trigger))
        rule.trigger = "preserve";
      if (!snapshot.networkDevices.includes(rule.deviceName)) rule.deviceName = networkDevice;
      if (rule.trigger === "netdev" && !networkDevice) rule.trigger = "preserve";
      return rule;
    }),
  };
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
        led_invalid: "指示灯触发器配置不正确。",
        led_unsupported: "设备不支持所选指示灯或内核触发器。",
        led_write_failed: "设备无法保存配置或设置指示灯，请检查驱动及存储。",
        led_apply_failed: "配置已保存，但应用灯效失败，请刷新检查并重试。",
      };
      throw new Error(messages[String(result?.error)] ?? "指示灯操作失败");
    }
    return result;
  }
  async read(session: string): Promise<LedSnapshot> {
    const result = await this.call(session, "led_status");
    if (
      !Array.isArray(result.leds) ||
      !Array.isArray(result.networkDevices) ||
      !result.policy ||
      typeof result.policy !== "object"
    )
      throw new Error("指示灯状态格式不正确");
    const leds = result.leds as LedSnapshot["leds"];
    const networkDevices = result.networkDevices as string[];
    if (
      leds.some(
        (led) =>
          typeof led.id !== "string" ||
          !Array.isArray(led.triggers) ||
          typeof led.currentTrigger !== "string" ||
          !Number.isInteger(led.maxBrightness),
      ) ||
      networkDevices.some((device) => typeof device !== "string")
    )
      throw new Error("指示灯触发器能力格式不正确");
    const policy = result.policy as LedPolicy;
    validateLedPolicy({ ...policy, enabled: false }, leds, networkDevices);
    if (typeof policy.enabled !== "boolean") throw new Error("指示灯配置格式不正确");
    return { leds, networkDevices, policy, updatedAt: Date.now() };
  }
  async save(session: string, policy: LedPolicy, snapshot: LedSnapshot) {
    validateLedPolicy(policy, snapshot.leds, snapshot.networkDevices);
    await this.call(session, "led_save", { policy: JSON.stringify(policy) });
  }
}
