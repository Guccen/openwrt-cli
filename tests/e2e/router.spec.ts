import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const anonymous = "0".repeat(32);
const password = process.env.SIM_PASSWORD;

async function loginPage(page: Page) {
  await page.goto("/");
  await page.getByLabel("设备密码").fill(password!);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "系统概览", exact: true })).toBeVisible();
}

async function navigate(page: Page, title: string) {
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole("button", { name: "切换菜单", exact: true }).click();
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
}

async function applyDialog(page: Page, button: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "应用并开始计时", exact: true }).click();
}

async function confirmConnection(page: Page) {
  const confirm = page.getByRole("button", { name: "连接正常，保留设置", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 30000 });
  await confirm.click();
  await expect(page.getByText("设置已确认并保留", { exact: true })).toBeVisible();
}

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
      ["uci", "commit"],
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

test("DNS editing requires explicit confirmation and can restore automatic DNS", async ({
  page,
}, testInfo) => {
  await loginPage(page);
  await navigate(page, "DNS 设置");
  const field = page.getByLabel("DNS 服务器", { exact: true });
  await expect(field).toBeEnabled();
  const original = await field.inputValue();
  const server = original.trim() === "1.1.1.1" ? "9.9.9.9" : "1.1.1.1";
  await field.fill(server);
  await page.screenshot({ path: testInfo.outputPath("dns-settings.png"), fullPage: true });
  await applyDialog(page, "应用 DNS 设置");
  await confirmConnection(page);
  await expect(field).toHaveValue(server);
  await field.fill(original);
  await applyDialog(page, "应用 DNS 设置");
  await confirmConnection(page);
  await expect(field).toHaveValue(original);
});

test("LAN form rejects invalid addresses before applying", async ({ page }, testInfo) => {
  await loginPage(page);
  await navigate(page, "LAN 设置");
  await page.getByLabel("LAN IPv4 地址", { exact: true }).fill("999.1.1.1");
  await page.getByRole("button", { name: "应用 LAN 设置", exact: true }).click();
  await expect(page.getByText("请输入有效的 LAN IPv4 地址", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("lan-validation.png"), fullPage: true });
});

test("AX1800 wireless form edits the disabled configuration fixture", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.SIM_DEVICE !== "jdcloud-ax1800" || testInfo.project.name !== "desktop",
    "Wireless configuration fixture is AX1800 only; RF hardware is not emulated",
  );
  await loginPage(page);
  await navigate(page, "无线设置");
  const field = page.getByLabel("WiFi 名称", { exact: true }).first();
  await expect(field).toBeEnabled();
  const original = await field.inputValue();
  await field.fill("CI settings verified");
  await page.screenshot({ path: testInfo.outputPath("wireless-settings.png"), fullPage: true });
  await applyDialog(page, "应用无线设置");
  await confirmConnection(page);
  await expect(field).toHaveValue("CI settings verified");
  await field.fill(original);
  await applyDialog(page, "应用无线设置");
  await confirmConnection(page);
});

test("LAN address handoff confirms at the new origin and restores the initial address", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop" || !process.env.SIM_BASE_URL?.startsWith("https://"),
    "Requires the real OpenWrt guest with two reachable LAN addresses",
  );
  test.setTimeout(90000);
  await loginPage(page);
  await navigate(page, "LAN 设置");
  const original = process.env.SIM_ADDRESS!;
  const address = original.slice(0, original.lastIndexOf(".")) + ".11";
  await page.getByLabel("LAN IPv4 地址", { exact: true }).fill(address);
  await applyDialog(page, "应用 LAN 设置");
  const popupEvent = context.waitForEvent("page");
  await page.getByRole("button", { name: "打开新地址并确认", exact: true }).click();
  const next = await popupEvent;
  await next.waitForURL(`https://${address}/`);
  await confirmConnection(next);
  expect(next.url()).not.toContain("apply=");
  expect(await next.evaluate(() => localStorage.length)).toBe(0);
  expect(await next.evaluate(() => sessionStorage.length)).toBe(0);
  await navigate(next, "LAN 设置");
  await expect(next.getByLabel("LAN IPv4 地址", { exact: true })).toHaveValue(address);
  await next.screenshot({ path: testInfo.outputPath("lan-new-address.png"), fullPage: true });
  await next.getByLabel("LAN IPv4 地址", { exact: true }).fill(original);
  await applyDialog(next, "应用 LAN 设置");
  const restoredEvent = context.waitForEvent("page");
  await next.getByRole("button", { name: "打开新地址并确认", exact: true }).click();
  const restored = await restoredEvent;
  await restored.waitForURL(`https://${original}/`);
  await confirmConnection(restored);
});
