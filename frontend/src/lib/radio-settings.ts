import { RouterClient } from "./rpc";
import { lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";
import { wifiBand } from "./wifi-band";
export interface RadioCapabilities {
  modes: string[];
  channels: { channel: number; mhz: number; dfs: boolean }[];
  countries: { code: string; name: string }[];
}
export class RadioClient {
  constructor(readonly rpc = new RouterClient()) {}
  async read(session: string, section: string): Promise<RadioCapabilities> {
    const { phyname } = await this.rpc.call<{ phyname: string }>(session, "iwinfo", "phyname", {
      section,
    });
    if (!/^phy\d+$/.test(phyname ?? "")) throw new Error("无法识别实际无线硬件。");
    const [info, frequencies, countries] = await Promise.all([
      this.rpc.call<{ htmodes?: string[] }>(session, "iwinfo", "info", { device: phyname }),
      this.rpc.call<{
        results?: {
          channel: number;
          mhz: number;
          restricted: boolean | number;
          flags?: string[];
        }[];
      }>(session, "iwinfo", "freqlist", { device: phyname }),
      this.rpc.call<{ results?: { iso3166: string; country: string }[] }>(
        session,
        "iwinfo",
        "countrylist",
        { device: phyname },
      ),
    ]);
    return {
      modes: [
        ...new Set(
          (info.htmodes ?? []).filter((m) => /^(HT|VHT|HE|EHT)(20|40|80|160|320)$/.test(m)),
        ),
      ],
      channels: (frequencies.results ?? [])
        .filter((f) => !f.restricted && Number.isInteger(f.channel) && Number.isFinite(f.mhz))
        .map((f) => ({
          channel: f.channel,
          mhz: f.mhz,
          dfs: (f.flags ?? []).some((flag) => /radar|dfs/.test(flag)),
        })),
      countries: (countries.results ?? [])
        .filter((c) => /^[A-Z]{2}$/.test(c.iso3166))
        .map((c) => ({ code: c.iso3166, name: c.country })),
    };
  }
}
export function radioDraft(snapshot: SettingsSnapshot, section: string) {
  const radio = snapshot.wireless[section];
  if (radio?.[".type"] !== "wifi-device" || (radio.type && radio.type !== "mac80211"))
    throw new Error("该射频使用高级驱动，请通过 SSH 管理。");
  return {
    country: String(radio.country ?? "00"),
    channel: String(radio.channel ?? "auto"),
    mode: String(radio.htmode ?? ""),
  };
}
export function radioPlan(
  snapshot: SettingsSnapshot,
  section: string,
  draft: ReturnType<typeof radioDraft>,
  caps: RadioCapabilities,
): ConfigPlan {
  const old = radioDraft(snapshot, section),
    values: Record<string, string> = {};
  if (draft.country !== old.country && !caps.countries.some((c) => c.code === draft.country))
    throw new Error("请选择硬件支持的国家/地区。");
  if (draft.country !== old.country && draft.channel !== "auto")
    throw new Error("修改国家/地区时请先使用自动信道，应用后再读取可用信道。");
  if (
    draft.channel !== old.channel &&
    draft.channel !== "auto" &&
    !caps.channels.some((c) => String(c.channel) === draft.channel)
  )
    throw new Error("请选择当前地区和硬件允许的信道。");
  if (draft.mode !== old.mode && !caps.modes.includes(draft.mode))
    throw new Error("请选择硬件支持的无线模式/带宽。");
  const band = wifiBand(snapshot.wireless[section]);
  if (draft.mode !== old.mode && band === "2g" && /(?:80|160|320)$/.test(draft.mode))
    throw new Error("2.4 GHz 不支持该带宽。");
  for (const [key, value] of Object.entries({
    country: draft.country,
    channel: draft.channel,
    htmode: draft.mode,
  })) {
    const previous = key === "htmode" ? old.mode : old[key as "country" | "channel"];
    if (value !== previous) values[key] = value;
  }
  return {
    label: "无线射频参数",
    address: lanDraft(snapshot).address,
    edits: Object.keys(values).length ? [{ config: "wireless", section, values }] : [],
  };
}
