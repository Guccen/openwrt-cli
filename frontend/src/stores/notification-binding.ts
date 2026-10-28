import { notify } from "../lib/notifications";
import { useRouter } from "./router";
import { useSettings } from "./settings";

// 只订阅已经发生的操作结果，页面切换、重复渲染和后台读取不重放通知。
export function bindNotifications(
  router = useRouter,
  settings = useSettings,
  notifications = notify,
) {
  const stopRouter = router.subscribe((state, previous) => {
    if (state.session !== previous.session) notifications.clear();
  });
  const stopSettings = settings.subscribe((state, previous) => {
    if (
      !state.session ||
      state.session !== router.getState().session ||
      !state.notice ||
      state.notice === previous.notice ||
      state.pending ||
      state.destination
    )
      return;
    if (previous.phase === "restoring") notifications.info("network-settings", state.notice);
    else notifications.success("network-settings", state.notice);
  });
  return () => {
    stopRouter();
    stopSettings();
  };
}
