import { expect, test } from "bun:test";
import { bindSettingsSession } from "../../frontend/src/stores/session-binding";
import { useRouter } from "../../frontend/src/stores/router";
import { useSettings, type PendingApply } from "../../frontend/src/stores/settings";
import axios from "axios";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";

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

test("单个 RPC 权限不足不登出，设备确认会话失效才清除所有页面状态", async () => {
  const sid = "a".repeat(32);
  const forbidden = new RouterClient(
    axios.create({
      adapter: async (config) => ({
        data: { result: [6] },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      }),
    }),
  );
  let access = true;
  const verifier = { call: async () => ({ access }) } as unknown as RouterClient;
  const stop = bindSettingsSession(verifier);
  try {
    useRouter.getState().adoptSession(sid);
    await expect(forbidden.call(sid, "router.status", "clients")).rejects.toBeInstanceOf(RpcError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useRouter.getState().session).toBe(sid);
    access = false;
    await expect(forbidden.call(sid, "router.status", "clients")).rejects.toBeInstanceOf(RpcError);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useRouter.getState().session).toBeNull();
    expect(useSettings.getState().session).toBeNull();
  } finally {
    stop();
    useRouter.getState().forgetSession();
  }
});
