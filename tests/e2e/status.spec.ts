import { expect, test } from "@playwright/test";
import { telemetryFixture, clientsFixture } from "../helpers/status-fixture";
import { loginPage, navigate } from "./helpers";

test("overview health, upstream, physical ports and DHCP leases are separated and responsive", async ({
  page,
}, testInfo) => {
  let clientReads = 0;
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    const [, object, method] = body.params ?? [];
    if (object !== "router.status") return route.continue();
    if (method === "clients") clientReads++;
    await route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: body.id,
        result: [0, method === "summary" ? telemetryFixture() : clientsFixture()],
      },
    });
  });
  await loginPage(page);
  await expect(page.getByText("58.5 °C", { exact: true })).toBeVisible();
  await expect(page.getByText("温度与存储", { exact: true })).toBeVisible();
  await expect(page.getByText("上游网络", { exact: true })).toBeVisible();
  expect(clientReads).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("overview-health.png"), fullPage: true });
  await navigate(page, "网络状态");
  await expect(page.getByText("网口状态", { exact: true })).toBeVisible();
  await expect(page.getByText("1000 Mbps · 全双工", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ethernet-status.png"), fullPage: true });
  await navigate(page, "客户端租约");
  await expect(page.getByText("IPv4 DHCP 租约 · 2", { exact: true })).toBeVisible();
  await expect(page.getByText("IPv6 DHCP 租约 · 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "192.168.68.101", exact: true })).toBeVisible();
  await expect(page.getByText("永久", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => clientReads).toBe(2);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("client-leases.png"), fullPage: true });
});

test("missing sensors and empty unavailable leases are explicit, and bypass upstream uses lan", async ({
  page,
}) => {
  await page.route("**/device.json", (route) =>
    route.fulfill({
      json: {
        device: "phicomm-n1",
        role: "bypass",
        model: "N1 旁路由",
        address: "192.168.68.2",
        source: "fixture",
        revision: "fixture",
      },
    }),
  );
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    const [, object, method] = body.params ?? [];
    let data: unknown;
    if (object === "router.status")
      data =
        method === "summary"
          ? { ...telemetryFixture(), temperatures: [], ports: [] }
          : { ...clientsFixture(), ipv4: [], ipv6: [], ipv6Available: false };
    else if (object === "network.interface")
      data = {
        interface: [
          {
            interface: "lan",
            up: true,
            proto: "static",
            "ipv4-address": [{ address: "192.168.68.2", mask: 24 }],
            route: [{ target: "0.0.0.0", mask: 0, nexthop: "192.168.68.1" }],
            "dns-server": ["192.168.68.1"],
          },
        ],
      };
    else return route.continue();
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: [0, data] } });
  });
  await loginPage(page);
  await expect(
    page.getByText("温度暂不可用，设备未提供可读取的传感器。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("lan", { exact: true })).toBeVisible();
  await navigate(page, "客户端租约");
  await expect(page.getByText("暂无 IPv4 DHCP 租约", { exact: true })).toBeVisible();
  await expect(page.getByText("IPv6 租约服务暂不可用或未启用。", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("旁路由通常不负责分配地址");
});
