import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import axios from "axios";
import { RouterClient, RpcError } from "../../frontend/src/lib/rpc";
import {
  defaultRoutes,
  upstreamInterfaces,
  leaseRemaining,
  temperatureLabel,
} from "../../frontend/src/lib/status";
import { HealthCard } from "../../frontend/src/components/overview/health-card";
import { PortsCard } from "../../frontend/src/components/network/ports-card";
import { telemetryFixture } from "../helpers/status-fixture";

test("旁路由上游按默认路由识别，未连接 WAN 仍显示，负载不伪装 CPU 使用率", () => {
  const lan = {
    interface: "lan",
    up: true,
    proto: "static",
    route: [{ target: "0.0.0.0", mask: 0, nexthop: "192.168.68.1" }],
  };
  const wan = { interface: "wan", up: false, proto: "dhcp" };
  expect(upstreamInterfaces([lan, wan, { interface: "guest", up: true, proto: "static" }])).toEqual(
    [lan, wan],
  );
  expect(defaultRoutes(lan)).toHaveLength(1);
  expect(leaseRemaining(null)).toBe("永久");
  expect(leaseRemaining(1)).toBe("1 分钟");
});

test("缺失温度与计数显示未知，高存储占用有提示，设备名称转义", () => {
  const fixture = telemetryFixture();
  fixture.temperatures = [];
  fixture.storage[0]!.used = fixture.storage[0]!.total;
  fixture.ports[0]!.name = "<script>";
  fixture.ports[0]!.rx = null;
  expect(renderToStaticMarkup(<HealthCard telemetry={fixture} />)).toContain("温度暂不可用");
  expect(renderToStaticMarkup(<HealthCard telemetry={fixture} />)).toContain("空间使用已达");
  expect(renderToStaticMarkup(<HealthCard telemetry={fixture} />)).toContain("bg-rose-500");
  const ports = renderToStaticMarkup(<PortsCard ports={fixture.ports} />);
  expect(ports).toContain("接收 —");
  expect(ports).toContain("&lt;script&gt;");
});

test("传感器名称中文展示，未知硬件保留中性编号，存储按占用分级着色", () => {
  expect(temperatureLabel("cpu-thermal", 0)).toBe("处理器温度");
  expect(temperatureLabel("wifi_thermal", 0)).toBe("无线芯片温度");
  expect(temperatureLabel("tsens_tz_sensor3", 3)).toBe("温度传感器 4");
  expect(temperatureLabel("主板温度", 0)).toBe("主板温度");
  const fixture = telemetryFixture();
  fixture.temperatures[0]!.name = "cpu-thermal";
  let html = renderToStaticMarkup(<HealthCard telemetry={fixture} />);
  expect(html).toContain("处理器温度");
  expect(html).not.toContain("cpu-thermal");
  expect(html).toContain("bg-blue-500");
  expect(html).toContain('aria-valuenow="25"');
  fixture.storage[0]!.used = fixture.storage[0]!.total * 0.8;
  html = renderToStaticMarkup(<HealthCard telemetry={fixture} />);
  expect(html).toContain("bg-amber-500");
});

test("扩展状态读取失败保留基本概览，会话过期仍触发重新登录", async () => {
  let expired = false;
  const api = new RouterClient(
    axios.create({
      adapter: async (config) => {
        const [, object] = JSON.parse(config.data).params;
        const value = object === "system" ? { release: {}, memory: {} } : { interface: [] };
        return {
          config,
          status: 200,
          statusText: "OK",
          headers: {},
          data: { result: object === "router.status" ? [expired ? 6 : 4] : [0, value] },
        };
      },
    }),
  );
  const snapshot = await api.snapshot("sid");
  expect(snapshot.telemetry).toBeNull();
  expect(snapshot.telemetryError).toContain("暂不可用");
  expired = true;
  await expect(api.snapshot("sid")).rejects.toBeInstanceOf(RpcError);
});
