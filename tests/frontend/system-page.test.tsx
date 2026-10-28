import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { SystemPage } from "../../frontend/src/pages/system-page";
import { useMaintenance } from "../../frontend/src/stores/maintenance";
import { useMaintenanceOperation } from "../../frontend/src/stores/maintenance-operation";
import { useSettings } from "../../frontend/src/stores/settings";
import { settingsFixture } from "../helpers/settings-fixture";

function renderState(
  staged: boolean,
  configurationBusy: boolean,
  loading = false,
  capabilities = { upgradeSupported: false, resetSupported: false },
) {
  const initialMaintenance = { ...useMaintenance.getInitialState() };
  const initialSettings = { ...useSettings.getInitialState() };
  const previous = [
    useMaintenance.getState(),
    useMaintenanceOperation.getState(),
    useSettings.getState(),
  ] as const;
  try {
    useMaintenance.setState({
      session: "a".repeat(32),
      loading: false,
      error: null,
      snapshot: {
        configurationBusy,
        operationBusy: false,
        backupLimit: 131072,
        ...capabilities,
        updatedAt: 1,
      },
    });
    useMaintenanceOperation.setState({ kind: null });
    useSettings.setState({
      session: "a".repeat(32),
      snapshot: settingsFixture(true),
      pending: null,
      staged,
      loading,
      phase: "idle",
      destination: null,
      error: null,
    });
    // 静态渲染读取服务端快照，使用本用例提供的状态代替默认空状态。
    Object.assign(useMaintenance.getInitialState(), useMaintenance.getState());
    Object.assign(useSettings.getInitialState(), useSettings.getState());
    const html = renderToStaticMarkup(
      <Router ssrPath="/system/">
        <SystemPage />
      </Router>,
    );
    const reboot = html
      .match(/<button\b[^>]*>[\s\S]*?<\/button>/g)
      ?.find((button) => button.includes("重启设备"));
    expect(reboot).toBeDefined();
    return { html, disabled: reboot!.includes('disabled=""') };
  } finally {
    Object.assign(useMaintenance.getInitialState(), initialMaintenance);
    Object.assign(useSettings.getInitialState(), initialSettings);
    useMaintenance.setState(previous[0], true);
    useMaintenanceOperation.setState(previous[1], true);
    useSettings.setState(previous[2], true);
  }
}

test("当前会话的暂存提供查看入口，仍禁止直接重启", () => {
  const { html, disabled } = renderState(true, true);
  expect(html).toContain("当前会话有未应用的网络改动");
  expect(html).toContain("查看暂存改动");
  expect(disabled).toBe(true);
});

test("设备端阻塞与本地暂存分别说明，解除阻塞后重新启用维护", () => {
  const blocked = renderState(false, true);
  expect(blocked.html).toContain("完成或丢弃对应改动后会自动更新状态");
  expect(blocked.html).not.toContain("查看暂存改动");
  expect(blocked.disabled).toBe(true);
  const idle = renderState(false, false);
  expect(idle.html).not.toContain("设备仍有暂存或待确认");
  expect(idle.disabled).toBe(false);
});

test("读取配置期间临时禁用维护，不误报为未保存配置", () => {
  const { html, disabled } = renderState(false, false, true);
  expect(disabled).toBe(true);
  expect(html).not.toContain("当前会话有未应用");
  expect(html).not.toContain("正在处理网络配置");
});

test("按设备能力分别展示升级与恢复出厂卡片，不影响其他维护功能", () => {
  for (const upgradeSupported of [false, true]) {
    for (const resetSupported of [false, true]) {
      const { html } = renderState(false, false, false, { upgradeSupported, resetSupported });
      expect(html.includes("升级固件")).toBe(upgradeSupported);
      expect(html.includes("恢复出厂设置")).toBe(resetSupported);
      expect(html).not.toContain("当前设备或存储布局不支持此操作");
      expect(html).toContain("恢复系统配置");
      expect(html).toContain("重启设备");
    }
  }
});
