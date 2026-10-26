import { expect, test } from "bun:test";
import { wifiBand } from "../../frontend/src/lib/wifi-band";
import { wifiDrafts, wifiPlan } from "../../frontend/src/lib/settings";
import { settingsFixture } from "../helpers/settings-fixture";

test("频段来自设备配置或实际频率，不能按 radio 编号或信道猜测", () => {
  expect(wifiBand({ band: "2g" })).toBe("2g");
  expect(wifiBand({ band: "5g" })).toBe("5g");
  expect(wifiBand({ hwmode: "11g" })).toBe("2g");
  expect(wifiBand({ hwmode: "11a" })).toBe("5g");
  expect(wifiBand({}, 5180)).toBe("5g");
  expect(wifiBand({}, 5955)).toBe("6g");
  expect(wifiBand({ channel: "1", htmode: "HE80" })).toBe("unknown");
});

test("相同 SSID 的 2.4 GHz 和 5 GHz 仍可分别配置，不覆盖另一频段", () => {
  const snapshot = settingsFixture();
  snapshot.wireless.radio1 = { ...snapshot.wireless.radio0, band: "5g" };
  snapshot.wireless.default_radio1 = { ...snapshot.wireless.default_radio0, device: "radio1" };
  const [low, high] = wifiDrafts(snapshot);
  expect(low.band).toBe("2g");
  expect(high.band).toBe("5g");
  expect(low.ssid).toBe(high.ssid);
  const original = structuredClone(snapshot);
  for (const draft of [low, high]) {
    const plan = wifiPlan(snapshot, {
      ...draft,
      enabled: true,
      ssid: `${draft.band}-test`,
      password: "test-only-password",
    });
    expect(plan.edits.map((edit) => edit.section)).toEqual([draft.section, draft.device]);
  }
  expect(snapshot).toEqual(original);
});
