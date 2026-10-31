export interface Device {
  device: "jdcloud-ax1800" | "phicomm-n1";
  model: string;
  role: "router" | "bypass";
  address: string;
  source: string;
  revision: string;
  wan?: string;
  builtAt?: number;
}

export interface Board {
  hostname: string;
  model?: string;
  system?: string;
  kernel: string;
  release: {
    distribution: string;
    version: string;
    revision: string;
    target: string;
    description?: string;
  };
}

export interface SystemInfo {
  uptime: number;
  load: number[];
  memory: { total: number; free: number; available?: number; buffered?: number; cached?: number };
}

export interface NetworkInterface {
  interface: string;
  up: boolean;
  proto: string;
  l3_device?: string;
  device?: string;
  uptime?: number;
  route?: { target: string; mask: number; nexthop?: string }[];
  "dns-server"?: string[];
  "ipv6-prefix"?: { address: string; mask: number }[];
  "ipv6-prefix-assignment"?: {
    address: string;
    mask: number;
    "local-address"?: { address: string; mask: number };
  }[];
  "ipv4-address"?: { address: string; mask: number }[];
  "ipv6-address"?: { address: string; mask: number }[];
}

export interface Snapshot {
  board: Board;
  info: SystemInfo;
  interfaces: NetworkInterface[];
  updatedAt: number;
  telemetry?: Telemetry | null;
  telemetryError?: string | null;
}

export interface Telemetry {
  ok: true;
  localTime: string;
  temperatures: { name: string; celsius: number }[];
  storage: {
    name: string;
    path: string;
    source?: string;
    total: number;
    used: number;
    available: number;
  }[];
  blockDisks?: {
    device: string;
    total: number;
    system: boolean;
    partitioned: number | null;
    unallocated: number | null;
  }[];
  ports: {
    name: string;
    link: boolean | null;
    speed: number | null;
    duplex: string | null;
    mac: string | null;
    rx: number | null;
    tx: number | null;
  }[];
}

export interface ClientLeases {
  ok: true;
  ipv4Available: boolean;
  ipv6Available: boolean;
  limited: boolean;
  limit: number;
  ipv4: { hostname: string | null; mac: string; address: string; remaining: number | null }[];
  ipv6: {
    hostname: string | null;
    device: string;
    duid: string;
    addresses: string[];
    remaining: number | null;
  }[];
  updatedAt: number;
}
