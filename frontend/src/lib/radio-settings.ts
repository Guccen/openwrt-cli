import { RouterClient, WIRELESS_READ_TIMEOUT } from "./rpc";
import { lanDraft, type ConfigPlan, type SettingsSnapshot } from "./settings";
import { wifiBand, type WifiBand } from "./wifi-band";
export interface RadioCapabilities {
  bands?: WifiBand[];
  modes: string[];
  channels: { channel: number; mhz: number; dfs: boolean; flags?: string[] }[];
  countries: { code: string; name: string }[];
}
export class RadioClient {
  constructor(readonly rpc = new RouterClient()) {}
  async read(
    session: string,
    section: string,
    cancelled?: AbortSignal,
  ): Promise<RadioCapabilities> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(WIRELESS_READ_TIMEOUT),
      ...(cancelled ? [cancelled] : []),
    ]);
    const { phyname } = await this.rpc.call<{ phyname: string }>(
      session,
      "iwinfo",
      "phyname",
      {
        section,
      },
      undefined,
      signal,
    );
    if (!/^phy\d+$/.test(phyname ?? "")) throw new Error("无法识别实际无线硬件。");
    const [info, frequencies, countries] = await Promise.all([
      this.rpc.call<{ htmodes?: string[] }>(
        session,
        "iwinfo",
        "info",
        { device: phyname },
        undefined,
        signal,
      ),
      this.rpc.call<{
        results?: {
          channel: number;
          mhz: number;
          restricted: boolean | number;
          flags?: string[];
        }[];
      }>(session, "iwinfo", "freqlist", { device: phyname }, undefined, signal),
      this.rpc.call<{ results?: { iso3166: string; country: string }[] }>(
        session,
        "iwinfo",
        "countrylist",
        { device: phyname },
        undefined,
        signal,
      ),
    ]);
    return {
      bands: [
        ...new Set(
          (frequencies.results ?? [])
            .map((f) => wifiBand({}, f.mhz))
            .filter((band) => band !== "unknown"),
        ),
      ],
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
          flags: f.flags ?? [],
        })),
      countries: (countries.results ?? [])
        .filter((c) => /^[A-Z]{2}$/.test(c.iso3166))
        .map((c) => ({ code: c.iso3166, name: c.country })),
    };
  }
}

export function radioModes(caps: RadioCapabilities, band: WifiBand, channel: string) {
  const channels = caps.channels.filter(
    (item) =>
      wifiBand({}, item.mhz) === band && (channel === "auto" || String(item.channel) === channel),
  );
  return caps.modes.filter((mode) => {
    if (band === "2g" && (/^VHT/.test(mode) || /(?:80|160|320)$/.test(mode))) return false;
    const width = Number(mode.match(/\d+$/)?.[0]);
    // 芯片支持某种模式，不代表当前信道允许该带宽；自动信道也至少需要一个可用候选。
    return channels.some(({ flags = [] }) => {
      if (flags.includes(`no_${width}mhz`)) return false;
      if (/^HE/.test(mode) && flags.includes("no_he")) return false;
      if (/^EHT/.test(mode) && (flags.includes("no_he") || flags.includes("no_eht"))) return false;
      if (width === 40 && flags.includes("no_ht40+") && flags.includes("no_ht40-")) return false;
      return true;
    });
  });
}

export function defaultRadioMode(caps: RadioCapabilities, band: WifiBand, channel: string) {
  const modes = radioModes(caps, band, channel);
  // 切换频段先使用允许的二十兆赫模式，避免自动选择尚未验证的宽信道。
  return (
    (band === "5g" && modes.includes("VHT20") ? "VHT20" : modes.find((m) => /20$/.test(m))) ?? ""
  );
}

export function radioDraft(snapshot: SettingsSnapshot, section: string) {
  const radio = snapshot.wireless[section];
  if (radio?.[".type"] !== "wifi-device" || (radio.type && radio.type !== "mac80211"))
    throw new Error("该射频使用高级驱动，请通过 SSH 管理。");
  return {
    band: wifiBand(radio),
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
  const band = draft.band;
  if (
    band !== old.band &&
    !(caps.bands?.includes(band) ?? caps.channels.some((c) => wifiBand({}, c.mhz) === band))
  )
    throw new Error("请选择当前硬件支持的频段。");
  if (draft.country !== old.country && !caps.countries.some((c) => c.code === draft.country))
    throw new Error("请选择硬件支持的国家/地区。");
  if (draft.country !== old.country && draft.channel !== "auto")
    throw new Error("修改国家/地区时请先使用自动信道，应用后再读取可用信道。");
  if (
    (draft.channel !== old.channel || band !== old.band) &&
    draft.channel !== "auto" &&
    !caps.channels.some((c) => String(c.channel) === draft.channel && wifiBand({}, c.mhz) === band)
  )
    throw new Error("请选择当前地区和硬件允许的信道。");
  if (
    (draft.mode !== old.mode ||
      band !== old.band ||
      draft.channel !== old.channel ||
      draft.country !== old.country) &&
    !radioModes(caps, band, draft.channel).includes(draft.mode)
  )
    throw new Error("当前频段、信道或驱动不支持该无线模式/带宽，请选择可用的较窄带宽。");
  for (const [key, value] of Object.entries({
    country: draft.country,
    channel: draft.channel,
    htmode: draft.mode,
  })) {
    const previous = key === "htmode" ? old.mode : old[key as "country" | "channel"];
    if (value !== previous) values[key] = value;
  }
  if (band !== old.band) values.band = band;
  return {
    label: "无线射频参数",
    address: lanDraft(snapshot).address,
    edits: Object.keys(values).length ? [{ config: "wireless", section, values }] : [],
  };
}
