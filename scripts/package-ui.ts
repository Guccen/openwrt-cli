import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
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
// 防止后续添加组件或字体时无意扩大固件资源。
if (raw > 768 * 1024 || compressed > 256 * 1024) {
  throw new Error(`前端资源超过预算：原始 ${raw} 字节，压缩 ${compressed} 字节`);
}
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
const report = { files: files.map((file) => relative(output, file)), raw, gzip: compressed };
await writeFile(resolve(root, "build/ui-size.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  `前端资源：${(raw / 1024).toFixed(1)} KiB，压缩后 ${(compressed / 1024).toFixed(1)} KiB`,
);
