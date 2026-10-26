import { expect, test } from "bun:test";
import { bindSettingsSession } from "../../frontend/src/stores/session-binding";
import { useRouter } from "../../frontend/src/stores/router";
import { useSettings, type PendingApply } from "../../frontend/src/stores/settings";

test("页面挂载前接收的应用事务不会被会话绑定清除，退出和换会话会清理", () => {
  useRouter.setState({ session: null });
  const unbind = bindSettingsSession();
  const pending: PendingApply = {
    label: "LAN 设置",
    deadline: Date.now() + 120000,
    oldOrigin: "https://192.168.68.1",
    newOrigin: "https://192.168.68.2",
    address: "192.168.68.2",
    previousAddress: "192.168.68.1",
    configs: ["network"],
  };
  try {
    useSettings.getState().adopt("a".repeat(32), pending);
    useRouter.setState({ session: "a".repeat(32) });
    expect(useSettings.getState().pending).toBe(pending);
    useRouter.setState({ session: "b".repeat(32) });
    expect(useSettings.getState().pending).toBeNull();
    useSettings.getState().adopt("b".repeat(32), pending);
    useRouter.setState({ session: null });
    expect(useSettings.getState().pending).toBeNull();
    expect(useSettings.getState().session).toBeNull();
  } finally {
    unbind();
    useRouter.setState({ session: null });
    useSettings.getState().bind(null);
  }
});
