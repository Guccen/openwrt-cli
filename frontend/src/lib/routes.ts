export const pageRoutes = {
  overview: { path: "/overview/", title: "系统概览", settings: false },
  network: { path: "/network/", title: "网络状态", settings: false },
  lan: { path: "/settings/lan/", title: "LAN 设置", settings: true },
  dns: { path: "/settings/dns/", title: "DNS 设置", settings: true },
  wireless: { path: "/settings/wireless/", title: "无线设置", settings: true },
  backup: { path: "/settings/backup/", title: "备份与恢复", settings: true },
} as const;
export type Page = keyof typeof pageRoutes;
export const loginPath = "/login/";
export const entryPaths = [loginPath, ...Object.values(pageRoutes).map((route) => route.path)];
export function pageForPath(path: string): Page | null {
  return (
    (Object.keys(pageRoutes) as Page[]).find(
      (page) => pageRoutes[page].path.replace(/\/$/, "") === path.replace(/\/$/, ""),
    ) ?? null
  );
}
export function returnPath(path: string | null) {
  const page = path ? pageForPath(path) : null;
  return page ? pageRoutes[page].path : pageRoutes.overview.path;
}
