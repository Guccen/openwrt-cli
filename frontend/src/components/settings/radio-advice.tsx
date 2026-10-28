import { Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  defaultRadioMode,
  recommendedRadioMode,
  radioModes,
  type RadioCapabilities,
} from "@/lib/radio-settings";
import type { WifiBand } from "@/lib/wifi-band";

export function RadioAdvice({
  caps,
  band,
  channel,
  singleRadio,
}: {
  caps: RadioCapabilities;
  band: WifiBand;
  channel: string;
  singleRadio: boolean;
}) {
  if (band !== "2g" && band !== "5g") return null;
  const modes = radioModes(caps, band, channel);
  const preferred = singleRadio
    ? defaultRadioMode(caps, band, channel)
    : recommendedRadioMode(caps, band, channel, "speed");
  const candidates =
    band === "2g" ? (singleRadio ? [6, 11, 1] : [1, 6, 11]) : singleRadio ? [149, 36] : [36, 149];
  const channels = preferred
    ? candidates.filter((candidate) =>
        radioModes(caps, band, String(candidate)).includes(preferred),
      )
    : [];
  const limited =
    band === "5g" &&
    modes.length > 0 &&
    caps.modes.some((mode) => /80$/.test(mode)) &&
    !modes.some((mode) => /80$/.test(mode));

  return (
    <aside
      aria-label="无线参数建议"
      className="space-y-2 rounded-lg border border-blue-200/70 bg-blue-50/60 p-3 text-xs leading-relaxed dark:border-blue-400/20 dark:bg-blue-400/5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Lightbulb aria-hidden="true" className="size-3.5 text-blue-700 dark:text-blue-300" />
        <span className="font-medium">参数建议</span>
        <Badge>{singleRadio || band === "2g" ? "稳定优先" : "速度优先"}</Badge>
        {preferred && <Badge variant="secondary">{preferred}</Badge>}
      </div>
      <p>
        {band === "2g"
          ? "2.4 GHz 优先使用 20 MHz，两台设备同时开启时尽量错开信道。"
          : singleRadio
            ? "N1 先使用 20 MHz 验证连接，稳定后再尝试驱动允许的更宽带宽；2.4 / 5 GHz 只能选一个。"
            : "京东云 5 GHz 优先使用驱动允许的 80 MHz，兼容性或干扰较差时再缩小带宽。"}
        {channels.length > 0 && ` 可参考信道：${channels.join(" / ")}，仍需结合现场干扰选择。`}
      </p>
      {limited && (
        <p className="text-amber-800 dark:text-amber-300">
          当前信道不允许 80 MHz，请使用列表中的较窄带宽，以免热点启动失败。
        </p>
      )}
      {!preferred && <p>当前没有合适的建议模式，请先选择可用信道并重新读取射频能力。</p>}
      <p className="text-muted-foreground">
        地区按实际所在地选择，中国大陆使用 CN。建议先用 WPA2
        个人版验证连接；协商速率与宽带测速不同，参数建议不会自动应用。
      </p>
    </aside>
  );
}
