import { useRouter } from "./router";
import { useSettings } from "./settings";

// 会话绑定独立于页面生命周期，避免首次路由跳转覆盖刚接收的配置事务。
export function bindSettingsSession() {
  useSettings.getState().bind(useRouter.getState().session);
  return useRouter.subscribe((state, previous) => {
    if (state.session !== previous.session) useSettings.getState().bind(state.session);
  });
}
