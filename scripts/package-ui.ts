import { cp, mkdir, readdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { entryPaths } from "../frontend/src/lib/routes";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
interface ManifestEntry {
  file: string;
  imports?: string[];
  css?: string[];
}
const manifestPath = resolve(output, ".vite/manifest.json");
const manifest = (await Bun.file(manifestPath).json()) as Record<string, ManifestEntry>;
// 构建清单留在本地报告目录，不安装到路由器的静态页面目录。
await mkdir(resolve(root, "build"), { recursive: true });
await cp(manifestPath, resolve(root, "build/ui-manifest.json"));
await rm(manifestPath);
await rmdir(dirname(manifestPath));
// uhttpd 直接提供目录首页；所有路由入口共用同一份静态资源。
// 把入口也纳入体积预算和安装校验，不依赖额外的重写服务。
for (const entry of entryPaths) {
  const path = resolve(output, `.${entry}`, "index.html");
  if (relative(output, path).startsWith("..")) throw new Error("页面入口路径无效");
  await mkdir(dirname(path), { recursive: true });
  await cp(resolve(output, "index.html"), path);
}
const files: string[] = [];
async function walk(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(output);
let raw = 0;
let compressed = 0;
const sizes = new Map<string, { raw: number; gzip: number }>();
for (const file of files) {
  const size = {
    raw: (await stat(file)).size,
    gzip: gzipSync(await Bun.file(file).arrayBuffer()).length,
  };
  sizes.set(relative(output, file).replaceAll("\\", "/"), size);
  raw += size.raw;
  compressed += size.gzip;
}
function entrySize(entries: string[]) {
  const selected = new Set(["index.html"]);
  const visited = new Set<string>();
  function collect(key: string) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) throw new Error(`构建清单缺少入口：${key}`);
    selected.add(entry.file);
    for (const css of entry.css ?? []) selected.add(css);
    for (const dependency of entry.imports ?? []) collect(dependency);
  }
  for (const entry of entries) collect(entry);
  let raw = 0,
    gzip = 0;
  for (const file of selected) {
    const size = sizes.get(file);
    if (!size) throw new Error(`构建入口引用缺失资源：${file}`);
    raw += size.raw;
    gzip += size.gzip;
  }
  return { files: [...selected].sort(), raw, gzip };
}
// 分别统计入口实际依赖的脚本、样式和首页，动态页面不会计入登录首屏。
const entries = {
  login: entrySize(["index.html"]),
  overview: entrySize([
    "index.html",
    ...(manifest["src/components/layout/device-layout.tsx"]
      ? ["src/components/layout/device-layout.tsx"]
      : []),
    "src/pages/overview-page.tsx",
  ]),
};
// 按用户要求不设置体积上限，继续输出逐文件压缩统计以便比较构建结果。
const target = resolve(root, "build/router-ui");
if (relative(resolve(root, "build"), target) !== "router-ui") throw new Error("安装包输出路径无效");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(root, "package/router-ui"), target, { recursive: true });
await cp(output, resolve(target, "htdocs"), { recursive: true });
await cp(
  resolve(root, "frontend/src/components/ui/LICENSE"),
  resolve(target, "files/shadcn-ui.LICENSE"),
);
await cp(resolve(root, "node_modules/sonner/LICENSE.md"), resolve(target, "files/sonner.LICENSE"));
await cp(resolve(root, "node_modules/recharts/LICENSE"), resolve(target, "files/recharts.LICENSE"));
const report = {
  files: files.map((file) => relative(output, file)),
  raw,
  gzip: compressed,
  entries,
};
await writeFile(resolve(root, "build/ui-size.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  `前端资源：${(raw / 1024).toFixed(1)} KiB，压缩后 ${(compressed / 1024).toFixed(1)} KiB`,
);
for (const [name, entry] of Object.entries(entries))
  console.log(
    `${name === "login" ? "登录" : "概况"}入口：${(entry.raw / 1024).toFixed(1)} KiB，压缩后 ${(entry.gzip / 1024).toFixed(1)} KiB`,
  );
