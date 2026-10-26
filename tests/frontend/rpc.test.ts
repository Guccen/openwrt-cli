import { describe, expect, test } from "bun:test";
import axios from "axios";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";

function client(result: unknown, inspect?: (body: Record<string, unknown>) => void) {
  return new RouterClient(
    axios.create({
      adapter: async (config) => {
        inspect?.(JSON.parse(config.data));
        return { data: result, status: 200, statusText: "OK", headers: {}, config };
      },
    }),
  );
}

describe("设备状态接口", () => {
  test("登录只向本机请求会话，密码不进入 URL", async () => {
    const sid = "a".repeat(32);
    const api = client({ result: [0, { ubus_rpc_session: sid }] }, (body) => {
      expect(body.method).toBe("call");
      expect(body.params).toEqual([
        "0".repeat(32),
        "session",
        "login",
        { username: "root", password: "test-password", timeout: 900 },
      ]);
    });
    expect(await api.login("test-password")).toBe(sid);
  });
  test("拒绝空密码和不完整的会话响应", async () => {
    await expect(client({ result: [0, {}] }).login("")).rejects.toThrow("请输入设备密码");
    await expect(client({ result: [0, {}] }).login("test-password")).rejects.toThrow(
      "设备未能创建登录会话",
    );
  });
  test("识别过期会话，不把错误响应当成成功", async () => {
    for (const response of [
      { result: [6] },
      { error: { code: -32001 } },
      { error: { code: -32002 } },
    ]) {
      try {
        await client(response).call("a".repeat(32), "system", "info");
        throw new Error("应该拒绝请求");
      } catch (error) {
        expect(error).toBeInstanceOf(RpcError);
        expect((error as RpcError).sessionExpired).toBe(true);
      }
    }
    await expect(client({ result: "invalid" }).call("sid", "system", "info")).rejects.toThrow(
      "格式不正确",
    );
  });
  test("退出时不允许客户端替换服务端注入的会话", async () => {
    const api = client({ result: [0] }, (body) =>
      expect((body.params as unknown[])[3]).toEqual({}),
    );
    await api.logout("a".repeat(32));
  });
});
