import { CircleCheck } from "lucide-react";
import { useRouter } from "@/stores/router";
import { useWireless } from "@/stores/wireless";
import { useMaintenance } from "@/stores/maintenance";
import { useLocation } from "wouter";
import { pageForPath } from "@/lib/routes";
import { useLeds } from "@/stores/leds";
import { useClients } from "@/stores/clients";

export function DeviceFooter() {
  const snapshot = useRouter((state) => state.snapshot);
  const wireless = useWireless((state) => state.snapshot);
  const maintenance = useMaintenance((state) => state.snapshot);
  const leds = useLeds((state) => state.snapshot);
  const clients = useClients((state) => state.snapshot);
  const [location] = useLocation();
  const page = pageForPath(location);
  const updated =
    page === "clients"
      ? clients?.updatedAt
      : page === "leds"
        ? leds?.updatedAt
        : page === "wirelessStatus"
          ? wireless?.updatedAt
          : page === "system"
            ? maintenance?.updatedAt
            : snapshot?.updatedAt;
  return (
    <footer className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <CircleCheck className="size-3" />
      {updated ? `更新于 ${new Date(updated).toLocaleTimeString("zh-CN")}` : "等待设备状态"}
      <span className="ml-auto">手动刷新 · 按需读取</span>
    </footer>
  );
}
