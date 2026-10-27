import { expect, test } from "bun:test";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import { createSessionStorage, sessionStorageKey } from "../../frontend/src/lib/session-storage";
import type { Snapshot } from "../../frontend/src/lib/types";
import { createRouterStore } from "../../frontend/src/stores/router";

const sid = "a".repeat(32);
const otherSid = "b".repeat(32);
const snapshot = { updatedAt: 1 } as Snapshot;

function memoryStorage(value?: string) {
  const values = new Map<string, string>(value !== undefined ? [[sessionStorageKey, value]] : []);
  const adapter = createSessionStorage(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  }));
  return { values, adapter };
}

function clientWith(overrides: object = {}) {
  return {
    call: async () => ({ access: true }),
    login: async () => sid,
    snapshot: async () => snapshot,
    logout: async () => {},
    ...overrides,
  } as unknown as RouterClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

test("登录只保存标签页 SID，重建页面先验证权限再恢复会话", async () => {
  const { values, adapter } = memoryStorage();
  const original = createRouterStore(clientWith(), adapter);
  await original.getState().restoreSession();
  expect(original.getState().sessionReady).toBe(true);
  await original.getState().login("never-persist-this-password");
  expect([...values]).toEqual([[sessionStorageKey, sid]]);

  const check = deferred<{ access: boolean }>();
  const calls: unknown[][] = [];
  const reloaded = createRouterStore(
    clientWith({
      call: (...args: unknown[]) => {
        calls.push(args);
        return check.promise;
      },
    }),
    adapter,
  );
  const restoring = reloaded.getState().restoreSession();
  expect(reloaded.getState().session).toBeNull();
  expect(reloaded.getState().sessionReady).toBe(false);
  expect(calls).toEqual([
    [sid, "session", "access", { scope: "ubus", object: "system", function: "board" }],
  ]);
  check.resolve({ access: true });
  await restoring;
  expect(reloaded.getState().session).toBe(sid);
  expect(reloaded.getState().sessionReady).toBe(true);
  expect(reloaded.getState().snapshot).toBe(snapshot);
});

test("篡改格式或匿名 SID 直接清除，合法格式的 SID 仍需服务端验证", async () => {
  for (const token of ["", "bad-token", "0".repeat(32), sid]) {
    const { values, adapter } = memoryStorage(token);
    let checks = 0;
    const store = createRouterStore(
      clientWith({
        call: async () => {
          checks++;
          return { access: false };
        },
      }),
      adapter,
    );
    await store.getState().restoreSession();
    expect(checks).toBe(token === sid ? 1 : 0);
    expect(values.size).toBe(0);
    expect(store.getState().session).toBeNull();
    expect(store.getState().sessionReady).toBe(true);
    expect(store.getState().error).toContain("重新登录");
  }
});

test("过期或拒绝访问的会话清理持久化标识", async () => {
  for (const code of [6, -32001, -32002]) {
    const { values, adapter } = memoryStorage(sid);
    const store = createRouterStore(
      clientWith({
        call: async () => {
          throw new RpcError("登录过期", code);
        },
      }),
      adapter,
    );
    await store.getState().restoreSession();
    expect(store.getState().session).toBeNull();
    expect(store.getState().sessionReady).toBe(true);
    expect(values.size).toBe(0);
  }
});

test("临时断线或不完整响应阻止进入控制台但保留 SID，重试后恢复", async () => {
  for (const failure of [new RpcError("连接设备失败"), {}]) {
    const { values, adapter } = memoryStorage(sid);
    let attempts = 0;
    const store = createRouterStore(
      clientWith({
        call: async () => {
          if (attempts++ === 0) {
            if (failure instanceof Error) throw failure;
            return failure;
          }
          return { access: true };
        },
      }),
      adapter,
    );
    await store.getState().restoreSession();
    expect(store.getState().session).toBeNull();
    expect(store.getState().sessionReady).toBe(false);
    expect(store.getState().sessionRestoreError).toBeTruthy();
    expect(store.getState().loading).toBe(false);
    expect(values.get(sessionStorageKey)).toBe(sid);
    await store.getState().restoreSession();
    expect(store.getState().session).toBe(sid);
    expect(store.getState().sessionReady).toBe(true);
    expect(store.getState().sessionRestoreError).toBeNull();
  }
});

test("并发恢复共用一次检查，退出后到达的恢复响应不会重新登录", async () => {
  const { values, adapter } = memoryStorage(sid);
  const check = deferred<{ access: boolean }>();
  let checks = 0;
  const store = createRouterStore(
    clientWith({
      call: () => {
        checks++;
        return check.promise;
      },
    }),
    adapter,
  );
  const first = store.getState().restoreSession();
  const second = store.getState().restoreSession();
  expect(first).toBe(second);
  expect(checks).toBe(1);
  await store.getState().logout();
  check.resolve({ access: true });
  await first;
  expect(store.getState().session).toBeNull();
  expect(store.getState().sessionReady).toBe(true);
  expect(store.getState().snapshot).toBeNull();
  expect(values.size).toBe(0);
});

test("退出或替换会话后到达的登录及恢复响应不能覆盖新状态", async () => {
  const { values, adapter } = memoryStorage();
  const login = deferred<string>();
  const store = createRouterStore(clientWith({ login: () => login.promise }), adapter);
  const pending = store.getState().login("password");
  await store.getState().logout();
  login.resolve(sid);
  await pending;
  expect(store.getState().session).toBeNull();
  expect(values.size).toBe(0);

  const old = memoryStorage(sid);
  const check = deferred<{ access: boolean }>();
  const reloaded = createRouterStore(clientWith({ call: () => check.promise }), old.adapter);
  const restoring = reloaded.getState().restoreSession();
  expect(reloaded.getState().adoptSession(otherSid)).toBe(true);
  check.resolve({ access: true });
  await restoring;
  expect(reloaded.getState().session).toBe(otherSid);
  expect(old.values.get(sessionStorageKey)).toBe(otherSid);
  expect(reloaded.getState().adoptSession("invalid")).toBe(false);
  expect(reloaded.getState().session).toBe(otherSid);
});

test("地址变更交接已接收的会话不会被稍后启动的恢复覆盖", async () => {
  const { values, adapter } = memoryStorage(sid);
  let checks = 0;
  const store = createRouterStore(
    clientWith({
      call: async () => {
        checks++;
        return { access: true };
      },
    }),
    adapter,
  );
  store.getState().adoptSession(otherSid);
  await store.getState().restoreSession();
  expect(checks).toBe(0);
  expect(store.getState().session).toBe(otherSid);
  expect(values.get(sessionStorageKey)).toBe(otherSid);
});

test("主动退出、密码撤销和状态请求过期均清理持久化会话", async () => {
  for (const action of ["logout", "forget", "expired"] as const) {
    const { values, adapter } = memoryStorage();
    const store = createRouterStore(
      clientWith({
        snapshot: async () => {
          throw new RpcError("过期", -32001);
        },
      }),
      adapter,
    );
    store.getState().adoptSession(sid);
    if (action === "logout") await store.getState().logout();
    else if (action === "forget") store.getState().forgetSession();
    else await store.getState().refresh();
    expect(store.getState().session).toBeNull();
    expect(values.size).toBe(0);
  }
});

test("存储不可用仍可登录和退出，密码与 SID 不进入其他存储", async () => {
  const storage = createSessionStorage(() => {
    throw new Error("SecurityError");
  });
  const store = createRouterStore(clientWith(), storage);
  await store.getState().restoreSession();
  expect(store.getState().sessionReady).toBe(true);
  await store.getState().login("password");
  expect(store.getState().session).toBe(sid);
  await store.getState().logout();
  expect(store.getState().session).toBeNull();

  const quota = createSessionStorage(() => ({
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  }));
  const blocked = createRouterStore(clientWith(), quota);
  await blocked.getState().login("password");
  expect(blocked.getState().session).toBe(sid);
  blocked.getState().forgetSession();
  expect(blocked.getState().session).toBeNull();
});
