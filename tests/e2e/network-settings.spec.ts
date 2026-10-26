import { expect, test, type Page } from "@playwright/test";
import { loginPage, navigate } from "./helpers";
import { pageRoutes } from "../../frontend/src/lib/routes";

async function review(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "应用并开始计时", exact: true }).click();
}
async function confirm(page: Page) {
  const keep = page.getByRole("button", { name: "连接正常，保留设置", exact: true });
  await expect(keep).toBeEnabled({ timeout: 30000 });
  await keep.click();
  await expect(page.getByText("设置已确认并保留", { exact: true })).toBeVisible();
}
function writes(page: Page) {
  const state = { count: 0 };
  page.on("request", (request) => {
    const params = request.url().endsWith("/ubus") ? request.postDataJSON()?.params : null;
    if (params?.[1] === "uci" && ["set", "delete", "apply"].includes(params[2])) ++state.count;
  });
  return state;
}
test("WAN static addressing confirms and restores DHCP without changing LAN", async ({
  page,
}, info) => {
  test.skip(process.env.SIM_ROLE !== "router", "Bypass has no WAN editor");
  await loginPage(page);
  await navigate(page, "WAN 设置");
  const count = writes(page);
  await page.getByLabel("WAN 上网方式", { exact: true }).click();
  await page.getByRole("option", { name: "静态 IPv4", exact: true }).click();
  await page.getByLabel("WAN IPv4 地址", { exact: true }).fill(process.env.SIM_ADDRESS!);
  await page.getByLabel("WAN 子网掩码", { exact: true }).fill("255.255.255.0");
  await page.getByLabel("WAN 网关", { exact: true }).fill("10.0.2.2");
  await page.getByLabel("WAN DNS 服务器", { exact: true }).fill("1.1.1.1");
  await page.getByRole("button", { name: "应用 WAN 设置", exact: true }).click();
  await expect(
    page.getByText("WAN 与 LAN 网段重叠，请选择其他网段", { exact: true }),
  ).toBeVisible();
  expect(count.count).toBe(0);
  await page.getByLabel("WAN IPv4 地址", { exact: true }).fill("10.0.2.15");
  await review(page, "应用 WAN 设置");
  await confirm(page);
  await expect(page.getByLabel("WAN IPv4 地址", { exact: true })).toHaveValue("10.0.2.15");
  await page.screenshot({ path: info.outputPath("wan-static.png"), fullPage: true });
  await page.getByLabel("WAN 上网方式", { exact: true }).click();
  await page.getByRole("option", { name: "自动获取（DHCP）", exact: true }).click();
  await review(page, "应用 WAN 设置");
  await confirm(page);
  await expect(page.getByLabel("WAN 上网方式", { exact: true })).toHaveText("自动获取（DHCP）");
  await expect(page.getByLabel("使用上游提供的 DNS", { exact: true })).toBeChecked();
});

test("PPPoE review validates credentials and cancellation never stages them", async ({ page }) => {
  test.skip(process.env.SIM_ROLE !== "router", "Bypass has no PPPoE editor");
  await loginPage(page);
  await navigate(page, "WAN 设置");
  const count = writes(page);
  await page.getByLabel("WAN 上网方式", { exact: true }).click();
  await page.getByRole("option", { name: "宽带拨号（PPPoE）", exact: true }).click();
  await page.getByLabel("宽带账号", { exact: true }).fill("ci-example-user");
  await page.getByLabel("宽带密码", { exact: true }).fill("x".repeat(129));
  await page.getByRole("button", { name: "应用 WAN 设置", exact: true }).click();
  await expect(
    page.getByText("宽带密码不能超过 128 字节或包含控制字符", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("宽带密码", { exact: true }).fill("ci-only-example-password");
  await page.getByRole("button", { name: "应用 WAN 设置", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog")).not.toContainText("ci-only-example-password");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(count.count).toBe(0);
});

test("DHCP pool validates, confirms, rolls back a disable and restores its initial values", async ({
  page,
}, info) => {
  test.skip(process.env.SIM_ROLE !== "router", "Bypass must not serve DHCP");
  await loginPage(page);
  await navigate(page, "DHCP 设置");
  const start = page.getByLabel("DHCP 起始地址", { exact: true }),
    end = page.getByLabel("DHCP 结束地址", { exact: true }),
    lease = page.getByLabel("DHCP 租期", { exact: true });
  await expect(start).toBeEnabled();
  const original = {
    start: await start.inputValue(),
    end: await end.inputValue(),
    lease: await lease.inputValue(),
  };
  const prefix = process.env.SIM_ADDRESS!.slice(0, process.env.SIM_ADDRESS!.lastIndexOf(".") + 1);
  const count = writes(page);
  await end.fill(prefix + "255");
  await page.getByRole("button", { name: "应用 DHCP 设置", exact: true }).click();
  await expect(
    page.getByText("DHCP 起止地址需按顺序位于 LAN 可用网段内", { exact: true }),
  ).toBeVisible();
  expect(count.count).toBe(0);
  await start.fill(prefix + "50");
  await end.fill(prefix + "79");
  await lease.fill("30m");
  await review(page, "应用 DHCP 设置");
  await confirm(page);
  await expect(start).toHaveValue(prefix + "50");
  await page.screenshot({ path: info.outputPath("dhcp-settings.png"), fullPage: true });
  await page.getByLabel("启用 IPv4 DHCP", { exact: true }).click();
  await review(page, "应用 DHCP 设置");
  await page.getByRole("button", { name: "恢复原设置", exact: true }).click();
  await expect(page.getByText("已请求恢复原设置", { exact: true })).toBeVisible();
  await expect(page.getByLabel("启用 IPv4 DHCP", { exact: true })).toBeChecked();
  await start.fill(original.start);
  await end.fill(original.end);
  await lease.fill(original.lease);
  await review(page, "应用 DHCP 设置");
  await confirm(page);
  await expect(start).toHaveValue(original.start);
});

test("bypass cannot open WAN or DHCP editors", async ({ page }) => {
  test.skip(process.env.SIM_ROLE !== "bypass", "Only applies to bypass mode");
  for (const [path, message] of [
    [pageRoutes.wan.path, "旁路由通过 LAN 网关上网，不开放独立 WAN 配置。"],
    [pageRoutes.dhcp.path, "旁路由不开放 DHCP 地址分配，请使用主路由的 DHCP 服务。"],
  ]) {
    const count = writes(page);
    await page.goto(path);
    await page.getByLabel("设备密码").fill(process.env.SIM_PASSWORD!);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    expect(count.count).toBe(0);
  }
});
