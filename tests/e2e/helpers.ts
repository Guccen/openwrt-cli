import { expect, type Page } from "@playwright/test";
import { pageRoutes } from "../../frontend/src/lib/routes";
const password = process.env.SIM_PASSWORD;

interface RpcRequest {
  id: number;
  params: [string, string, string, Record<string, unknown>];
}

export async function mockRpc(page: Page, respond: (request: RpcRequest) => unknown[] | undefined) {
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON() as RpcRequest | RpcRequest[];
    const requests = Array.isArray(body) ? body : [body];
    const responses = new Map<number, unknown>();
    const remaining: RpcRequest[] = [];
    for (const request of requests) {
      const result = respond(request);
      if (result) responses.set(request.id, { jsonrpc: "2.0", id: request.id, result });
      else remaining.push(request);
    }
    if (remaining.length === requests.length) return route.fallback();
    // 只覆盖指定的批量项，其余读取仍由测试设备响应。
    if (remaining.length) {
      const upstream = await route.fetch({
        postData: Array.isArray(body) ? remaining : remaining[0],
      });
      const data = await upstream.json();
      for (const response of Array.isArray(data) ? data : [data])
        responses.set(response.id, response);
    }
    await route.fulfill({
      json: Array.isArray(body)
        ? requests.map(({ id }) => responses.get(id))
        : responses.get(body.id),
    });
  });
}

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
