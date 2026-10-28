import { expect, test, type Page } from "@playwright/test";
import type { SchedulePolicy } from "../../frontend/src/lib/schedule";
import { loginPage, mockRpc, navigate } from "./helpers";

// 专用 RPC 使用受控响应，浏览器回归不会在共享设备上启用重启计划。
async function mockSchedule(page: Page, options: { cronRunning?: boolean; error?: string } = {}) {
  let policy: SchedulePolicy = { enabled: false, time: "03:00", days: [0, 1, 2, 3, 4, 5, 6] };
  const writes: SchedulePolicy[] = [];
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    const [, object, method, args] = body?.params ?? [];
    if (object !== "router.maintenance" || !["schedule_status", "schedule_save"].includes(method))
      return route.continue();
    let result: object;
    if (method === "schedule_save") {
      writes.push(structuredClone(args));
      if (options.error) result = { ok: false, error: options.error };
      else {
        policy = structuredClone(args);
        result = { ok: true };
      }
    } else {
      result = {
        ok: true,
        policy,
        localTime: "2026-10-27 12:00:00",
        timezone: "Asia/Shanghai",
        next: policy.enabled ? "2026-10-28 04:15:00" : null,
        last: {
          at: 1793088000,
          localTime: "2026-10-27 03:00:00",
          outcome: "skipped",
          reason: "configuration_busy",
          slot: "2026-10-27 03:00",
        },
        cronRunning: options.cronRunning ?? true,
      };
    }
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: [0, result] } });
  });
  return writes;
}

test("scheduled reboot requires confirmation, preserves weekday/time and can be disabled", async ({
  page,
}, info) => {
  const writes = await mockSchedule(page);
  await loginPage(page);
  await navigate(page, "定时任务");
  const enabled = page.getByRole("switch", { name: "启用定时重启", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await page.getByLabel("执行时间", { exact: true }).fill("04:15");
  await page.getByRole("button", { name: "工作日", exact: true }).click();
  await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("每周一至周五 04:15（Asia/Shanghai）");
  await expect(dialog).toContainText("网络连接会短暂中断");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
  await dialog.getByRole("button", { name: "确认保存计划", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").getByText("定时重启计划已保存", { exact: true }),
  ).toBeVisible();
  await expect(enabled).toBeEnabled();
  expect(writes).toEqual([{ enabled: true, time: "04:15", days: [1, 2, 3, 4, 5] }]);
  await expect(page.getByText("2026-10-28 04:15:00", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "周日", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.screenshot({ path: info.outputPath("schedule-enabled.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("执行时间", { exact: true }).fill("04:30");
  await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
  await expect(dialog).toContainText("每周一至周五 04:30（Asia/Shanghai）");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toHaveLength(1);
  await enabled.click();
  await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").getByText("定时重启已关闭", { exact: true }),
  ).toBeVisible();
  expect(writes[1]).toEqual({ enabled: false, time: "04:30", days: [1, 2, 3, 4, 5] });
  await expect(dialog).toHaveCount(0);
});

test("cron warnings and device save errors remain visible", async ({ page }) => {
  const writes = await mockSchedule(page, { cronRunning: false, error: "configuration_busy" });
  await loginPage(page);
  await navigate(page, "定时任务");
  await expect(
    page.getByText("cron 服务未运行，定时任务无法触发。请先启动 cron 服务，再重新读取状态。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("存在暂存或待确认的网络配置", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "启用定时重启", exact: true }).click();
  await page.getByRole("button", { name: "保存定时任务", exact: true }).click();
  await page.getByRole("button", { name: "确认保存计划", exact: true }).click();
  await expect(
    page.getByText("设备存在暂存或待确认的配置，请先确认或恢复网络设置。", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  await expect(page.getByRole("button", { name: "保存定时任务", exact: true })).toBeEnabled();
});

test("staged network configuration blocks schedule changes without sending a write", async ({
  page,
}) => {
  const writes = await mockSchedule(page);
  await mockRpc(page, (body) => {
    if (body.params[1] !== "uci" || body.params[2] !== "changes") return;
    return [0, { changes: { network: [["set", "lan", "ipaddr", "192.168.68.1"]] } }];
  });
  await loginPage(page);
  await navigate(page, "LAN 设置");
  await expect(page.getByRole("button", { name: "丢弃暂存改动", exact: true })).toBeVisible();
  await navigate(page, "定时任务");
  await expect(
    page.getByText("存在待确认或暂存的网络配置，请先确认或恢复，完成前无法保存定时任务。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "启用定时重启", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存定时任务", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
