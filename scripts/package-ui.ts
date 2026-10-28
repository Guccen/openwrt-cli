import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { entryPaths } from "../frontend/src/lib/routes";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
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
for (const file of files) {
  raw += (await stat(file)).size;
  compressed += gzipSync(await Bun.file(file).arrayBuffer()).length;
}
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
const report = { files: files.map((file) => relative(output, file)), raw, gzip: compressed };
await writeFile(resolve(root, "build/ui-size.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  `前端资源：${(raw / 1024).toFixed(1)} KiB，压缩后 ${(compressed / 1024).toFixed(1)} KiB`,
);
