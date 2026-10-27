import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { loginPage, navigate } from "./helpers";

test.use({ trace: "off" });
const token = "a".repeat(32);
async function mockMaintenance(
  page: Page,
  options: { supported?: boolean; invalidFirmware?: boolean } = {},
) {
  const calls: string[] = [];
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.[1] !== "router.maintenance") return route.continue();
    const [, , method, args] = body.params;
    calls.push(method);
    let result: object = { ok: true, accepted: true };
    if (method === "status")
      result = {
        ok: true,
        configurationBusy: false,
        operationBusy: false,
        upgradeSupported: options.supported !== false,
        resetSupported: options.supported !== false,
      };
    if (method === "upload_start") result = { ok: true, token };
    if (method === "upload_chunk")
      result = { ok: true, offset: args.offset + Buffer.from(args.data, "base64").length };
    if (method === "inspect")
      result = options.invalidFirmware
        ? { ok: false, error: "invalid_firmware" }
        : { ok: true, files: 4 };
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: [0, result] } });
  });
  return calls;
}

test("archive inspection can be cancelled without restoring, and releases the uploaded file", async ({
  page,
}) => {
  const calls = await mockMaintenance(page);
  await loginPage(page);
  await navigate(page, "系统维护");
  await page.getByLabel("系统配置归档", { exact: true }).setInputFiles({
    name: "fixture.tar.gz",
    mimeType: "application/gzip",
    buffer: gzipSync("non-sensitive fixture"),
  });
  const card = page.getByText("恢复系统配置", { exact: true }).locator("..").locator("..");
  await card.getByRole("button", { name: "上传并校验", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("已验证");
  await expect(page.getByRole("button", { name: "确认执行", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => calls.filter((method) => method === "upload_cancel").length).toBe(1);
  expect(calls).not.toContain("restore");
  await expect(page.getByLabel("系统配置归档", { exact: true })).toBeEnabled();
});

test("factory reset requires exact typed confirmation and blocks configuration while rebooting", async ({
  page,
}) => {
  const calls = await mockMaintenance(page);
  await loginPage(page);
  await navigate(page, "系统维护");
  await page.getByRole("button", { name: "恢复出厂设置", exact: true }).click();
  await page.getByLabel("输入“恢复出厂设置”确认", { exact: true }).fill("重置");
  await expect(page.getByRole("button", { name: "确认执行", exact: true })).toBeDisabled();
  await page.getByLabel("输入“恢复出厂设置”确认", { exact: true }).fill("恢复出厂设置");
  await page.getByRole("button", { name: "确认执行", exact: true }).click();
  await expect(
    page.getByText("已发送维护请求，请等待设备重启；恢复或重置后管理地址和密码可能改变。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(calls.filter((method) => method === "reset")).toHaveLength(1);
  await navigate(page, "LAN 设置");
  await expect(page.getByLabel("LAN IPv4 地址", { exact: true })).toBeDisabled();
});

test("firmware checksum and device compatibility failures never start a flash", async ({
  page,
}) => {
  const calls = await mockMaintenance(page, { invalidFirmware: true });
  await loginPage(page);
  await navigate(page, "系统维护");
  const buffer = Buffer.from("firmware-fixture");
  await page
    .getByLabel("固件镜像", { exact: true })
    .setInputFiles({ name: "sysupgrade.bin", mimeType: "application/octet-stream", buffer });
  await page.getByLabel("构建产物 SHA-256", { exact: true }).fill("0".repeat(64));
  const card = page.getByText("升级固件", { exact: true }).locator("..").locator("..");
  await card.getByRole("button", { name: "上传并校验", exact: true }).click();
  await expect(
    page.getByText("固件与填写的 SHA-256 不一致，请核对构建产物的校验文件。", { exact: true }),
  ).toBeVisible();
  expect(calls).not.toContain("upload_start");
  await page
    .getByLabel("构建产物 SHA-256", { exact: true })
    .fill(createHash("sha256").update(buffer).digest("hex"));
  await card.getByRole("button", { name: "上传并校验", exact: true }).click();
  await expect(
    page.getByText("固件未通过设备兼容性检查，请选择匹配 AX1800 的 sysupgrade 镜像。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(calls).toContain("upload_cancel");
  expect(calls).not.toContain("upgrade");
});

test("unsupported storage exposes guidance and no reset or firmware upload controls", async ({
  page,
}) => {
  await mockMaintenance(page, { supported: false });
  await loginPage(page);
  await navigate(page, "系统维护");
  await expect(
    page.getByText(
      "当前设备或存储布局不支持此操作。N1 请按刷机文档重新写入启动卡，保留旧卡用于回滚。",
      { exact: true },
    ),
  ).toHaveCount(2);
  await expect(page.getByRole("button", { name: "恢复出厂设置", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("固件镜像", { exact: true })).toHaveCount(0);
});
