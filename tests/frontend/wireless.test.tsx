import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import { WirelessClient, signalDbm, station } from "../../frontend/src/lib/wireless-client";
import { StationTable } from "../../frontend/src/components/wireless/station-table";
import { createSessionResource } from "../../frontend/src/stores/resource";

test("无线数据处理有符号信号、缺失速率与转义，不把未知数据当作零客户端", () => {
  expect(signalDbm(4294967246)).toBe(-50);
  for (const value of [0, null, NaN, -200, "-50"]) expect(signalDbm(value)).toBeNull();
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
      if (object === "network.wireless")
        return {
          radio0: {
            up: true,
            config: { band: "2g", key: "never-copy-this" },
            interfaces: [
              { section: "ap0", ifname: "phy0-ap0", config: { mode: "ap", ssid: "test" } },
            ],
          },
          radio1: { up: false, disabled: true, interfaces: [{ ifname: "phy1-ap0" }] },
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
  expect(calls).toEqual(["network.wireless.status", "iwinfo.info", "iwinfo.assoclist"]);
});

test("读取无线不会吞掉会话失效，换会话后不会显示迟到的设备信息", async () => {
  const rpc = {
    call: async (_sid: string, object: string) => {
      if (object === "network.wireless")
        return { radio0: { up: true, interfaces: [{ ifname: "phy0-ap0" }] } };
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
