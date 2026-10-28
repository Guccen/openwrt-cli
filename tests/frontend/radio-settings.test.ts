import { expect, test } from "bun:test";
import {
  RadioClient,
  defaultRadioMode,
  radioDraft,
  radioModes,
  radioPlan,
  recommendedRadioMode,
  type RadioCapabilities,
} from "../../frontend/src/lib/radio-settings";
import { RpcError, type RouterClient } from "../../frontend/src/lib/rpc";
import { settingsFixture } from "../helpers/settings-fixture";

// 保留实机接口中的总体模式与逐信道限制，复现芯片支持但信道禁止八十兆赫的组合。
const n1Capabilities: RadioCapabilities = {
  bands: ["2g", "5g"],
  modes: ["HT20", "HT40", "VHT20", "VHT40", "VHT80"],
  channels: [
    { channel: 6, mhz: 2437, dfs: false, flags: ["no_80mhz", "no_160mhz"] },
    {
      channel: 149,
      mhz: 5745,
      dfs: false,
      flags: ["no_ht40-", "no_80mhz", "no_160mhz"],
    },
    {
      channel: 153,
      mhz: 5765,
      dfs: false,
      flags: ["no_ht40+", "no_80mhz", "no_160mhz"],
    },
    {
      channel: 165,
      mhz: 5825,
      dfs: false,
      flags: ["no_ht40+", "no_ht40-", "no_80mhz", "no_160mhz"],
    },
  ],
  countries: [{ code: "CN", name: "中国" }],
};

test("射频读取保留逐信道限制，不把芯片总体模式当成信道带宽能力", async () => {
  const rpc = {
    call: async (_session: string, _object: string, method: string) => {
      if (method === "phyname") return { phyname: "phy0" };
      if (method === "info") return { htmodes: n1Capabilities.modes };
      if (method === "countrylist") return { results: [{ iso3166: "CN", country: "中国" }] };
      return {
        results: n1Capabilities.channels.map((channel) => ({ ...channel, restricted: false })),
      };
    },
  } as unknown as RouterClient;
  const caps = await new RadioClient(rpc).read("sid", "radio0");
  expect(caps.modes).toContain("VHT80");
  expect(caps.channels.find((channel) => channel.channel === 149)?.flags).toContain("no_80mhz");
  expect(radioModes(caps, "5g", "149")).toEqual(["HT20", "HT40", "VHT20", "VHT40"]);
  expect(radioModes(caps, "5g", "auto")).not.toContain("VHT80");
});

test("京东云预设保持二点四吉赫兹窄带，五吉赫兹按信道限制选择速度或稳定模式", () => {
  const caps = {
    ...n1Capabilities,
    modes: [...n1Capabilities.modes, "HE20", "HE40", "HE80", "HE160"],
  };
  expect(recommendedRadioMode(caps, "2g", "6", "speed")).toBe("HE20");
  expect(recommendedRadioMode(caps, "5g", "149", "speed")).toBe("HE40");
  expect(recommendedRadioMode(caps, "5g", "165", "stable")).toBe("HE20");
  expect(recommendedRadioMode(caps, "5g", "36", "speed")).toBe("");
  const wide = { ...caps, channels: [{ channel: 36, mhz: 5180, dfs: false }] };
  expect(recommendedRadioMode(wide, "5g", "36", "speed")).toBe("HE80");
  expect(recommendedRadioMode(wide, "5g", "36", "stable")).toBe("HE40");
});

test("功率只使用驱动列表，恢复自动删除限制，切换地区或信道不复用旧列表", () => {
  const snapshot = settingsFixture();
  Object.assign(snapshot.wireless.radio0, {
    country: "CN",
    channel: "6",
    htmode: "HT20",
    txpower: "20",
  });
  const draft = radioDraft(snapshot, "radio0");
  const caps = { ...n1Capabilities, powerLevels: [10, 20, 23] };
  expect(radioPlan(snapshot, "radio0", { ...draft, txpower: "auto" }, caps).edits).toEqual([
    { config: "wireless", section: "radio0", values: {}, remove: ["txpower"] },
  ]);
  expect(radioPlan(snapshot, "radio0", { ...draft, txpower: "23" }, caps).edits[0].values).toEqual({
    txpower: "23",
  });
  expect(() => radioPlan(snapshot, "radio0", { ...draft, txpower: "30" }, caps)).toThrow(
    "驱动提供",
  );
  expect(() => radioPlan(snapshot, "radio0", { ...draft, txpower: "023" }, caps)).toThrow(
    "驱动提供",
  );
  expect(() =>
    radioPlan(snapshot, "radio0", { ...draft, channel: "auto", txpower: "23" }, caps),
  ).toThrow("先应用");
  const changedRegion = { ...caps, countries: [...caps.countries, { code: "US", name: "美国" }] };
  expect(() =>
    radioPlan(
      snapshot,
      "radio0",
      { ...draft, country: "US", channel: "auto", txpower: "23" },
      changedRegion,
    ),
  ).toThrow("先应用");
  expect(
    radioPlan(snapshot, "radio0", { ...draft, txpower: "auto" }, { ...caps, powerLevels: null })
      .edits[0].remove,
  ).toEqual(["txpower"]);
  expect(radioPlan(snapshot, "radio0", draft, { ...caps, powerLevels: null }).edits).toEqual([]);
  delete snapshot.wireless.radio0.txpower;
  expect(radioPlan(snapshot, "radio0", radioDraft(snapshot, "radio0"), caps).edits).toEqual([]);
});

test("功率列表按需读取和过滤，缺失不阻塞射频设置，会话失效仍向上传递", async () => {
  let powerCalls = 0;
  let powerError: Error | null = null;
  const rpc = {
    call: async (_session: string, _object: string, method: string) => {
      if (method === "phyname") return { phyname: "phy0" };
      if (method === "info") return { htmodes: ["HE20"] };
      if (method === "countrylist") return { results: [{ iso3166: "CN", country: "中国" }] };
      if (method === "txpowerlist") {
        powerCalls++;
        if (powerError) throw powerError;
        return { results: [20, 23, 20, -1, 99, 2.5, "30"].map((dbm) => ({ dbm })) };
      }
      return { results: [{ channel: 1, mhz: 2412, restricted: false }] };
    },
  } as unknown as RouterClient;
  const client = new RadioClient(rpc);
  await client.read("sid", "radio0");
  expect(powerCalls).toBe(0);
  expect((await client.read("sid", "radio0", undefined, true)).powerLevels).toEqual([20, 23]);
  powerError = new RpcError("不可用", 4);
  const fallback = await client.read("sid", "radio0", undefined, true);
  expect(fallback.powerLevels).toBeNull();
  expect(fallback.modes).toEqual(["HE20"]);
  powerError = new RpcError("登录失效", 6);
  await expect(client.read("sid", "radio0", undefined, true)).rejects.toThrow("登录失效");
});

test("切换五吉赫兹频段先选择二十兆赫模式，不自动选用被禁用的宽信道", () => {
  expect(defaultRadioMode(n1Capabilities, "5g", "149")).toBe("VHT20");
  expect(defaultRadioMode(n1Capabilities, "2g", "6")).toBe("HT20");
  expect(defaultRadioMode(n1Capabilities, "5g", "36")).toBe("");
  expect(radioModes(n1Capabilities, "5g", "165")).toEqual(["HT20", "VHT20"]);
});

test("实机信道禁止八十兆赫时拦截切换，旧错误配置可以改为较窄带宽", () => {
  const snapshot = settingsFixture();
  Object.assign(snapshot.wireless.radio0, { country: "CN", channel: "6", htmode: "HT20" });
  const draft = { ...radioDraft(snapshot, "radio0"), band: "5g" as const, channel: "149" };
  expect(() => radioPlan(snapshot, "radio0", { ...draft, mode: "VHT80" }, n1Capabilities)).toThrow(
    "带宽",
  );
  expect(
    radioPlan(snapshot, "radio0", { ...draft, mode: "VHT20" }, n1Capabilities).edits[0],
  ).toEqual({
    config: "wireless",
    section: "radio0",
    values: { band: "5g", channel: "149", htmode: "VHT20" },
  });
  Object.assign(snapshot.wireless.radio0, { band: "5g", channel: "149", htmode: "VHT80" });
  expect(
    radioPlan(snapshot, "radio0", { ...draft, mode: "VHT20" }, n1Capabilities).edits[0].values,
  ).toEqual({
    htmode: "VHT20",
  });
});

test("仅改信道也重新检查带宽限制，其他射频仍可使用其驱动允许的八十兆赫", () => {
  const snapshot = settingsFixture();
  Object.assign(snapshot.wireless.radio0, { band: "5g", channel: "149", htmode: "VHT40" });
  const draft = { ...radioDraft(snapshot, "radio0"), channel: "165" };
  expect(() => radioPlan(snapshot, "radio0", draft, n1Capabilities)).toThrow("带宽");
  const unrestricted = {
    ...n1Capabilities,
    channels: [{ channel: 36, mhz: 5180, dfs: false, flags: [] }],
  };
  expect(radioModes(unrestricted, "5g", "36")).toContain("VHT80");
  expect(
    radioPlan(snapshot, "radio0", { ...draft, channel: "36", mode: "VHT80" }, unrestricted).edits[0]
      .values,
  ).toEqual({
    channel: "36",
    htmode: "VHT80",
  });
});
