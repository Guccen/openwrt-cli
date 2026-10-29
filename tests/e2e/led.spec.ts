import { expect, test, type Page } from "@playwright/test";
import { ledFixture } from "../helpers/led-fixture";
import { loginPage, navigate } from "./helpers";
import type { LedPolicy } from "../../frontend/src/lib/led-client";

async function mockLeds(page: Page, device = "jdcloud-ax1800", hardware = true) {
  const fixture = ledFixture(device, hardware);
  const saved: LedPolicy[] = [];
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    const [, object, method, args] = body.params ?? [];
    if (object !== "router.maintenance" || !["led_status", "led_save"].includes(method))
      return route.continue();
    if (method === "led_save") {
      fixture.policy = JSON.parse(args.policy);
      saved.push(fixture.policy);
    }
    await route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: body.id,
        result: [0, method === "led_status" ? { ok: true, ...fixture } : { ok: true }],
      },
    });
  });
  return saved;
}

test("内核触发器可用于 AX1800 智能状态灯并保留开机灯效", async ({ page }, testInfo) => {
  const saved = await mockLeds(page);
  await loginPage(page);
  await navigate(page, "智能状态灯");
  await page.getByRole("switch", { name: "启用内核触发器控制", exact: true }).click();
  await page.getByRole("button", { name: "保存指示灯配置", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").getByText("指示灯触发器已保存并应用", { exact: true }),
  ).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0]?.boot).toMatchObject({ led: "blue:status", effect: "blink", onMs: 250 });
  expect(saved[0]?.leds.find((item) => item.id === "green:status")).toMatchObject({
    trigger: "netdev",
    deviceName: "wan",
    link: false,
    rx: true,
    tx: true,
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("led-settings.png"), fullPage: true });
});

test("N1 根据设备报告的触发器生成可用状态灯选项", async ({ page }) => {
  await mockLeds(page, "phicomm-n1");
  await loginPage(page);
  await navigate(page, "智能状态灯");
  await expect(page.getByRole("combobox")).toHaveCount(2);
  await expect(page.getByText("白色状态灯", { exact: true }).first()).toBeVisible();
  await page.getByRole("combobox").last().click();
  await expect(page.getByRole("option", { name: "系统心跳" })).toBeVisible();
});

test("没有物理灯的设备无法启用触发器控制", async ({ page }) => {
  await mockLeds(page, "phicomm-n1", false);
  await loginPage(page);
  await navigate(page, "智能状态灯");
  await expect(
    page.getByText("设备没有可配置的指示灯。通用 QEMU 不模拟物理灯，请在真实设备上检查。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "启用内核触发器控制", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存指示灯配置", exact: true })).toBeDisabled();
});
