import { expect, test } from "@playwright/test";
import { pageRoutes, entryPaths } from "../../frontend/src/lib/routes";

test("生产入口、深链登录、HTTPS 规则应用与会话刷新", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of entryPaths) expect((await request.get(path)).status()).toBe(200);
  expect((await request.get("/assets/missing.js")).status()).toBe(404);
  await page.goto(pageRoutes.forwarding.path);
  await page.getByLabel("设备密码").fill("preview-only");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${pageRoutes.forwarding.path}$`));
  const remote = page.getByRole("switch", { name: "外网访问管理页面", exact: true });
  await expect(remote).toBeVisible();
  if (!(await remote.isChecked())) await remote.check();
  const port = String(8400 + ["desktop", "tablet", "mobile"].indexOf(test.info().project.name));
  await page.getByLabel("外部访问端口").fill(port);
  await expect(page.getByText(`外网访问地址为：https://`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "保存安全设置", exact: true }).click();
  await page.getByRole("button", { name: "应用并开始计时", exact: true }).click();
  await page.getByRole("button", { name: "连接正常，保留设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "连接正常，保留设置", exact: true })).toHaveCount(
    0,
  );
  await page.reload();
  await expect(remote).toBeChecked();
  await expect(page.getByLabel("外部访问端口")).toHaveValue(port);
  await page.goto(pageRoutes.overview.path);
  await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel("设备密码")).toBeVisible();
  expect(errors).toEqual([]);
});
