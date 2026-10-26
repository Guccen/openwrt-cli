export interface Device {
  device: "jdcloud-ax1800" | "phicomm-n1";
  model: string;
  role: "router" | "bypass";
  address: string;
  source: string;
  revision: string;
}

export interface Board {
  hostname: string;
  model?: string;
  system?: string;
  kernel: string;
  release: { distribution: string; version: string; revision: string; target: string };
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
  "ipv4-address"?: { address: string; mask: number }[];
  "ipv6-address"?: { address: string; mask: number }[];
}

export interface Snapshot {
  board: Board;
  info: SystemInfo;
  interfaces: NetworkInterface[];
  updatedAt: number;
}
