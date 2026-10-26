import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  MaintenanceClient,
  decodeSystemBackup,
  SYSTEM_BACKUP_LIMIT,
} from "../../frontend/src/lib/maintenance-client";
import type { RouterClient } from "../../frontend/src/lib/rpc";

test("系统归档检查 gzip、体积、长度和 SHA-256，不接受损坏的备份", async () => {
  const compressed = gzipSync("configuration-fixture");
  const result = {
    data: compressed.toString("base64"),
    size: compressed.length,
    sha256: new Bun.CryptoHasher("sha256").update(compressed).digest("hex"),
  };
  expect(await decodeSystemBackup(result)).toEqual(new Uint8Array(compressed));
  for (const invalid of [
    { ...result, size: result.size + 1 },
    { ...result, sha256: "f".repeat(64) },
    { ...result, data: "javascript:" },
    { ...result, data: Buffer.from("bad gzip").toString("base64"), size: 8 },
    { ...result, size: SYSTEM_BACKUP_LIMIT + 1 },
  ])
    await expect(decodeSystemBackup(invalid)).rejects.toThrow();
});

test("系统维护只使用固定 RPC，后端拒绝的事务不能当作操作成功", async () => {
  const calls: unknown[] = [];
  const rpc = {
    call: async (...args: unknown[]) => {
      calls.push(args);
      if (args[2] === "reboot") return { ok: true, accepted: true };
      return { ok: false, error: "configuration_busy" };
    },
  } as unknown as RouterClient;
  const client = new MaintenanceClient(rpc);
  await client.reboot("sid");
  expect(calls[0]).toEqual(["sid", "router.maintenance", "reboot", { confirm: true }]);
  await expect(client.backup("sid")).rejects.toThrow("待确认或暂存");
});
