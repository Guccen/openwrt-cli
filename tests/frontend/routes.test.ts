import { expect, test } from "bun:test";
import {
  entryPaths,
  loginPath,
  pageForPath,
  pageRoutes,
  returnPath,
} from "../../frontend/src/lib/routes";

test("页面地址独立，登录返回路径只能选择已知的本地页面", () => {
  expect(new Set(entryPaths).size).toBe(13);
  expect(pageForPath("/settings/dns")).toBe("dns");
  expect(pageForPath("/settings/dns/")).toBe("dns");
  for (const path of [
    "https://example.com/settings/dns/",
    "//example.com/",
    "/settings/../../ubus",
    "/missing/",
    loginPath,
    null,
  ])
    expect(returnPath(path)).toBe(pageRoutes.overview.path);
  expect(returnPath("/settings/backup/")).toBe(pageRoutes.backup.path);
});
