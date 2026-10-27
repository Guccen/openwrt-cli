import { expect, test } from "@playwright/test";
import { loginPage, navigate } from "./helpers";

test("refresh preserves current page but validates the tab session with the router", async ({
  page,
}) => {
  await loginPage(page);
  await navigate(page, "客户端租约");
  const access = page.waitForRequest(
    (request) =>
      request.url().endsWith("/ubus") &&
      request.postDataJSON()?.params?.[1] === "session" &&
      request.postDataJSON()?.params?.[2] === "access",
  );
  await page.reload();
  await access;
  await expect(page.getByRole("heading", { name: "客户端租约", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/clients\/$/);
  await expect(page.getByText("登录设备", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(["router-ui-session"]);
  expect(await page.evaluate(() => sessionStorage.getItem("router-ui-session"))).toMatch(
    /^[a-f0-9]{32}$/,
  );
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("router-ui-session"))).toBeNull();
});

test("a stored token cannot bypass the device and revoked sessions clear after refresh", async ({
  page,
  request,
}) => {
  await loginPage(page);
  await navigate(page, "客户端租约");
  const session = await page.evaluate(() => sessionStorage.getItem("router-ui-session"));
  await request.post("/ubus", {
    data: { jsonrpc: "2.0", id: 1, method: "call", params: [session, "session", "destroy", {}] },
  });
  await page.reload();
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("router-ui-session"))).toBeNull();
  await page.evaluate(() => sessionStorage.setItem("router-ui-session", "f".repeat(32)));
  await page.goto("/clients/");
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "客户端租约", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("router-ui-session"))).toBeNull();
});

test("protected RPC expiry is handled while reading a page without a browser reload", async ({
  page,
  request,
}) => {
  await loginPage(page);
  await navigate(page, "客户端租约");
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  const session = await page.evaluate(() => sessionStorage.getItem("router-ui-session"));
  await request.post("/ubus", {
    data: { jsonrpc: "2.0", id: 2, method: "call", params: [session, "session", "destroy", {}] },
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("router-ui-session"))).toBeNull();
});

test("temporary connection failure preserves the saved session and retry restores the same page", async ({
  page,
}) => {
  await loginPage(page);
  await navigate(page, "客户端租约");
  let disconnected = true;
  await page.route("**/ubus", async (route) => {
    const params = route.request().postDataJSON()?.params;
    if (disconnected && params?.[1] === "session" && params?.[2] === "access")
      await route.abort("connectionfailed");
    else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "重试登录状态检查", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("router-ui-session"))).toMatch(
    /^[a-f0-9]{32}$/,
  );
  await expect(page.getByLabel("设备密码", { exact: true })).toHaveCount(0);
  disconnected = false;
  await page.getByRole("button", { name: "重试登录状态检查", exact: true }).click();
  await expect(page.getByRole("heading", { name: "客户端租约", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/clients\/$/);
});
