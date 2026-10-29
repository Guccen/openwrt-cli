import type { LedPolicy, LedSnapshot } from "../../frontend/src/lib/led-client";

export function ledFixture(
  device = "jdcloud-ax1800",
  hardware = true,
): Omit<LedSnapshot, "updatedAt"> {
  const ids = hardware
    ? device === "jdcloud-ax1800"
      ? ["red:status", "green:status", "blue:status"]
      : ["n1:white:status"]
    : [];
  const triggers = [
    "timer",
    "heartbeat",
    "default-on",
    "netdev",
    "mmc0",
    "phy0rx",
    "phy0tx",
    "phy0assoc",
    "phy0radio",
    "phy1rx",
    "phy1tx",
    "phy1assoc",
    "phy1radio",
  ];
  return {
    leds: ids.map((id) => ({ id, triggers, currentTrigger: "default-on", maxBrightness: 1 })),
    networkDevices: ["lo", "wan", "br-lan", "phy0-ap0"],
    policy: {
      version: 2,
      enabled: false,
      boot: {
        led: device === "jdcloud-ax1800" ? "blue:status" : "n1:white:status",
        effect: "blink",
        onMs: 250,
        offMs: 250,
      },
      leds: [],
    } satisfies LedPolicy,
  };
}
