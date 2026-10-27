import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  MaintenanceClient,
  decodeSystemBackup,
  SYSTEM_BACKUP_LIMIT,
  validatePasswordChange,
} from "../../frontend/src/lib/maintenance-client";
import type { RouterClient } from "../../frontend/src/lib/rpc";
import { createMaintenanceOperation } from "../../frontend/src/stores/maintenance-operation";

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
  expect(calls[0]).toEqual(["sid", "router.maintenance", "reboot", { confirm: true }, undefined]);
  await expect(client.backup("sid")).rejects.toThrow("待确认或暂存");
});

test("维护操作在跨页期间保持互斥，旧请求结束不能释放新会话的操作", () => {
  const store = createMaintenanceOperation();
  store.getState().bind("first");
  const first = store.getState().begin("backup")!;
  expect(store.getState().begin("reboot")).toBeNull();
  store.getState().bind("second");
  const second = store.getState().begin("reboot")!;
  store.getState().finish(first);
  expect(store.getState().kind).toBe("reboot");
  store.getState().finish(second);
  expect(store.getState().kind).toBeNull();
});

test("分块上传按顺序验证设备偏移、哈希与归档预览，执行前不恢复配置", async () => {
  const compressed = gzipSync(crypto.getRandomValues(new Uint8Array(65536)));
  const token = "a".repeat(32);
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const chunks: Buffer[] = [];
  const client = new MaintenanceClient({
    call: async (_sid: string, _object: string, method: string, args: Record<string, unknown>) => {
      calls.push({ method, args });
      if (method === "upload_start") return { ok: true, token };
      if (method === "upload_chunk") {
        const bytes = Buffer.from(String(args.data), "base64");
        chunks.push(bytes);
        return { ok: true, offset: Number(args.offset) + bytes.length };
      }
      return { ok: true, files: 5, accepted: true };
    },
  } as unknown as RouterClient);
  const progress: number[] = [];
  const prepared = await client.prepare(
    "sid",
    "restore",
    new File([compressed], "backup.tar.gz"),
    "",
    (value) => progress.push(value),
  );
  expect(Buffer.concat(chunks)).toEqual(compressed);
  expect(calls[0]?.args.sha256).toBe(
    new Bun.CryptoHasher("sha256").update(compressed).digest("hex"),
  );
  expect(progress.at(-1)).toBe(100);
  expect(prepared.files).toBe(5);
  expect(calls.some((call) => call.method === "restore")).toBe(false);
  await client.execute("sid", "restore", prepared.token);
  expect(calls.at(-1)).toEqual({ method: "restore", args: { confirm: true, token } });
});

test("固件校验失败不会开始上传；设备偏移或兼容性失败会清理上传", async () => {
  const bytes = Buffer.from("firmware-fixture");
  const file = new File([bytes], "sysupgrade.bin");
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  for (const failure of ["offset", "inspect"]) {
    const calls: string[] = [];
    const client = new MaintenanceClient({
      call: async (
        _sid: string,
        _object: string,
        method: string,
        args: Record<string, unknown>,
      ) => {
        calls.push(method);
        if (method === "upload_start") return { ok: true, token: "a".repeat(32) };
        if (method === "upload_chunk")
          return {
            ok: true,
            offset: failure === "offset" ? 999 : Buffer.from(String(args.data), "base64").length,
          };
        if (method === "inspect") return { ok: false, error: "invalid_firmware" };
        return { ok: true };
      },
    } as unknown as RouterClient);
    await expect(client.prepare("sid", "upgrade", file, "f".repeat(64), () => {})).rejects.toThrow(
      "SHA-256",
    );
    expect(calls).toHaveLength(0);
    await expect(client.prepare("sid", "upgrade", file, sha256, () => {})).rejects.toThrow();
    expect(calls.at(-1)).toBe("upload_cancel");
    expect(calls).not.toContain("upgrade");
  }
});

test("缺少设备能力字段时默认拒绝刷写与恢复出厂", async () => {
  const client = new MaintenanceClient({
    call: async () => ({ ok: true, configurationBusy: false, operationBusy: false }),
  } as unknown as RouterClient);
  expect((await client.read("sid")).upgradeSupported).toBe(false);
  expect((await client.read("sid")).resetSupported).toBe(false);
});

test("修改登录密码校验当前密码、两次确认、字节上限与控制字符", () => {
  validatePasswordChange("current-password", "new-password", "new-password");
  for (const values of [
    ["", "new-password", "new-password"],
    ["old", "short", "short"],
    ["old", "new-password", "different"],
    ["old-password", "old-password", "old-password"],
    ["old", "new\npassword", "new\npassword"],
    ["old", " ".repeat(12), " ".repeat(12)],
    ["old", "字".repeat(43), "字".repeat(43)],
  ] as const)
    expect(() => validatePasswordChange(...values)).toThrow();
});

test("密码修改只调用受限接口，不把拒绝或不完整响应当成修改成功", async () => {
  const calls: unknown[] = [];
  const client = new MaintenanceClient({
    call: async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true, changed: true, sessionsRevoked: true };
    },
  } as unknown as RouterClient);
  expect(
    await client.changePassword("sid", "current-password", "new-password", "new-password"),
  ).toBe(true);
  expect(calls[0]).toEqual([
    "sid",
    "router.maintenance",
    "password",
    { current: "current-password", password: "new-password", confirmation: "new-password" },
    undefined,
  ]);
  const rejected = new MaintenanceClient({
    call: async () => ({ ok: false, error: "current_password_incorrect" }),
  } as unknown as RouterClient);
  await expect(
    rejected.changePassword("sid", "wrong", "new-password", "new-password"),
  ).rejects.toThrow("当前登录密码");
});
