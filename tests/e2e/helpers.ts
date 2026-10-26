import { expect, type Page } from "@playwright/test";
import { pageRoutes } from "../../frontend/src/lib/routes";
const password = process.env.SIM_PASSWORD;

export async function loginPage(page: Page) {
  await page.goto("/");
  await page.getByLabel("设备密码").fill(password!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
}

export async function navigate(page: Page, title: string) {
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const route = Object.values(pageRoutes).find((item) => item.title === title)!;
  await expect(page).toHaveURL((url) => url.pathname === route.path);
}
