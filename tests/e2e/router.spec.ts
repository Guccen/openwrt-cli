import { expect, test, type APIRequestContext } from "@playwright/test";

const anonymous = "0".repeat(32);
const password = process.env.SIM_PASSWORD;

async function rpc(
  request: APIRequestContext,
  session: string,
  object: string,
  method: string,
  args: object = {},
) {
  const response = await request.post("/ubus", {
    data: { jsonrpc: "2.0", id: 1, method: "call", params: [session, object, method, args] },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test("real ubus login, permissions, interfaces and session invalidation", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "API checks run once per virtual machine");
  expect(password, "Set SIM_PASSWORD for the temporary OpenWrt guest").toBeTruthy();
  const device = await request.get("/device.json");
  expect(await device.json()).toMatchObject({
    device: process.env.SIM_DEVICE,
    role: process.env.SIM_ROLE,
    address: process.env.SIM_ADDRESS,
  });
  const redirect = await request.get(process.env.SIM_BASE_URL!.replace("https:", "http:"), {
    maxRedirects: 0,
  });
  expect([301, 302, 307, 308]).toContain(redirect.status());
  expect(redirect.headers().location).toMatch(/^https:/);

  const denied = await rpc(request, anonymous, "system", "info");
  expect([-32002, 6]).toContain(denied.error?.code ?? denied.result?.[0]);
  const invalid = await rpc(request, anonymous, "session", "login", {
    username: "root",
    password: "invalid-ci-password",
  });
  expect(invalid.result?.[0]).not.toBe(0);

  const login = await rpc(request, anonymous, "session", "login", {
    username: "root",
    password,
    timeout: 300,
  });
  expect(login.result?.[0]).toBe(0);
  const session: string = login.result[1].ubus_rpc_session;
  expect(session).toMatch(/^[a-f0-9]{32}$/);
  try {
    const board = await rpc(request, session, "system", "board");
    expect(board.result[0]).toBe(0);
    expect(board.result[1].kernel).toMatch(/^\d+\./);
    expect(board.result[1].hostname).toBe(process.env.SIM_DEVICE);
    const info = await rpc(request, session, "system", "info");
    expect(info.result[1].memory.total).toBeGreaterThan(0);
    const network = await rpc(request, session, "network.interface", "dump");
    const lan = network.result[1].interface.find(
      (item: { interface: string }) => item.interface === "lan",
    );
    expect(lan.up).toBe(true);
    expect(lan["ipv4-address"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: process.env.SIM_ADDRESS })]),
    );
    for (const [object, method] of [
      ["uci", "set"],
      ["file", "exec"],
      ["system", "reboot"],
    ]) {
      const access = await rpc(request, session, "session", "access", {
        scope: "ubus",
        object,
        function: method,
      });
      expect(access.result).toEqual([0, { access: false }]);
    }
  } finally {
    const logout = await rpc(request, session, "session", "destroy");
    expect(logout.result?.[0]).toBe(0);
  }
  const expired = await rpc(request, session, "system", "info");
  expect([-32001, -32002, 6]).toContain(expired.error?.code ?? expired.result?.[0]);
});

test("login, responsive navigation, refresh and logout", async ({ page }, testInfo) => {
  expect(password, "Set SIM_PASSWORD for the temporary OpenWrt guest").toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  await page.getByLabel("设备密码").fill("invalid-ci-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("设备密码").fill(password!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
  await expect(page.getByText("设备信息", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true });
  const mobile = testInfo.project.name === "mobile";
  if (mobile) {
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-menu.png"), fullPage: true });
  } else {
    const sidebar = page.locator('[data-slot="sidebar"][data-state]');
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
    await page.screenshot({ path: testInfo.outputPath("collapsed-menu.png"), fullPage: true });
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
  }
  await page.getByRole("button", { name: "网络状态", exact: true }).click();
  if (mobile) await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "网络状态", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /lan/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: process.env.SIM_ADDRESS + "/24" })).toBeVisible();
  const refreshed = page.waitForResponse((response) => {
    if (!response.url().endsWith("/ubus")) return false;
    const data = response.request().postDataJSON();
    return data?.params?.[1] === "network.interface";
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("network.png"), fullPage: true });
  if (mobile) await page.getByRole("button", { name: "切换菜单", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByText("登录设备", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
