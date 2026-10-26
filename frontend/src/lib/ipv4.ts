export function ipv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || +part > 255))
    return null;
  return parts.reduce((total, part) => (total * 256 + +part) >>> 0, 0);
}
export function maskPrefix(value: string): number | null {
  const mask = ipv4(value);
  if (mask === null) return null;
  const bits = mask.toString(2).padStart(32, "0");
  return /^1+0*$/.test(bits) ? (bits.indexOf("0") === -1 ? 32 : bits.indexOf("0")) : null;
}
export function ipv4Text(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("IPv4 地址超出范围");
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}
export function subnet(address: string, netmask: string) {
  const ip = ipv4(address),
    mask = ipv4(netmask),
    prefix = maskPrefix(netmask);
  if (
    ip === null ||
    mask === null ||
    prefix === null ||
    prefix < 1 ||
    prefix > 30 ||
    ip >>> 24 === 0 ||
    ip >>> 24 === 127 ||
    ip >>> 24 >= 224
  )
    throw new Error("请输入有效的 IPv4 地址和 /1 至 /30 的连续子网掩码");
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  if (ip === network || ip === broadcast) throw new Error("地址不能是网络地址或广播地址");
  return { ip, mask, prefix, network, broadcast };
}
export function poolRange(address: string, netmask: string, start: number, count: number) {
  const lan = subnet(address, netmask);
  const end = start + count - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    start < 1 ||
    count < 1 ||
    count > 4096 ||
    end >= lan.broadcast - lan.network
  )
    throw new Error("DHCP 地址池需在 LAN 可用网段内，且包含 1 至 4096 个地址");
  if (lan.ip >= lan.network + start && lan.ip <= lan.network + end)
    throw new Error("DHCP 地址池不能包含路由器的 LAN 地址");
  return { start: ipv4Text(lan.network + start), end: ipv4Text(lan.network + end), count };
}
