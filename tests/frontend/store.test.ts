import { expect, test } from "bun:test";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import { createRouterStore } from "../../frontend/src/stores/router";
import type { Snapshot } from "../../frontend/src/lib/types";

test("退出登录后到达的旧状态不会重新显示", async () => {
  let finish!: (snapshot: Snapshot) => void;
  const pending = new Promise<Snapshot>((resolve) => {
    finish = resolve;
  });
  const client = { snapshot: () => pending, logout: async () => {} } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.setState({ session: "a".repeat(32) });
  const refresh = store.getState().refresh();
  await store.getState().logout();
  finish({ updatedAt: 1 } as Snapshot);
  await refresh;
  expect(store.getState().session).toBeNull();
  expect(store.getState().snapshot).toBeNull();
  expect(store.getState().loading).toBe(false);
});

test("会话失效后清除设备状态并要求重新登录", async () => {
  const client = {
    call: async () => ({ access: false }),
    snapshot: async () => {
      throw new RpcError("过期", 6);
    },
  } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.setState({ session: "a".repeat(32), snapshot: { updatedAt: 1 } as Snapshot });
  await store.getState().refresh();
  expect(store.getState().session).toBeNull();
  expect(store.getState().snapshot).toBeNull();
  expect(store.getState().error).toContain("重新登录");
});

test("单个状态接口拒绝访问但会话仍有效时保留登录", async () => {
  const client = {
    call: async () => ({ access: true }),
    snapshot: async () => {
      throw new RpcError("拒绝访问", 6);
    },
  } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.getState().adoptSession("a".repeat(32));
  await store.getState().refresh();
  expect(store.getState().session).toBe("a".repeat(32));
  expect(store.getState().error).toContain("权限");
  expect(store.getState().loading).toBe(false);
});

test("拒绝访问后的会话检查临时断线不会强制退出", async () => {
  const client = {
    call: async () => {
      throw new RpcError("连接设备失败");
    },
    snapshot: async () => {
      throw new RpcError("拒绝访问", 6);
    },
  } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.getState().adoptSession("a".repeat(32));
  await store.getState().refresh();
  expect(store.getState().session).toBe("a".repeat(32));
  expect(store.getState().error).toContain("连接设备失败");
  expect(store.getState().loading).toBe(false);
});

test("会话检查晚于新登录完成时不能清除新会话", async () => {
  let finish!: (value: { access: boolean }) => void;
  const client = {
    call: () =>
      new Promise<{ access: boolean }>((resolve) => {
        finish = resolve;
      }),
    snapshot: async () => {
      throw new RpcError("拒绝访问", 6);
    },
  } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.getState().adoptSession("a".repeat(32));
  const refresh = store.getState().refresh();
  await Promise.resolve();
  store.getState().adoptSession("b".repeat(32));
  finish({ access: false });
  await refresh;
  expect(store.getState().session).toBe("b".repeat(32));
  expect(store.getState().error).toBeNull();
});

test("网络错误允许重试，并保留上一次读取结果", async () => {
  const client = {
    snapshot: async () => {
      throw new RpcError("连接设备失败");
    },
  } as unknown as RouterClient;
  const store = createRouterStore(client);
  store.setState({ session: "a".repeat(32), snapshot: { updatedAt: 1 } as Snapshot });
  await store.getState().refresh();
  expect(store.getState().session).not.toBeNull();
  expect(store.getState().snapshot?.updatedAt).toBe(1);
  expect(store.getState().loading).toBe(false);
});
