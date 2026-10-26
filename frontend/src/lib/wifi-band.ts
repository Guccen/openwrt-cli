export type WifiBand = "2g" | "5g" | "6g" | "unknown";

export function wifiBand(config: Record<string, unknown>, frequency?: number | null): WifiBand {
  if (["2g", "5g", "6g"].includes(String(config.band))) return config.band as WifiBand;
  if (config.hwmode === "11g" || config.hwmode === "11b") return "2g";
  if (config.hwmode === "11a") return "5g";
  if (frequency && frequency >= 2400 && frequency < 2500) return "2g";
  if (frequency && frequency >= 4900 && frequency < 5925) return "5g";
  if (frequency && frequency >= 5925 && frequency <= 7125) return "6g";
  return "unknown";
}

export function wifiBandLabel(band: WifiBand) {
  return { "2g": "2.4 GHz", "5g": "5 GHz", "6g": "6 GHz", unknown: "未知频段" }[band];
}
