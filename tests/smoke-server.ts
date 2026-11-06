import { resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
const root = resolve(import.meta.dir, "../dist");
Bun.serve({
  hostname: "127.0.0.1",
  port: 4173,
  async fetch(request) {
    const url = new URL(request.url);
    if (["/device.json", "/ubus"].includes(url.pathname)) {
      return fetch(new Request(`http://127.0.0.1:4174${url.pathname}`, request));
    }
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    let path: string;
    try {
      path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (path !== root && !path.startsWith(root + sep)) return new Response(null, { status: 403 });
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    } catch {
      return new Response(null, { status: 404 });
    }
    const file = Bun.file(path);
    if (!(await file.exists())) return new Response(null, { status: 404 });
    return new Response(request.method === "HEAD" ? null : file, {
      headers: { "Content-Type": file.type },
    });
  },
});
