import { expect, test } from "bun:test";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import { createRouterStore } from "../../frontend/src/stores/router";
import type { Device, Snapshot } from "../../frontend/src/lib/types";

test("设备信息失败可重试，重复读取共用请求且不会清除已识别设备", async () => {
  let finish!: (device: Device | null) => void;
  let reads = 0;
  const device = { device: "phicomm-n1", role: "router", model: "N1" } as Device;
  const store = createRouterStore({
    device: () => {
      reads++;
      return new Promise<Device | null>((resolve) => {
        finish = resolve;
      });
    },
  } as unknown as RouterClient);
  const first = store.getState().loadDevice();
  const duplicate = store.getState().loadDevice();
  expect(reads).toBe(1);
  expect(store.getState().deviceLoading).toBe(true);
  finish(null);
  await Promise.all([first, duplicate]);
  expect(store.getState().deviceError).toContain("重试");
  expect(store.getState().deviceLoading).toBe(false);
  const retry = store.getState().loadDevice();
  finish(device);
  await retry;
  expect(store.getState().device).toEqual(device);
  expect(store.getState().deviceError).toBeNull();
  const disconnected = store.getState().loadDevice();
  finish(null);
  await disconnected;
  expect(store.getState().device).toEqual(device);
});

test("首次设备读取失败后登录刷新会重新识别设备", async () => {
  let reads = 0;
  const device = { device: "phicomm-n1", role: "router", model: "N1" } as Device;
  const store = createRouterStore({
    device: async () => (++reads === 1 ? null : device),
    login: async () => "a".repeat(32),
    snapshot: async () => ({ updatedAt: 1 }),
  } as unknown as RouterClient);
  await store.getState().loadDevice();
  await store.getState().login("测试密码");
  expect(reads).toBe(2);
  expect(store.getState().device).toEqual(device);
  expect(store.getState().deviceError).toBeNull();
});

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
