import { expect, test, type Page } from "@playwright/test";
import { loginPage, navigate } from "./helpers";

async function apply(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "应用并开始计时", exact: true }).click();
  const confirm = page.getByRole("button", { name: "连接正常，保留设置", exact: true });
  await expect(confirm).toBeEnabled({ timeout: 30000 });
  await confirm.click();
  await expect(page.getByText("设置已确认并保留", { exact: true })).toBeVisible();
}
async function select(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("IPv6 settings apply, confirm and restore on router and bypass", async ({ page }, info) => {
  await loginPage(page);
  await navigate(page, "IPv6 设置");
  const bypass = process.env.SIM_ROLE === "bypass";
  await expect(page.getByLabel("IPv6 上网方式", { exact: true })).toBeEnabled();
  if (bypass) {
    await select(page, "IPv6 上网方式", "自动获取（DHCPv6 / 前缀委派）");
    await apply(page, "应用 IPv6 设置");
    await select(page, "IPv6 上网方式", "关闭 IPv6 上网");
    await apply(page, "应用 IPv6 设置");
    await expect(
      page.getByLabel("向 LAN 提供 IPv6（SLAAC / DHCPv6）", { exact: true }),
    ).toHaveCount(0);
  } else {
    await select(page, "请求的前缀长度", "/64");
    await apply(page, "应用 IPv6 设置");
    await expect(page.getByLabel("请求的前缀长度", { exact: true })).toContainText("/64");
    await select(page, "请求的前缀长度", "自动（推荐）");
    await apply(page, "应用 IPv6 设置");
  }
  await page.screenshot({ path: info.outputPath("ipv6-settings.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("DHCP reservations and forwarding support add and delete with confirmation", async ({
  page,
}, info) => {
  test.skip(process.env.SIM_ROLE !== "router", "主路由功能");
  await loginPage(page);
  await navigate(page, "DHCP 设置");
  const prefix = process.env.SIM_ADDRESS!.split(".").slice(0, 3).join(".");
  await page.getByLabel("主机名（可选）", { exact: true }).fill("web-ci-client");
  await page.getByLabel("MAC 地址", { exact: true }).fill("02:00:00:00:00:44");
  await page.getByLabel("保留 IPv4 地址", { exact: true }).fill(prefix + ".44");
  await apply(page, "添加地址保留");
  await expect(page.getByRole("button", { name: "删除地址保留", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("dhcp-reservations.png"), fullPage: true });
  await apply(page, "删除地址保留");
  await expect(page.getByRole("button", { name: "删除地址保留", exact: true })).toHaveCount(0);
  await navigate(page, "端口转发");
  await page.getByLabel("转发名称", { exact: true }).fill("web-ci");
  await page.getByLabel("外部端口", { exact: true }).fill("18085");
  await page.getByLabel("内网目标 IPv4", { exact: true }).fill(prefix + ".44");
  await page.getByLabel("内部端口", { exact: true }).fill("80");
  await apply(page, "添加端口转发");
  await expect(page.getByRole("button", { name: "删除端口转发", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("forwarding.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await apply(page, "删除端口转发");
  await expect(page.getByRole("button", { name: "删除端口转发", exact: true })).toHaveCount(0);
});

test("manual diagnostics and time settings render and save without extra polling", async ({
  page,
}, info) => {
  await loginPage(page);
  await navigate(page, "诊断与日志");
  await page.getByLabel("目标 IP 或域名", { exact: true }).fill("127.0.0.1");
  await page.getByRole("button", { name: "开始诊断", exact: true }).click();
  await expect(page.getByText("执行完成", { exact: true })).toBeVisible();
  await select(page, "诊断项目", "系统日志");
  await page.getByRole("button", { name: "读取系统日志", exact: true }).click();
  await expect(page.getByText("执行完成", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("diagnostics.png"), fullPage: true });
  await navigate(page, "系统维护");
  const zone = page.getByLabel("时区", { exact: true });
  await expect(zone).toBeEnabled();
  await zone.click();
  await page.getByRole("option", { name: "中国标准时间（上海）", exact: true }).click();
  await page.getByRole("button", { name: "应用时间设置", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").getByText("时间设置已保存", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "应用时间设置", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("system-time.png"), fullPage: true });
  await zone.click();
  await page.getByRole("option", { name: "UTC", exact: true }).click();
  await page.getByRole("button", { name: "应用时间设置", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").getByText("时间设置已保存", { exact: true }),
  ).toBeVisible();
});
