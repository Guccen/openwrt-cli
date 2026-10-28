import type { ClientLeases, Telemetry } from "../../frontend/src/lib/types";

export function telemetryFixture(): Telemetry {
  return {
    ok: true,
    localTime: "2026-10-27 11:00:00",
    temperatures: [{ name: "CPU", celsius: 58.5 }],
    storage: [
      {
        name: "可写存储",
        path: "/",
        total: 64 * 1024 * 1024,
        used: 16 * 1024 * 1024,
        available: 48 * 1024 * 1024,
      },
      {
        name: "临时空间",
        path: "/tmp",
        total: 256 * 1024 * 1024,
        used: 1024 * 1024,
        available: 255 * 1024 * 1024,
      },
    ],
    ports: [
      {
        name: "eth0",
        link: true,
        speed: 1000,
        duplex: "full",
        mac: "02:00:00:00:00:01",
        rx: 120 * 1024 * 1024,
        tx: 40 * 1024 * 1024,
      },
      {
        name: "eth1",
        link: false,
        speed: null,
        duplex: null,
        mac: "02:00:00:00:00:02",
        rx: 0,
        tx: 0,
      },
    ],
  };
}

export function clientsFixture(): ClientLeases {
  return {
    ok: true,
    ipv4Available: true,
    ipv6Available: true,
    limited: false,
    limit: 512,
    ipv4: [
      {
        hostname: "我的电脑",
        mac: "02:00:00:00:01:01",
        address: "192.168.68.101",
        remaining: 7200,
      },
      { hostname: null, mac: "02:00:00:00:01:02", address: "192.168.68.102", remaining: null },
    ],
    ipv6: [
      {
        hostname: "我的电脑",
        device: "br-lan",
        duid: "000400000000000000000000000000000001",
        addresses: ["fd00::101/128"],
        remaining: 3600,
      },
    ],
    updatedAt: Date.now(),
  };
}
