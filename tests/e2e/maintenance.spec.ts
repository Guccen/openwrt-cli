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
  await page.screenshot({ path: testInfo.outputPath("system-maintenance.png"), fullPage: true });
});
