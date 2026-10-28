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
      fixture.current = fixture.policy.enabled
        ? { state: "normal", checkedAt: Math.floor(Date.now() / 1000) }
        : null;
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

test("boot, normal, offline and fault can select distinct LEDs and independent blinking", async ({
  page,
}, testInfo) => {
  const saved = await mockLeds(page);
  await loginPage(page);
  await navigate(page, "指示灯设置");
  await page.getByRole("switch", { name: "按系统状态控制指示灯", exact: true }).click();
  await page.getByLabel("亮起时间（毫秒）", { exact: true }).last().fill("150");
  await page.getByRole("button", { name: "保存指示灯配置", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").getByText("指示灯配置已保存并应用", { exact: true }),
  ).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0]?.states).toMatchObject({
    boot: { led: "blue:status", effect: "blink", onMs: 250 },
    normal: { led: "green:status", effect: "on" },
    offline: { led: "red:status", effect: "blink", onMs: 1000 },
    fault: { led: "red:status", effect: "blink", onMs: 150 },
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("led-settings.png"), fullPage: true });
});

test("N1 white LED supports separate patterns and rejects invalid probe targets before a write", async ({
  page,
}) => {
  const saved = await mockLeds(page, "phicomm-n1");
  await loginPage(page);
  await navigate(page, "指示灯设置");
  await expect(page.getByRole("combobox").filter({ hasText: "n1:white:status" })).toHaveCount(4);
  await page.getByLabel("连通性探测目标（1–2 个 IPv4）", { exact: true }).fill("223.5.5.5; reboot");
  await page.getByRole("button", { name: "保存指示灯配置", exact: true }).click();
  await expect(
    page.getByText("探测目标必须是有效的单播 IPv4 地址。", { exact: true }),
  ).toBeVisible();
  expect(saved).toHaveLength(0);
});

test("machines without physical LEDs cannot enable the policy", async ({ page }) => {
  await mockLeds(page, "phicomm-n1", false);
  await loginPage(page);
  await navigate(page, "指示灯设置");
  await expect(
    page.getByText("设备没有可配置的指示灯。通用 QEMU 不模拟物理灯，请在真实设备上检查。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "按系统状态控制指示灯", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存指示灯配置", exact: true })).toBeDisabled();
});
