import { expect, test } from "@playwright/test";
import { loginPage, navigate } from "./helpers";

// 密码请求不保存在 trace/HAR 中，成功响应为受控模拟，不改共享设备密码。
test.use({ trace: "off" });

test("password mismatch does not write, and wrong current password is shown without retaining fields", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.[1] !== "router.maintenance" || body.params[2] !== "password")
      return route.continue();
    ++writes;
    await route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: body.id,
        result: [0, { ok: false, error: "current_password_incorrect" }],
      },
    });
  });
  await loginPage(page);
  await navigate(page, "系统维护");
  await page.getByLabel("当前登录密码", { exact: true }).fill("current-fixture");
  await page.getByLabel("新登录密码", { exact: true }).fill("new-fixture-password");
  await page.getByLabel("确认新登录密码", { exact: true }).fill("different");
  await page.getByRole("button", { name: "修改登录密码", exact: true }).click();
  await expect(page.getByText("两次输入的新密码不一致。", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByLabel("当前登录密码", { exact: true }).fill("wrong-fixture");
  await page.getByLabel("新登录密码", { exact: true }).fill("new-fixture-password");
  await page.getByLabel("确认新登录密码", { exact: true }).fill("new-fixture-password");
  await page.getByRole("button", { name: "修改登录密码", exact: true }).click();
  await expect(page.getByText("当前登录密码不正确。", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  for (const label of ["当前登录密码", "新登录密码", "确认新登录密码"])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
});

test("successful password change clears the session and returns to login with a notice", async ({
  page,
}) => {
  await page.route("**/ubus", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.[1] !== "router.maintenance" || body.params[2] !== "password")
      return route.continue();
    await route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: body.id,
        result: [0, { ok: true, changed: true, sessionsRevoked: true }],
      },
    });
  });
  await loginPage(page);
  await navigate(page, "系统维护");
  await page.getByLabel("当前登录密码", { exact: true }).fill("current-fixture");
  await page.getByLabel("新登录密码", { exact: true }).fill("new-fixture-password");
  await page.getByLabel("确认新登录密码", { exact: true }).fill("new-fixture-password");
  await page.getByRole("button", { name: "修改登录密码", exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/login/" && url.searchParams.get("passwordChanged") === "1",
  );
  await expect(page.getByText("密码已修改，请使用新密码重新登录。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("设备密码", { exact: true })).toHaveValue("");
});
