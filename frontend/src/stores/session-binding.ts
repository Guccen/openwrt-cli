import { useRouter } from "./router";
import { useSettings } from "./settings";
import { useWireless } from "./wireless";
import { useMaintenance } from "./maintenance";
import { useMaintenanceOperation } from "./maintenance-operation";
import { useLeds } from "./leds";
import { useSchedule } from "./schedule";
import { useClients } from "./clients";
import { onSessionRejection, RouterClient, RpcError } from "../lib/rpc";

// 会话绑定独立于页面生命周期，避免首次路由跳转覆盖刚接收的配置事务。
export function bindSettingsSession(client = new RouterClient()) {
  let disposed = false;
  const checking = new Set<string>();
  const stopChecking = onSessionRejection((session) => {
    if (disposed || checking.has(session) || useRouter.getState().session !== session) return;
    checking.add(session);
    // ubus 6 也可能表示单个方法权限不足，先核对会话，避免把权限错误当成登出。
    const expire = () => {
      if (!disposed && useRouter.getState().session === session)
        useRouter.getState().forgetSession("登录已过期，请重新登录");
    };
    void client
      .call<{ access: boolean }>(session, "session", "access", {
        scope: "ubus",
        object: "system",
        function: "board",
      })
      .then((result) => {
        if (result?.access === false) expire();
      })
      .catch((error) => {
        if (error instanceof RpcError && error.sessionExpired) expire();
      })
      .finally(() => checking.delete(session));
  });
  const bind = (session: string | null) => {
    useSettings.getState().bind(session);
    useWireless.getState().bind(session);
    useMaintenance.getState().bind(session);
    useLeds.getState().bind(session);
    useSchedule.getState().bind(session);
    useClients.getState().bind(session);
    useMaintenanceOperation.getState().bind(session);
  };
  bind(useRouter.getState().session);
  const unsubscribe = useRouter.subscribe((state, previous) => {
    if (state.session !== previous.session) bind(state.session);
  });
  return () => {
    disposed = true;
    stopChecking();
    unsubscribe();
  };
}
