import { expect, test } from "bun:test";
import axios, { AxiosError, type AxiosInstance } from "axios";
import { RouterClient, onSessionRejection } from "../../frontend/src/lib/rpc";
import { ConfigClient } from "../../frontend/src/lib/config-client";
import { settingsFixture } from "../helpers/settings-fixture";
import { telemetryFixture } from "../helpers/status-fixture";

interface Request {
  id: number;
  params: [string, string, string, Record<string, unknown>];
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function transport(handle: (body: Request | Request[]) => unknown): AxiosInstance {
  return axios.create({
    adapter: async (config) => ({
      data: await handle(JSON.parse(config.data)),
      config,
      status: 200,
      statusText: "OK",
      headers: {},
    }),
  });
}
const success = (request: Request, value: unknown = {}) => ({
  jsonrpc: "2.0",
  id: request.id,
  result: [0, value],
});

test("概况四项快查询合并一次请求，乱序响应按编号匹配", async () => {
  const requests: Request[][] = [];
  const api = new RouterClient(
    transport((body) => {
      expect(Array.isArray(body)).toBe(true);
      const batch = body as Request[];
      requests.push(batch);
      return batch
        .map((request) => {
          const [, object, method] = request.params;
          return success(
            request,
            object === "router.status"
              ? telemetryFixture()
              : object === "network.interface"
                ? { interface: [{ interface: "lan", up: true }] }
                : method === "board"
                  ? { release: { description: "批量测试" } }
                  : { memory: { total: 100 }, uptime: 10 },
          );
        })
        .reverse();
    }),
  );
  const snapshot = await api.snapshot("sid");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toHaveLength(4);
  expect(new Set(requests[0].map(({ id }) => id)).size).toBe(4);
  expect(snapshot.board.release.description).toBe("批量测试");
  expect(snapshot.info.uptime).toBe(10);
  expect(snapshot.interfaces[0].interface).toBe("lan");
  expect(snapshot.telemetry?.ok).toBe(true);
});

test("配置与暂存状态批量读取，缺失无线配置仍允许其他配置正常加载", async () => {
  const settings = settingsFixture();
  const sizes: number[] = [];
  const client = new ConfigClient(
    new RouterClient(
      transport((body) => {
        const batch = body as Request[];
        sizes.push(batch.length);
        return batch.map((request) => {
          const [, , method, args] = request.params;
          if (method === "changes") return success(request, { changes: {} });
          if (args.config === "wireless") return { id: request.id, result: [4] };
          return success(request, { values: settings[args.config as keyof typeof settings] });
        });
      }),
    ),
  );
  const [snapshot, changed] = await Promise.all([client.read("sid"), client.changes("sid")]);
  expect(sizes).toEqual([5]);
  expect(snapshot.network).toEqual(settings.network);
  expect(snapshot.wireless).toEqual({});
  expect(changed).toBe(false);
});

test("批量错误逐项返回，权限错误仍通知会话校验", async () => {
  const sessions: string[] = [];
  const stop = onSessionRejection((session) => sessions.push(session));
  const api = new RouterClient(
    transport((body) =>
      (body as Request[]).map((request) =>
        request.params[2] === "info"
          ? { id: request.id, result: [6] }
          : success(request, { model: "N1" }),
      ),
    ),
  );
  try {
    const responses = await Promise.allSettled([
      api.call("sid", "system", "board"),
      api.call("sid", "system", "info"),
    ]);
    expect(responses[0]).toMatchObject({ status: "fulfilled", value: { model: "N1" } });
    expect(responses[1]).toMatchObject({ status: "rejected", reason: { code: 6 } });
    expect(sessions).toEqual(["sid"]);
  } finally {
    stop();
  }
});

test("批量响应编号缺失或重复时拒绝对应项，不使用其他查询的结果", async () => {
  for (const duplicate of [false, true]) {
    const api = new RouterClient(
      transport((body) => {
        const [board, info] = body as Request[];
        return [
          success(board, { model: "N1" }),
          ...(duplicate ? [success(board)] : []),
          success({ ...info, id: info.id + 100 }),
        ];
      }),
    );
    const results = await Promise.allSettled([
      api.call("sid", "system", "board"),
      api.call("sid", "system", "info"),
    ]);
    expect(results[0].status).toBe(duplicate ? "rejected" : "fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: { name: "RpcError" } });
  }
});

test("快查询按会话和超时分组，写入及确认始终独立发送且不去重", async () => {
  const bodies: (Request | Request[])[] = [];
  const api = new RouterClient(
    transport((body) => {
      bodies.push(body);
      return Array.isArray(body) ? body.map((request) => success(request)) : success(body);
    }),
  );
  await Promise.all([
    api.call("first", "system", "board"),
    api.call("first", "system", "info"),
    api.call("second", "system", "info"),
    api.call("first", "system", "info", {}, 2000),
    api.call("first", "uci", "set", { config: "network" }),
    api.call("first", "uci", "set", { config: "network" }),
    api.call("first", "uci", "confirm"),
  ]);
  const batches = bodies.filter(Array.isArray);
  expect(batches).toHaveLength(1);
  expect(batches[0].map(({ params }) => params[0])).toEqual(["first", "first"]);
  expect(bodies.filter((body) => !Array.isArray(body))).toHaveLength(5);
});

test("跨客户端无线读取串行并去重，快查询不等待无线队列，刷新不使用旧结果", async () => {
  const gate = deferred();
  const wireless: string[] = [];
  let active = 0,
    maximum = 0;
  const http = transport(async (body) => {
    if (Array.isArray(body)) return body.map((request) => success(request));
    const [, object, method] = body.params;
    if (object !== "iwinfo") return success(body, { fast: true });
    wireless.push(method);
    maximum = Math.max(maximum, ++active);
    if (wireless.length === 1) await gate.promise;
    await tick();
    --active;
    return success(body, { revision: wireless.length });
  });
  const first = new RouterClient(http),
    second = new RouterClient(http);
  const info = first.call("sid", "iwinfo", "info", { device: "wlan0" });
  const duplicate = second.call("sid", "iwinfo", "info", { device: "wlan0" });
  const associations = second.call("sid", "iwinfo", "assoclist", { device: "wlan0" });
  const queuedDuplicate = first.call("sid", "iwinfo", "assoclist", { device: "wlan0" });
  await tick();
  expect(wireless).toEqual(["info"]);
  expect(await first.call("sid", "system", "info")).toEqual({ fast: true });
  expect(wireless).toEqual(["info"]);
  gate.resolve();
  const results = await Promise.all([info, duplicate, associations, queuedDuplicate]);
  expect(results[0]).toEqual(results[1]);
  expect(results[2]).toEqual(results[3]);
  expect(wireless).toEqual(["info", "assoclist"]);
  expect(maximum).toBe(1);
  expect(await second.call("sid", "iwinfo", "info", { device: "wlan0" })).toEqual({ revision: 3 });
});

test("无线超时失败释放队列，不混用不同接口或不同会话的结果", async () => {
  const calls: Request[] = [];
  const api = new RouterClient(
    transport((body) => {
      const request = body as Request;
      calls.push(request);
      if (calls.length === 1) throw new AxiosError("timeout", "ECONNABORTED");
      return success(request, { session: request.params[0], device: request.params[3].device });
    }),
  );
  const responses = await Promise.allSettled([
    api.call("first", "iwinfo", "info", { device: "wlan0" }),
    api.call("first", "iwinfo", "info", { device: "wlan1" }),
    api.call("second", "iwinfo", "info", { device: "wlan0" }),
  ]);
  expect(responses[0]).toMatchObject({ status: "rejected", reason: { name: "RpcError" } });
  expect(responses[1]).toMatchObject({
    status: "fulfilled",
    value: { session: "first", device: "wlan1" },
  });
  expect(responses[2]).toMatchObject({
    status: "fulfilled",
    value: { session: "second", device: "wlan0" },
  });
  await expect(api.call("first", "iwinfo", "info", { device: "wlan0" })).resolves.toEqual({
    session: "first",
    device: "wlan0",
  });
  expect(calls).toHaveLength(4);
});
