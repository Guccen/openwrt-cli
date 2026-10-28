import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioClient,
  defaultRadioMode,
  radioDraft,
  radioModes,
  radioPlan,
  recommendedRadioMode,
  type RadioCapabilities,
} from "@/lib/radio-settings";
import { wifiBand, wifiBandLabel, type WifiBand } from "@/lib/wifi-band";
import { useRouter } from "@/stores/router";
import type { SettingsFormProps } from "./settings-section";
import { RadioAdvice } from "./radio-advice";
const client = new RadioClient();
export function RadioForm({
  snapshot,
  review,
  disabled,
  section,
  singleRadio = false,
}: SettingsFormProps & { section: string; singleRadio?: boolean }) {
  const session = useRouter((s) => s.session),
    [draft, setDraft] = useState(() => radioDraft(snapshot, section));
  const [caps, setCaps] = useState<RadioCapabilities | null>(null),
    [error, setError] = useState<string | null>(null),
    [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (session)
      void client
        .read(session, section, controller.signal, !singleRadio)
        .then((value) => {
          if (active) {
            setCaps(value);
            setError(null);
          }
        })
        .catch((e) => {
          if (active) {
            setCaps(null);
            setError(e instanceof Error ? e.message : "读取失败");
          }
        });
    return () => {
      active = false;
      controller.abort();
    };
  }, [session, section, attempt, singleRadio]);
  const band = draft.band;
  const countries = caps?.countries ?? [],
    modes = caps ? radioModes(caps, band, draft.channel) : [];
  const channels =
    caps?.channels.filter((c) =>
      band === "2g" ? c.mhz < 3000 : band === "5g" ? c.mhz >= 4900 && c.mhz < 5925 : true,
    ) ?? [];
  const locked = disabled || !caps;
  const original = radioDraft(snapshot, section);
  const changedLocation = draft.country !== original.country || draft.channel !== original.channel;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {wifiBandLabel(band)} 射频 · {section}
        </CardTitle>
        <CardDescription>
          信道和带宽按真实驱动能力提供。修改会重启同一射频上的所有
          WiFi，请选择设备实际使用的国家/地区。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 space-y-2 text-xs text-muted-foreground">
            <p>射频能力暂不可用：{error}。可继续设置上方的 WiFi 名称和密码。</p>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => retry(attempt + 1)}
            >
              重试读取射频
            </Button>
          </div>
        )}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (caps) review(() => radioPlan(snapshot, section, draft, caps));
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {singleRadio && (
              <div className="space-y-1.5">
                <Label htmlFor={`${section}-band`}>工作频段</Label>
                <Select
                  disabled={locked}
                  value={band}
                  onValueChange={(value) => {
                    const next = value as WifiBand;
                    const available =
                      caps?.channels.filter((c) => wifiBand({}, c.mhz) === next && !c.dfs) ?? [];
                    const channel = available.length ? String(available[0].channel) : "auto";
                    setDraft({
                      ...draft,
                      band: next,
                      channel,
                      mode: caps ? defaultRadioMode(caps, next, channel) : "",
                    });
                  }}
                >
                  <SelectTrigger id={`${section}-band`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["2g", "5g"] as const)
                      .filter(
                        (value) =>
                          value === band ||
                          caps?.bands?.includes(value) ||
                          caps?.channels.some((c) => wifiBand({}, c.mhz) === value),
                      )
                      .map((value) => (
                        <SelectItem key={value} value={value}>
                          {wifiBandLabel(value)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`${section}-country`}>国家/地区</Label>
              <Select
                disabled={locked}
                value={draft.country}
                onValueChange={(country) =>
                  setDraft({
                    ...draft,
                    country,
                    channel: "auto",
                    ...(!singleRadio ? { txpower: "auto" } : {}),
                  })
                }
              >
                <SelectTrigger id={`${section}-country`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!countries.some((c) => c.code === draft.country) && (
                    <SelectItem value={draft.country}>
                      {draft.country === "00" ? "世界默认（00）" : draft.country}
                    </SelectItem>
                  )}
                  {countries.map((c) => (
                    <SelectItem value={c.code} key={c.code}>
                      {c.code} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${section}-channel`}>信道</Label>
              <Select
                disabled={locked || draft.country !== radioDraft(snapshot, section).country}
                value={draft.channel}
                onValueChange={(channel) =>
                  setDraft({
                    ...draft,
                    channel,
                    ...(!singleRadio ? { txpower: "auto" } : {}),
                    mode:
                      caps && !radioModes(caps, band, channel).includes(draft.mode)
                        ? defaultRadioMode(caps, band, channel)
                        : draft.mode,
                  })
                }
              >
                <SelectTrigger id={`${section}-channel`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  {draft.channel !== "auto" &&
                    !channels.some((c) => String(c.channel) === draft.channel) && (
                      <SelectItem value={draft.channel}>当前：{draft.channel}</SelectItem>
                    )}
                  {channels.map((c) => (
                    <SelectItem value={String(c.channel)} key={`${c.channel}-${c.mhz}`}>
                      {c.channel} · {c.mhz} MHz{c.dfs ? "（DFS）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${section}-mode`}>无线模式 / 带宽</Label>
              <Select
                disabled={locked}
                value={draft.mode || "current"}
                onValueChange={(mode) => setDraft({ ...draft, mode })}
              >
                <SelectTrigger id={`${section}-mode`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!modes.includes(draft.mode) && (
                    <SelectItem value={draft.mode || "current"} disabled>
                      {draft.mode ? `${draft.mode}（当前不可用）` : "请选择可用模式"}
                    </SelectItem>
                  )}
                  {modes.map((m) => (
                    <SelectItem value={m} key={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!singleRadio && (
            <div className="space-y-2">
              <Label htmlFor={`${section}-power`}>发射功率上限</Label>
              <Select
                disabled={locked}
                value={draft.txpower}
                onValueChange={(txpower) => setDraft({ ...draft, txpower })}
              >
                <SelectTrigger id={`${section}-power`} className="w-full sm:max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">驱动自动</SelectItem>
                  {draft.txpower !== "auto" &&
                    !caps?.powerLevels?.some((value) => String(value) === draft.txpower) && (
                      <SelectItem value={draft.txpower} disabled>
                        当前：{draft.txpower} dBm
                      </SelectItem>
                    )}
                  {(caps?.powerLevels ?? []).map((value) => (
                    <SelectItem key={value} value={String(value)} disabled={changedLocation}>
                      {value} dBm
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                驱动自动会取消手动功率限制，实际功率由硬件、地区和信道共同决定。修改地区或信道后，请先应用再读取可用功率。
                {caps && !caps.powerLevels?.length && " 当前未读取到可选功率，仍可恢复驱动自动。"}
              </p>
              {caps && draft.country === original.country && (
                <div className="flex flex-wrap gap-2">
                  {(["speed", "stable"] as const)
                    .filter((preference) => preference === "speed" || band === "5g")
                    .map((preference) => {
                      const mode = recommendedRadioMode(caps, band, draft.channel, preference);
                      return (
                        <Button
                          type="button"
                          variant="outline"
                          key={preference}
                          disabled={locked || !mode || mode === draft.mode}
                          onClick={() => setDraft({ ...draft, mode })}
                        >
                          {band === "2g" || preference === "stable" ? "稳定优先" : "速度优先"}
                          {mode ? ` · ${mode}` : ""}
                        </Button>
                      );
                    })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                预设只填入带宽，应用后再比较效果。隔墙优先尝试 2.4
                GHz；提高路由器功率不能改善手机的回传能力。
              </p>
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            HE 为 WiFi 6，VHT 为 WiFi 5。带宽已按当前信道的驱动限制筛选。DFS
            信道可能等待雷达检测后才出现，修改地区后请重新读取信道。
          </p>
          {caps && draft.country === radioDraft(snapshot, section).country && (
            <RadioAdvice
              caps={caps}
              band={band}
              channel={draft.channel}
              singleRadio={singleRadio}
            />
          )}
          <Button disabled={locked}>应用射频参数</Button>
        </form>
      </CardContent>
    </Card>
  );
}
