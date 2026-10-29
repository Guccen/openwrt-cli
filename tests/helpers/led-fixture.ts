import type { LedPolicy, LedSnapshot, LedState } from "../../frontend/src/lib/led-client";

export function ledFixture(
  device = "jdcloud-ax1800",
  hardware = true,
): Omit<LedSnapshot, "updatedAt"> {
  const ids = hardware
    ? device === "jdcloud-ax1800"
      ? ["red:status", "green:status", "blue:status"]
      : ["n1:white:status"]
    : [];
  const effects: Record<LedState, LedPolicy["states"][LedState]> = {
    boot: { led: "", effect: "blink", onMs: 250, offMs: 250 },
    normal: { led: "", effect: "on", onMs: 500, offMs: 500 },
    offline: { led: "", effect: "blink", onMs: 1000, offMs: 1000 },
    fault: { led: "", effect: "blink", onMs: 100, offMs: 100 },
  };
  return {
    leds: ids.map((id) => ({ id, timer: true, maxBrightness: 1 })),
    policy: { enabled: false, targets: ["223.5.5.5", "119.29.29.29"], states: effects },
    current: null,
    cronRunning: true,
    cronSynchronized: true,
  };
}
