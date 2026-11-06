import { useRouter } from "./router";
import { useSettings } from "./settings";
import { useMaintenanceOperation } from "./maintenance-operation";
import { onSessionRejection, RouterClient, RpcError } from "../lib/rpc";

type SessionBinder = (session: string | null) => void;
const sessionBinders = new Set<SessionBinder>();
let bindingActive = false;
let currentSession: string | null = null;

/** 页面按需加载的 store 注册后立即同步当前会话，避免首屏静态引入所有管理模块。 */
export function registerSessionBinder(bind: SessionBinder) {
  sessionBinders.add(bind);
  if (bindingActive) bind(currentSession);
  return () => sessionBinders.delete(bind);
}

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
    currentSession = session;
    useSettings.getState().bind(session);
    useMaintenanceOperation.getState().bind(session);
    for (const bindSession of sessionBinders) bindSession(session);
  };
  bindingActive = true;
  bind(useRouter.getState().session);
  const unsubscribe = useRouter.subscribe((state, previous) => {
    if (state.session !== previous.session) bind(state.session);
  });
  return () => {
    bindingActive = false;
    disposed = true;
    stopChecking();
    unsubscribe();
  };
}
