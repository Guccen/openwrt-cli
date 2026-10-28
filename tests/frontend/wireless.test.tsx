import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import axios from "axios";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import { WirelessClient, signalDbm, station } from "../../frontend/src/lib/wireless-client";
import { StationTable } from "../../frontend/src/components/wireless/station-table";
import { RadioCard } from "../../frontend/src/components/wireless/radio-card";
import { createSessionResource } from "../../frontend/src/stores/resource";

test("无线数据处理有符号信号、缺失速率与转义，不把未知数据当作零客户端", () => {
  expect(signalDbm(4294967246)).toBe(-50);
  for (const value of [0, null, NaN, -200, "-50", 8589934542, -4294967346])
    expect(signalDbm(value)).toBeNull();
  const row = station({
    mac: "<script>alert(1)</script>",
    signal: -42,
    rx: { rate: 120100 },
    tx: {},
  });
  expect(row.rx).toBe(120100);
  expect(row.tx).toBeNull();
  const html = renderToStaticMarkup(<StationTable stations={[row]} />);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("120.1 Mbps");
  expect(renderToStaticMarkup(<StationTable stations={null} />)).toContain("暂不可用");
  expect(renderToStaticMarkup(<StationTable stations={[]} />)).toContain("没有连接");
});

test("无线只按运行接口读取，单个接口消失不影响其他数据，不调用扫描或写入接口", async () => {
  const calls: string[] = [];
  const rpc = {
    call: async (_sid: string, object: string, method: string, args?: { device: string }) => {
      calls.push(`${object}.${method}`);
      if (object === "router.status" && method === "wireless")
        return {
          ok: true,
          radios: {
            radio0: {
              up: true,
              config: { band: "2g", key: "never-copy-this" },
              interfaces: [
                { section: "ap0", ifname: "phy0-ap0", config: { mode: "ap", ssid: "test" } },
              ],
            },
            radio1: { up: false, disabled: true, interfaces: [{ ifname: "phy1-ap0" }] },
          },
        };
      expect(args?.device).toBe("phy0-ap0");
      if (method === "info") throw new RpcError("gone", 4);
      return { results: [{ mac: "00:11:22:33:44:55", signal: -50, authorized: true }] };
    },
  } as unknown as RouterClient;
  const result = await new WirelessClient(rpc).read("session");
  expect(result.radios).toHaveLength(2);
  expect(result.radios[0].interfaces[0].stations).toHaveLength(1);
  expect(result.radios[0].interfaces[0].warning).toContain("重载");
  expect(JSON.stringify(result)).not.toContain("never-copy-this");
  expect(calls).toEqual(["router.status.wireless", "iwinfo.info", "iwinfo.assoclist"]);
});

test("网页通过只读状态接口读取 N1 的 wlan0，不调用拒绝会话参数的原始状态接口", async () => {
  const calls: string[] = [];
  const rpc = new RouterClient(
    axios.create({
      adapter: async (config) => {
        const [sid, object, method, args] = JSON.parse(config.data).params;
        expect(sid).toBe("session");
        calls.push(`${object}.${method}`);
        let result: unknown[] = [2];
        if (object === "router.status" && method === "wireless") {
          expect(args).toEqual({});
          result = [
            0,
            {
              ok: true,
              radios: {
                radio0: {
                  up: true,
                  config: { band: "2g", channel: "1" },
                  interfaces: [
                    {
                      section: "default_radio0",
                      ifname: "wlan0",
                      config: { ssid: "N1", mode: "ap" },
                    },
                  ],
                },
              },
            },
          ];
        }
        if (object === "iwinfo") {
          expect(args).toEqual({ device: "wlan0" });
          result = [
            0,
            method === "info"
              ? { channel: 1, frequency: 2412 }
              : {
                  results: [
                    {
                      mac: "02:00:00:00:00:01",
                      signal: 0,
                      connected_time: 173,
                      authorized: true,
                      rx: { rate: 11000 },
                      tx: { rate: 72200 },
                    },
                  ],
                },
          ];
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { result } };
      },
    }),
  );
  const result = await new WirelessClient(rpc).read("session");
  const iface = result.radios[0].interfaces[0];
  expect(result.radios[0].up).toBe(true);
  expect(iface.name).toBe("wlan0");
  expect(iface.channel).toBe(1);
  expect(iface.stations).toEqual([
    {
      mac: "02:00:00:00:00:01",
      signal: null,
      noise: null,
      snr: null,
      connected: 173,
      authorized: true,
      rx: 11000,
      tx: 72200,
    },
  ]);
  expect(calls).toEqual(["router.status.wireless", "iwinfo.info", "iwinfo.assoclist"]);
});

test("无线运行数据展示实际模式、校准功率和信噪比，不额外调用设备接口", async () => {
  const calls: string[] = [];
  const rpc = {
    call: async (_session: string, object: string, method: string) => {
      calls.push(`${object}.${method}`);
      if (object === "router.status")
        return {
          ok: true,
          radios: {
            radio0: {
              up: true,
              config: { band: "5g" },
              interfaces: [{ ifname: "phy0-ap0", config: { mode: "ap" } }],
            },
          },
        };
      if (method === "info")
        return {
          channel: 149,
          frequency: 5745,
          htmode: "HE80",
          htmodes: ["HE160"],
          txpower: 20,
          txpower_offset: 3,
          noise: 4294967201,
        };
      return {
        results: [
          { signal: 4294967236, noise: 4294967201, rx: { rate: 1201000 }, tx: { rate: 573500 } },
        ],
      };
    },
  } as unknown as RouterClient;
  const radio = (await new WirelessClient(rpc).read("session")).radios[0];
  expect(radio.interfaces[0]).toMatchObject({ htmode: "HE80", txpower: 23, noise: -95 });
  expect(radio.interfaces[0].stations?.[0]).toMatchObject({ signal: -60, noise: -95, snr: 35 });
  const html = renderToStaticMarkup(<RadioCard radio={radio} />);
  for (const value of ["HE80", "23 dBm", "-95 dBm", "35 dB", "1201.0 Mbps"])
    expect(html).toContain(value);
  expect(html).not.toContain("HE160");
  expect(calls).toEqual(["router.status.wireless", "iwinfo.info", "iwinfo.assoclist"]);
});

test("旧驱动缺失运行模式或给出异常数据时显示未知，不把支持列表当运行带宽", async () => {
  const rpc = {
    call: async (_session: string, object: string, method: string) => {
      if (object === "router.status")
        return { ok: true, radios: { radio0: { up: true, interfaces: [{ ifname: "wlan0" }] } } };
      if (method === "info") return { htmodes: ["HE80"], txpower: "20", noise: 0 };
      return { results: [{ signal: -60, noise: 0 }] };
    },
  } as unknown as RouterClient;
  const radio = (await new WirelessClient(rpc).read("session")).radios[0];
  expect(radio.interfaces[0]).toMatchObject({ htmode: null, txpower: null, noise: null });
  expect(radio.interfaces[0].stations?.[0].snr).toBeNull();
  expect(station({ signal: -80, noise: -60 }).snr).toBeNull();
  const html = renderToStaticMarkup(<RadioCard radio={radio} />);
  expect(html).toContain("未知");
  expect(html).not.toContain("HE80");
  expect(html).not.toContain(">0 dBm<");
});

test("无线来源不可用与无射频明确区分，不把失败或格式错误显示为空列表", async () => {
  for (const value of [
    null,
    { ok: false, error: "wireless_unavailable" },
    { ok: true, radios: [] },
    { ok: true },
  ]) {
    const rpc = { call: async () => value } as unknown as RouterClient;
    await expect(new WirelessClient(rpc).read("session")).rejects.toBeInstanceOf(RpcError);
  }
  const rpc = { call: async () => ({ ok: true, radios: {} }) } as unknown as RouterClient;
  expect((await new WirelessClient(rpc).read("session")).radios).toEqual([]);
});

test("读取无线不会吞掉会话失效，换会话后不会显示迟到的设备信息", async () => {
  const rpc = {
    call: async (_sid: string, object: string) => {
      if (object === "router.status")
        return { ok: true, radios: { radio0: { up: true, interfaces: [{ ifname: "phy0-ap0" }] } } };
      throw new RpcError("expired", 6);
    },
  } as unknown as RouterClient;
  await expect(new WirelessClient(rpc).read("session")).rejects.toThrow("expired");
  let finish!: (value: string) => void;
  const store = createSessionResource(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  store.getState().bind("first");
  const load = store.getState().load();
  store.getState().bind("second");
  finish("old-device");
  await load;
  expect(store.getState().snapshot).toBeNull();
  expect(store.getState().loading).toBe(false);
});

test("无线页面离开和换会话立即中止读取，不显示取消错误", async () => {
  const signals: AbortSignal[] = [];
  const store = createSessionResource<string>((_session, signal) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("已取消")), { once: true });
    });
  });
  store.getState().bind("first");
  const first = store.getState().load();
  store.getState().cancel();
  await first;
  expect(signals[0].aborted).toBe(true);
  expect(store.getState().loading).toBe(false);
  expect(store.getState().error).toBeNull();
  const second = store.getState().load();
  store.getState().bind("second");
  await second;
  expect(signals[1].aborted).toBe(true);
  expect(store.getState().session).toBe("second");
  expect(store.getState().snapshot).toBeNull();
});
