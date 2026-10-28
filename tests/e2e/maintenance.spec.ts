import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { loginPage, navigate } from "./helpers";

// 系统归档可能包含测试机密钥，不在 trace/HAR 或报告中保留下载内容。
test.use({ trace: "off" });
test("exports a verified archive and cancels reboot without a write", async ({
  page,
}, testInfo) => {
  await loginPage(page);
  await navigate(page, "系统维护");
  let reboots = 0;
  page.on("request", (request) => {
    const params = request.url().endsWith("/ubus") ? request.postDataJSON()?.params : null;
    if (params?.[1] === "router.maintenance" && params?.[2] === "reboot") ++reboots;
  });
  await page.getByRole("button", { name: "重启设备", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(reboots).toBe(0);
  if (process.env.SIM_BASE_URL?.startsWith("https://")) {
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出系统配置", exact: true }).click();
    const download = await downloadEvent;
    const bytes = await readFile((await download.path())!);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length).toBeLessThanOrEqual(131072);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    await expect(
      page.getByText("系统配置备份已通过 SHA-256 校验并下载。", { exact: true }),
    ).toBeVisible();
    await download.delete();
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("system-maintenance.png"), fullPage: true });
});

test("accepted reboot blocks configuration across page navigation", async ({ page }) => {
  await loginPage(page);
  await navigate(page, "系统维护");
  // 此用例只验证页面互斥，不重启共享测试机；真实重启由独立运行时测试完成。
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.[1] === "router.maintenance" && body.params[2] === "reboot")
      await route.fulfill({
        json: { jsonrpc: "2.0", id: body.id, result: [0, { ok: true, accepted: true }] },
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "重启设备", exact: true }).click();
  await page.getByRole("button", { name: "确认重启", exact: true }).click();
  await expect(
    page.getByText("已发送重启请求，正在等待设备恢复连接…", { exact: true }),
  ).toBeVisible();
  await navigate(page, "LAN 设置");
  await expect(page.getByLabel("LAN IPv4 地址", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "应用 LAN 设置", exact: true })).toBeDisabled();
  await navigate(page, "系统维护");
  await expect(
    page.getByText("已发送重启请求，正在等待设备恢复连接…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "导出系统配置", exact: true })).toBeDisabled();
});

test("设备端旧会话暂存清理后自动解除维护禁用", async ({ page }) => {
  await loginPage(page);
  let blocked = true;
  let reboots = 0;
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    const [, object, method] = body?.params ?? [];
    if (object === "router.maintenance" && method === "reboot") ++reboots;
    if (object === "uci" && method === "changes")
      await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: [0, { changes: {} }] } });
    else if (object === "router.maintenance" && method === "status")
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          result: [0, { ok: true, configurationBusy: blocked, operationBusy: false }],
        },
      });
    else await route.continue();
  });
  await navigate(page, "系统维护");
  await expect(page.getByRole("button", { name: "重启设备", exact: true })).toBeDisabled();
  await expect(page.getByText(/设备仍有暂存或待确认的网络配置/)).toBeVisible();
  blocked = false;
  await expect(page.getByRole("button", { name: "重启设备", exact: true })).toBeEnabled();
  await expect(page.getByText(/设备仍有暂存或待确认的网络配置/)).toHaveCount(0);
  expect(reboots).toBe(0);
});

test("手动刷新同时核对当前会话暂存与维护状态", async ({ page }) => {
  await loginPage(page);
  let staged = true;
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    const [, object, method] = body?.params ?? [];
    if (object === "uci" && method === "changes")
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          result: [0, { changes: staged ? { network: [["set", "lan6", "auto", "1"]] } : {} }],
        },
      });
    else if (object === "router.maintenance" && method === "status")
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          result: [0, { ok: true, configurationBusy: staged, operationBusy: false }],
        },
      });
    else await route.continue();
  });
  await navigate(page, "系统维护");
  await expect(page.getByRole("link", { name: "查看暂存改动", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重启设备", exact: true })).toBeDisabled();
  staged = false;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("link", { name: "查看暂存改动", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重启设备", exact: true })).toBeEnabled();
});
