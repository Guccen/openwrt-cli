import { afterEach, expect, mock, test } from "bun:test";
import { toast, type ToastT } from "sonner";
import { notify } from "../../frontend/src/lib/notifications";
import { bindNotifications } from "../../frontend/src/stores/notification-binding";
import { createRouterStore } from "../../frontend/src/stores/router";
import { createSettingsStore } from "../../frontend/src/stores/settings";
import { validateTimeServers } from "../../frontend/src/lib/time-settings";
import { DiagnosticInputError, DiagnosticsClient } from "../../frontend/src/lib/diagnostics";
import type { RouterClient } from "../../frontend/src/lib/rpc";

const active = () => toast.getToasts().filter((item): item is ToastT => !("dismiss" in item));
afterEach(() => notify.clear());

test("重复操作更新同一条通知，失败替换成功内容并保留更长阅读时间", () => {
  notify.clear();
  for (let count = 0; count < 20; ++count)
    notify.success("system-backup", "备份已校验", "已发起下载");
  expect(active()).toHaveLength(1);
  const success = active()[0]!;
  notify.error("system-backup", new Error("设备拒绝备份请求"));
  expect(active()).toHaveLength(1);
  expect(active()[0]).toMatchObject({ id: success.id, title: "设备拒绝备份请求", type: "error" });
  expect(active()[0]!.description).toBeUndefined();
  expect(active()[0]!.duration!).toBeGreaterThan(success.duration!);
  notify.error("system-backup", null, "无法导出备份");
  expect(active()[0]!.title).toBe("无法导出备份");
});

test("后台刷新和重新订阅不重放通知，重复的独立操作仍能反馈", () => {
  const router = createRouterStore();
  const settings = createSettingsStore();
  const session = "a".repeat(32);
  router.setState({ session });
  settings.setState({ session, notice: "已有结果" });
  const notifications = { ...notify, success: mock(notify.success), info: mock(notify.info) };
  let stop = bindNotifications(router, settings, notifications);
  try {
    expect(notifications.success).toHaveBeenCalledTimes(0);
    settings.setState({ notice: null });
    settings.setState({ notice: "已丢弃暂存改动" });
    settings.setState({ loading: true, revision: 1 });
    settings.setState({ loading: false, revision: 2 });
    expect(notifications.success).toHaveBeenCalledTimes(1);
    stop();
    stop = bindNotifications(router, settings, notifications);
    expect(notifications.success).toHaveBeenCalledTimes(1);
    settings.setState({ notice: null });
    settings.setState({ notice: "已丢弃暂存改动" });
    expect(notifications.success).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
  settings.setState({ notice: "已停止订阅" });
  expect(notifications.success).toHaveBeenCalledTimes(2);
});

test("退出及换会话清理通知，旧会话的迟到结果不展示给新登录用户", () => {
  const router = createRouterStore();
  const settings = createSettingsStore();
  const previous = "a".repeat(32),
    next = "b".repeat(32);
  router.setState({ session: previous });
  settings.getState().bind(previous);
  const notifications = { ...notify, success: mock(notify.success) };
  const stop = bindNotifications(router, settings, notifications);
  try {
    settings.setState({ notice: "设置已确认并保留" });
    expect(active()).toHaveLength(1);
    router.setState({ session: next });
    expect(active()).toHaveLength(0);
    settings.setState({ notice: "旧请求迟到" });
    expect(notifications.success).toHaveBeenCalledTimes(1);
    settings.getState().bind(next);
    settings.setState({ notice: "新的保存结果" });
    expect(active()[0]!.title).toBe("新的保存结果");
    router.setState({ session: null });
    expect(active()).toHaveLength(0);
  } finally {
    stop();
  }
});

test("改址入口和待确认事务保持页面提示，恢复请求使用普通通知而非完成提示", () => {
  const router = createRouterStore();
  const settings = createSettingsStore();
  const session = "a".repeat(32);
  router.setState({ session });
  settings.getState().bind(session);
  const notifications = { ...notify, success: mock(notify.success), info: mock(notify.info) };
  const stop = bindNotifications(router, settings, notifications);
  try {
    settings.getState().adopt(session, {
      label: "LAN 设置",
      deadline: Date.now() + 120000,
      oldOrigin: "https://192.168.68.1",
      newOrigin: "https://192.168.68.2",
      address: "192.168.68.2",
      previousAddress: "192.168.68.1",
      configs: ["network"],
    });
    settings.setState({ notice: "事务尚未确认" });
    expect(notifications.success).toHaveBeenCalledTimes(0);
    expect(settings.getState().pending).not.toBeNull();
    settings.setState({ pending: null, notice: null });
    settings.setState({ destination: "https://192.168.68.2", notice: "请返回原地址" });
    expect(notifications.success).toHaveBeenCalledTimes(0);
    expect(settings.getState().destination).toBe("https://192.168.68.2");
    settings.setState({ destination: null, notice: null, phase: "restoring" });
    settings.setState({ phase: "idle", notice: "已请求恢复原设置" });
    expect(notifications.success).toHaveBeenCalledTimes(0);
    expect(notifications.info).toHaveBeenCalledWith("network-settings", "已请求恢复原设置");
  } finally {
    stop();
  }
});

test("时间设置在表单提交前拦截缺失服务器、超量和命令或 URL 输入", () => {
  const settings = {
    zone: "Asia/Shanghai",
    enabled: true,
    useDhcp: false,
    servers: ["ntp.aliyun.com", "2400:3200::1"],
  };
  expect(() => validateTimeServers(settings)).not.toThrow();
  expect(() => validateTimeServers({ ...settings, servers: [], useDhcp: true })).not.toThrow();
  expect(() => validateTimeServers({ ...settings, enabled: false, servers: [] })).not.toThrow();
  for (const servers of [
    [],
    ["https://ntp.aliyun.com"],
    ["ntp.aliyun.com:123"],
    ["a;reboot"],
    ["-a.example"],
    ["a.example", "b.example", "c.example", "d.example", "e.example"],
  ])
    expect(() => validateTimeServers({ ...settings, servers })).toThrow();
});

test("诊断目标校验与设备操作故障可分别展示，不把探测不通当作请求失败", async () => {
  let response: Record<string, unknown> = { ok: false, error: "invalid_target" };
  const client = new DiagnosticsClient({ call: async () => response } as unknown as RouterClient);
  await expect(client.run("session", "ping4", "https://example.com")).rejects.toBeInstanceOf(
    DiagnosticInputError,
  );
  response = { ok: false, error: "operation_busy" };
  await expect(client.run("session", "ping4", "1.1.1.1")).rejects.toThrow("另一项诊断");
  response = { ok: true, success: false, code: 1, output: "目标不可达", limited: false };
  expect(await client.run("session", "ping4", "1.1.1.1")).toMatchObject({
    success: false,
    output: "目标不可达",
  });
});
