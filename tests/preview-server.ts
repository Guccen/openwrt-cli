// 仅用于本地页面验收，所有数据均为演示数据，不代表真实设备。
const sid = "a".repeat(32);
let active = false;
const json = (value: unknown) => Response.json(value);

Bun.serve({
  hostname: "127.0.0.1",
  port: 4174,
  async fetch(request) {
    if (new URL(request.url).pathname === "/device.json") {
      return json({
        device: "phicomm-n1",
        model: "斐讯 N1（本地演示）",
        role: "router",
        address: "192.168.69.1",
        source: "演示",
        revision: "preview",
      });
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const body = (await request.json()) as {
      id: number;
      params: [string, string, string, { password?: string }];
    };
    const [session, object, method, args] = body.params;
    let result: unknown[] = [6];
    if (object === "session" && method === "login") {
      active = args.password === "preview-only";
      result = active ? [0, { ubus_rpc_session: sid }] : [6];
    } else if (session === sid && active) {
      if (object === "session" && method === "destroy") {
        active = false;
        result = [0];
      }
      if (object === "system" && method === "board")
        result = [
          0,
          {
            hostname: "n1-preview",
            model: "斐讯 N1（本地演示）",
            kernel: "6.12.114",
            release: {
              distribution: "ImmortalWrt",
              version: "25.12.2",
              revision: "preview",
              target: "armsr/armv8",
            },
          },
        ];
      if (object === "system" && method === "info")
        result = [
          0,
          {
            uptime: 86760,
            load: [6554, 3277, 1966],
            memory: { total: 2147483648, available: 1800000000, free: 1400000000 },
          },
        ];
      if (object === "network.interface" && method === "dump")
        result = [
          0,
          {
            interface: [
              {
                interface: "lan",
                up: true,
                proto: "static",
                device: "br-lan",
                "ipv4-address": [{ address: "192.168.69.1", mask: 24 }],
              },
              {
                interface: "wan",
                up: true,
                proto: "dhcp",
                device: "eth1",
                "ipv4-address": [{ address: "192.168.68.100", mask: 24 }],
              },
            ],
          },
        ];
    }
    return json({ jsonrpc: "2.0", id: body.id, result });
  },
});
console.log("本地演示接口：http://127.0.0.1:4174，演示密码：preview-only");
