import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NetworkTable, Overview } from "../../frontend/src/App";
import { bytes, memoryUsage, uptime } from "../../frontend/src/lib/format";
import type { Snapshot } from "../../frontend/src/lib/types";

const snapshot: Snapshot = {
  board: {
    hostname: "n1",
    model: "<script>alert(1)</script>",
    kernel: "6.12",
    release: { distribution: "OpenWrt", version: "25.12", revision: "test", target: "armsr/armv8" },
  },
  info: {
    uptime: 3660,
    load: [65536, 32768, 0],
    memory: { total: 1024, free: 100, available: 512 },
  },
  interfaces: [
    {
      interface: "lan",
      proto: "static",
      up: true,
      "ipv4-address": [{ address: "192.168.68.2", mask: 24 }],
    },
  ],
  updatedAt: 1,
};

test("设备提供的文本经过转义，网络表格使用 shadcn 组件", () => {
  const overview = renderToStaticMarkup(<Overview snapshot={snapshot} />);
  expect(overview).not.toContain("<script>alert");
  expect(overview).toContain("&lt;script&gt;");
  expect(overview).toContain('data-slot="card"');
  const table = renderToStaticMarkup(<NetworkTable snapshot={snapshot} />);
  expect(table).toContain('data-slot="table"');
  expect(table).toContain("192.168.68.2/24");
});

test("按可用内存统计占用，处理计数边界", () => {
  expect(memoryUsage(snapshot.info.memory)).toEqual({ used: 512, percent: 50 });
  expect(memoryUsage({ total: 100, free: 10, buffered: 20, cached: 30 }).percent).toBe(40);
  expect(memoryUsage({ total: 0, free: 0 }).percent).toBe(0);
  expect(bytes(-1)).toBe("0 B");
  expect(bytes(1024)).toBe("1.0 KiB");
  expect(uptime(3660)).toBe("0 天 1 小时 1 分");
});
