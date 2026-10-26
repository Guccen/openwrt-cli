// 仅用于本地页面开发；配置和网络变化均为内存演示，不修改真实设备。
import { settingsFixture } from "./helpers/settings-fixture";
import type { ConfigName, SettingsSnapshot } from "../frontend/src/lib/settings";

const device = process.env.PREVIEW_DEVICE === "jdcloud-ax1800" ? "jdcloud-ax1800" : "phicomm-n1";
const bypass = process.env.PREVIEW_ROLE === "bypass" && device === "phicomm-n1";
const initial = settingsFixture(bypass);
if (device === "jdcloud-ax1800") initial.network.lan.ipaddr = "192.168.68.1";
if (device === "phicomm-n1") initial.wireless = {};
let committed = structuredClone(initial);
const sessions = new Set<string>();
const drafts = new Map<string, SettingsSnapshot>();
let transaction: {
  sid: string;
  original: SettingsSnapshot;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
const configs: ConfigName[] = ["network", "dhcp", "wireless"];
function restore() {
  if (!transaction) return;
  clearTimeout(transaction.timer);
  committed = transaction.original;
  transaction = null;
}

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PREVIEW_PORT ?? 4174),
  async fetch(request) {
    if (new URL(request.url).pathname === "/device.json")
      return Response.json({
        device,
        model: `${device === "phicomm-n1" ? "斐讯 N1" : "京东云 AX1800"}（本地演示）`,
        role: bypass ? "bypass" : "router",
        address: initial.network.lan.ipaddr,
        source: "演示",
        revision: "preview",
      });
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const body = (await request.json()) as {
      id: number;
      params: [string, string, string, Record<string, unknown>];
    };
    const [sid, object, method, args = {}] = body.params;
    let result: unknown[] = [6];
    if (object === "session" && method === "login" && args.password === "preview-only") {
      const session = crypto.randomUUID().replaceAll("-", "");
      sessions.add(session);
      result = [0, { ubus_rpc_session: session }];
    } else if (sessions.has(sid)) {
      if (object === "session" && method === "destroy") {
        sessions.delete(sid);
        drafts.delete(sid);
        result = [0];
      }
      if (object === "session" && method === "access")
        result = [
          0,
          {
            access:
              args.scope === "uci"
                ? configs.includes(args.object as ConfigName)
                : args.object === "uci" &&
                  [
                    "get",
                    "changes",
                    "set",
                    "delete",
                    "revert",
                    "apply",
                    "confirm",
                    "rollback",
                  ].includes(String(args.function)),
          },
        ];
      if (object === "system" && method === "board")
        result = [
          0,
          {
            hostname: `${device}-preview`,
            model: "本地演示设备",
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
                "ipv4-address": [{ address: committed.network.lan.ipaddr, mask: 24 }],
              },
              ...(!bypass
                ? [
                    {
                      interface: "wan",
                      up: true,
                      proto: "dhcp",
                      device: "eth1",
                      "ipv4-address": [{ address: "10.0.2.15", mask: 24 }],
                    },
                  ]
                : []),
            ],
          },
        ];
      if (object === "uci") {
        const config = args.config as ConfigName;
        const snapshot = drafts.get(sid) ?? committed;
        if (method === "get" && configs.includes(config))
          result =
            config === "wireless" && device === "phicomm-n1"
              ? [4]
              : [0, { values: snapshot[config] }];
        if (method === "changes")
          result = [
            0,
            {
              changes: Object.fromEntries(
                configs
                  .filter(
                    (name) => JSON.stringify(snapshot[name]) !== JSON.stringify(committed[name]),
                  )
                  .map((name) => [name, [["set", "preview"]]]),
              ),
            },
          ];
        if (["set", "delete"].includes(method) && configs.includes(config) && !transaction) {
          const draft = drafts.get(sid) ?? structuredClone(committed);
          const section = draft[config][String(args.section)];
          if (!section) result = [4];
          else {
            if (method === "set") Object.assign(section, args.values);
            else delete section[String(args.option)];
            drafts.set(sid, draft);
            result = [0];
          }
        }
        if (method === "revert" && configs.includes(config) && !transaction) {
          const draft = drafts.get(sid);
          if (draft) draft[config] = structuredClone(committed[config]);
          result = [0];
        }
        if (method === "apply" && !transaction && drafts.has(sid) && args.rollback === true) {
          const original = structuredClone(committed);
          committed = structuredClone(drafts.get(sid)!);
          drafts.delete(sid);
          transaction = {
            sid,
            original,
            timer: setTimeout(
              restore,
              Math.max(1, Math.min(Number(args.timeout) || 120, 120)) * 1000,
            ),
          };
          result = [0];
        }
        if (method === "confirm") {
          if (transaction?.sid === sid) {
            clearTimeout(transaction.timer);
            transaction = null;
            result = [0];
          } else result = [transaction ? 6 : 10];
        }
        if (method === "rollback") {
          if (transaction?.sid === sid) {
            restore();
            result = [0];
          } else result = [transaction ? 6 : 10];
        }
      }
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  },
});
console.log(`本地演示接口，设备：${device}，演示密码：preview-only`);
