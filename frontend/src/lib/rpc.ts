import axios, { type AxiosInstance } from "axios";
import type { Board, Device, NetworkInterface, Snapshot, SystemInfo, Telemetry } from "./types";

const anonymous = "00000000000000000000000000000000";

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }

  get sessionExpired() {
    return this.code === 6 || this.code === -32001 || this.code === -32002;
  }
}

export class RouterClient {
  private id = 0;

  constructor(private readonly http: AxiosInstance = axios.create({ timeout: 12000 })) {}

  async call<T>(
    session: string,
    object: string,
    method: string,
    args: object = {},
    timeout?: number,
  ): Promise<T> {
    try {
      const { data } = await this.http.post(
        "/ubus",
        {
          jsonrpc: "2.0",
          id: ++this.id,
          method: "call",
          params: [session, object, method, args],
        },
        timeout ? { timeout } : undefined,
      );
      if (data?.error) {
        throw new RpcError("设备暂时无法完成请求", data.error.code);
      }
      if (!Array.isArray(data?.result) || typeof data.result[0] !== "number") {
        throw new RpcError("设备返回的数据格式不正确");
      }
      if (data.result[0] !== 0) {
        throw new RpcError("无法读取设备状态", data.result[0]);
      }
      return data.result[1] as T;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError("连接设备失败，请检查网络后重试");
    }
  }

  async login(password: string) {
    if (!password.trim()) throw new RpcError("请输入设备密码");
    const data = await this.call<{ ubus_rpc_session: string }>(anonymous, "session", "login", {
      username: "root",
      password,
      timeout: 900,
    });
    if (!/^[a-f0-9]{32}$/.test(data?.ubus_rpc_session ?? "")) {
      throw new RpcError("设备未能创建登录会话");
    }
    return data.ubus_rpc_session;
  }

  async logout(session: string) {
    // 网关会注入当前会话，客户端不传入可被替换的会话参数。
    await this.call(session, "session", "destroy");
  }

  async device(): Promise<Device | null> {
    try {
      const { data } = await this.http.get<Device>("/device.json");
      if (!data || !["jdcloud-ax1800", "phicomm-n1"].includes(data.device)) return null;
      if (!["router", "bypass"].includes(data.role)) return null;
      return data;
    } catch {
      return null;
    }
  }

  async snapshot(session: string): Promise<Snapshot> {
    let telemetryError: string | null = null;
    const [board, info, network, telemetry] = await Promise.all([
      this.call<Board>(session, "system", "board"),
      this.call<SystemInfo>(session, "system", "info"),
      this.call<{ interface: NetworkInterface[] }>(session, "network.interface", "dump"),
      this.call<Telemetry>(session, "router.status", "summary")
        .then((value) => {
          if (
            !value?.ok ||
            !Array.isArray(value.temperatures) ||
            !Array.isArray(value.storage) ||
            !Array.isArray(value.ports)
          )
            throw new RpcError("扩展状态数据不完整");
          return value;
        })
        .catch((error: unknown) => {
          if (error instanceof RpcError && error.sessionExpired) throw error;
          telemetryError = "温度、存储与网口状态暂不可用，请稍后刷新或检查设备端状态组件。";
          return null;
        }),
    ]);
    if (!board?.release || !info?.memory || !Array.isArray(network?.interface)) {
      throw new RpcError("设备状态不完整，请稍后重试");
    }
    return {
      board,
      info,
      interfaces: network.interface,
      telemetry,
      telemetryError,
      updatedAt: Date.now(),
    };
  }
}
