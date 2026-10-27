import { useRouter } from "./router";
import { useSettings } from "./settings";
import { useWireless } from "./wireless";
import { useMaintenance } from "./maintenance";
import { useMaintenanceOperation } from "./maintenance-operation";
import { useLeds } from "./leds";

// 会话绑定独立于页面生命周期，避免首次路由跳转覆盖刚接收的配置事务。
export function bindSettingsSession() {
  const bind = (session: string | null) => {
    useSettings.getState().bind(session);
    useWireless.getState().bind(session);
    useMaintenance.getState().bind(session);
    useLeds.getState().bind(session);
    useMaintenanceOperation.getState().bind(session);
  };
  bind(useRouter.getState().session);
  return useRouter.subscribe((state, previous) => {
    if (state.session !== previous.session) bind(state.session);
  });
}
