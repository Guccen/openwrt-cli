import axios, { type AxiosInstance } from "axios";
import type { Board, Device, NetworkInterface, Snapshot, SystemInfo, Telemetry } from "./types";

const anonymous = "00000000000000000000000000000000";
const defaultHttp = axios.create({ timeout: 12000 });
// 只合并已知的快读接口；写入、诊断和无线驱动读取各自发送。
const fastReads = new Set([
  "system.board",
  "system.info",
  "network.interface.dump",
  "router.status.summary",
  "router.status.clients",
  "router.status.wireless",
  "uci.get",
  "uci.changes",
]);
const wirelessReads = new Set(["info", "assoclist", "phyname", "freqlist", "countrylist"]);
export const WIRELESS_READ_TIMEOUT = 30000;
const sessionRejections = new Set<(session: string) => void>();
export function onSessionRejection(listener: (session: string) => void) {
  sessionRejections.add(listener);
  return () => {
    sessionRejections.delete(listener);
  };
}

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

export class RpcCancelledError extends RpcError {
  constructor() {
    super("请求已取消");
    this.name = "RpcCancelledError";
  }
}

function cancellation(signal: AbortSignal) {
  return signal.reason?.name === "TimeoutError"
    ? new RpcError("无线状态读取等待超时，请重试")
    : new RpcCancelledError();
}

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: "call";
  params: [string, string, string, object];
}
interface PendingRead {
  request: RpcRequest;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface WirelessRead {
  operation: Promise<unknown>;
  controller: AbortController;
  subscribers: number;
  done: boolean;
}

class RpcTransport {
  private id = 0;
  private batches = new Map<string, PendingRead[]>();
  private wireless = new Map<string, WirelessRead>();
  private wirelessTail: Promise<void> = Promise.resolve();

  constructor(private readonly http: AxiosInstance) {}

  request(
    session: string,
    object: string,
    method: string,
    args: object,
    timeout?: number,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return Promise.reject(cancellation(signal));
    const request: RpcRequest = {
      jsonrpc: "2.0",
      id: ++this.id,
      method: "call",
      params: [session, object, method, args],
    };
    if (object === "iwinfo" && wirelessReads.has(method)) {
      const key = JSON.stringify([
        session,
        method,
        Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
        timeout ?? null,
      ]);
      let pending = this.wireless.get(key);
      if (!pending) {
        const controller = new AbortController();
        // 队列等待也计入总期限；页面离开或所有订阅者取消后不再发送过时请求。
        const timer = setTimeout(
          () => controller.abort(new DOMException("读取超时", "TimeoutError")),
          WIRELESS_READ_TIMEOUT,
        );
        const operation = this.wirelessTail.then(() => {
          if (controller.signal.aborted) throw cancellation(controller.signal);
          return this.send(request, timeout, controller.signal);
        });
        const task: WirelessRead = { operation, controller, subscribers: 0, done: false };
        pending = task;
        this.wireless.set(key, task);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            if (this.wireless.get(key) === task) this.wireless.delete(key);
          },
          { once: true },
        );
        const cleanup = () => {
          task.done = true;
          clearTimeout(timer);
          if (this.wireless.get(key) === task) this.wireless.delete(key);
        };
        this.wirelessTail = operation.then(cleanup, cleanup);
      }
      return this.subscribe(pending, signal);
    }
    if (signal) return this.send(request, timeout, signal);
    if (!fastReads.has(`${object}.${method}`)) return this.send(request, timeout);
    const key = JSON.stringify([session, timeout ?? null]);
    return new Promise<unknown>((resolve, reject) => {
      const batch = this.batches.get(key);
      if (batch) batch.push({ request, resolve, reject });
      else {
        this.batches.set(key, [{ request, resolve, reject }]);
        // 同一轮发起的快查询合并；不额外延迟，也不混用会话或超时设置。
        queueMicrotask(() => {
          const reads = this.batches.get(key)!;
          this.batches.delete(key);
          void this.flush(reads, timeout);
        });
      }
    });
  }

  private subscribe(task: WirelessRead, signal?: AbortSignal) {
    task.subscribers++;
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      const finish = (complete: (value: unknown) => void, value: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        task.controller.signal.removeEventListener("abort", abort);
        --task.subscribers;
        complete(value);
        // 共享读取只在最后一个订阅者退出时取消，其他页面仍可正常接收结果。
        if (!task.subscribers && !task.done) task.controller.abort();
      };
      const cancel = () => finish(reject, cancellation(signal!));
      const abort = () => finish(reject, cancellation(task.controller.signal));
      signal?.addEventListener("abort", cancel, { once: true });
      task.controller.signal.addEventListener("abort", abort, { once: true });
      void task.operation.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
      if (signal?.aborted) cancel();
      else if (task.controller.signal.aborted) abort();
    });
  }

  private async send(
    request: RpcRequest | RpcRequest[],
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { data } = await this.http.post("/ubus", request, {
      ...(timeout ? { timeout } : {}),
      ...(signal ? { signal } : {}),
    });
    return data;
  }

  private async flush(reads: PendingRead[], timeout?: number) {
    try {
      if (reads.length === 1) {
        reads[0].resolve(await this.send(reads[0].request, timeout));
        return;
      }
      const data = await this.send(
        reads.map(({ request }) => request),
        timeout,
      );
      if (!Array.isArray(data)) throw new RpcError("设备返回的批量状态格式不正确");
      const responses = new Map<number, unknown>();
      const duplicates = new Set<number>();
      for (const response of data) {
        if (!response || typeof response !== "object" || !Number.isInteger(response.id)) continue;
        if (responses.has(response.id)) duplicates.add(response.id);
        responses.set(response.id, response);
      }
      // 批量响应允许乱序；缺失或重复编号只使对应查询失败，不误用其他项的数据。
      for (const { request, resolve, reject } of reads) {
        if (!responses.has(request.id) || duplicates.has(request.id))
          reject(new RpcError("设备返回的批量状态编号不正确"));
        else resolve(responses.get(request.id));
      }
    } catch (error) {
      for (const { reject } of reads) reject(error);
    }
  }
}

const transports = new WeakMap<AxiosInstance, RpcTransport>();

export class RouterClient {
  private readonly transport: RpcTransport;

  constructor(private readonly http: AxiosInstance = defaultHttp) {
    // 页面中的多个客户端共用同一个端点队列，避免切页后叠加无线请求。
    let transport = transports.get(http);
    if (!transport) {
      transport = new RpcTransport(http);
      transports.set(http, transport);
    }
    this.transport = transport;
  }

  async call<T>(
    session: string,
    object: string,
    method: string,
    args: object = {},
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      const data = (await this.transport.request(
        session,
        object,
        method,
        args,
        timeout,
        signal,
      )) as {
        error?: { code?: number };
        result?: unknown[];
      } | null;
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
      if (signal?.aborted) throw cancellation(signal);
      if (error instanceof RpcError) {
        if (error.sessionExpired && session !== anonymous)
          for (const listener of sessionRejections) listener(session);
        throw error;
      }
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
