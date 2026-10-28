// 仅用于本地页面开发；配置和网络变化均为内存演示，不修改真实设备。
import { settingsFixture } from "./helpers/settings-fixture";
import { ledFixture } from "./helpers/led-fixture";
import { telemetryFixture, clientsFixture } from "./helpers/status-fixture";
import { validateLedPolicy, type LedPolicy } from "../frontend/src/lib/led-client";
import type { ConfigName, SettingsSnapshot } from "../frontend/src/lib/settings";
import { validateSchedulePolicy, type SchedulePolicy } from "../frontend/src/lib/schedule";

const device = process.env.PREVIEW_DEVICE === "jdcloud-ax1800" ? "jdcloud-ax1800" : "phicomm-n1";
const bypass = process.env.PREVIEW_ROLE === "bypass" && device === "phicomm-n1";
const ledSettings = ledFixture(device);
let schedulePolicy: SchedulePolicy = {
  enabled: false,
  time: "03:00",
  days: [0, 1, 2, 3, 4, 5, 6],
};
let timeSettings = {
  zone: "UTC",
  enabled: true,
  useDhcp: true,
  servers: ["0.openwrt.pool.ntp.org", "1.openwrt.pool.ntp.org"],
};
const initial = settingsFixture(bypass);
if (device === "jdcloud-ax1800") {
  initial.network.lan.ipaddr = "192.168.68.1";
  initial.wireless.default_radio0.ssid = "OpenWrt-demo-2.4G";
  initial.wireless.radio1 = { ...initial.wireless.radio0, band: "5g" };
  initial.wireless.default_radio1 = {
    ...initial.wireless.default_radio0,
    device: "radio1",
    ssid: "OpenWrt-demo-5G",
  };
}
if (device === "phicomm-n1") initial.wireless = {};
let committed = structuredClone(initial);
const sessions = new Set<string>();
const drafts = new Map<string, SettingsSnapshot>();
let transaction: {
  sid: string;
  original: SettingsSnapshot;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
const configs: ConfigName[] = ["network", "dhcp", "wireless", "firewall"];
function restore() {
  if (!transaction) return;
  clearTimeout(transaction.timer);
  committed = transaction.original;
  transaction = null;
}

interface RpcRequest {
  id: number;
  params: [string, string, string, Record<string, unknown>];
}
const rpc = {
  respond(body: RpcRequest) {
    const [sid, object, method, args = {}] = body.params;
    let result: unknown[] = [6];
    if (object === "session" && method === "login" && args.password === "preview-only") {
      const session = crypto.randomUUID().replaceAll("-", "");
      sessions.add(session);
      result = [0, { ubus_rpc_session: session }];
    } else if (sessions.has(sid)) {
      if (object === "router.status" && method === "summary") result = [0, telemetryFixture()];
      if (object === "router.diagnostics" && method === "run")
        result = [
          0,
          {
            ok: true,
            success: true,
            code: 0,
            output: "本地演示结果：未发起真实网络探测。",
            limited: false,
          },
        ];
      if (object === "router.status" && method === "clients")
        result = [0, bypass ? { ...clientsFixture(), ipv4: [], ipv6: [] } : clientsFixture()];
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
                : (args.object === "system" && ["board", "info"].includes(String(args.function))) ||
                  (args.object === "uci" &&
                    [
                      "get",
                      "add",
                      "changes",
                      "set",
                      "delete",
                      "revert",
                      "apply",
                      "confirm",
                      "rollback",
                    ].includes(String(args.function))),
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
                ...(bypass
                  ? {
                      route: [{ target: "0.0.0.0", mask: 0, nexthop: "192.168.68.1" }],
                      "dns-server": ["192.168.68.1"],
                    }
                  : {}),
                "ipv4-address": [{ address: committed.network.lan.ipaddr, mask: 24 }],
              },
              ...(!bypass
                ? [
                    {
                      interface: "wan",
                      up: true,
                      proto: String(committed.network.wan.proto),
                      device: String(committed.network.wan.device),
                      uptime: 3600,
                      route: [{ target: "0.0.0.0", mask: 0, nexthop: "10.0.2.2" }],
                      "dns-server": ["10.0.2.3"],
                      "ipv4-address": [
                        {
                          address:
                            committed.network.wan.proto === "static"
                              ? String(committed.network.wan.ipaddr)
                              : "10.0.2.15",
                          mask: 24,
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ];
      if (object === "router.status" && method === "wireless") {
        result = [
          0,
          {
            ok: true,
            radios:
              device === "phicomm-n1"
                ? {}
                : Object.fromEntries(
                    ["radio0", "radio1"].map((name, index) => [
                      name,
                      {
                        up: committed.wireless[name].disabled !== "1",
                        disabled: committed.wireless[name].disabled === "1",
                        pending: false,
                        config: { band: committed.wireless[name].band, channel: "auto" },
                        interfaces: [
                          {
                            section: `default_${name}`,
                            ifname: `phy${index}-ap0`,
                            config: {
                              ssid: committed.wireless[`default_${name}`].ssid,
                              mode: "ap",
                            },
                          },
                        ],
                      },
                    ]),
                  ),
          },
        ];
      }
      if (object === "iwinfo" && method === "info")
        result = [
          0,
          args.device === "phy1-ap0"
            ? { channel: 36, frequency: 5180 }
            : { channel: 6, frequency: 2437 },
        ];
      if (object === "iwinfo" && method === "assoclist") result = [0, { results: [] }];
      if (object === "iwinfo" && method === "phyname")
        result = [0, { phyname: args.section === "radio1" ? "phy1" : "phy0" }];
      if (object === "iwinfo" && method === "freqlist")
        result = [
          0,
          {
            results: (args.device === "phy1"
              ? [
                  [36, 5180],
                  [40, 5200],
                  [149, 5745],
                ]
              : [
                  [1, 2412],
                  [6, 2437],
                  [11, 2462],
                ]
            ).map(([channel, mhz]) => ({ channel, mhz, restricted: false })),
          },
        ];
      if (object === "iwinfo" && method === "countrylist")
        result = [
          0,
          {
            results: [
              { iso3166: "CN", country: "China" },
              { iso3166: "US", country: "United States" },
            ],
          },
        ];
      if (object === "iwinfo" && method === "info" && /^phy[01]$/.test(String(args.device)))
        result = [
          0,
          {
            htmodes:
              args.device === "phy1" ? ["HE20", "HE40", "HE80", "VHT80"] : ["HE20", "HE40", "HT20"],
          },
        ];
      if (object === "router.maintenance") {
        const configurationBusy = !!transaction || drafts.size > 0;
        if (method === "status")
          result = [
            0,
            {
              ok: true,
              configurationBusy,
              operationBusy: false,
              backupLimit: 131072,
              upgradeSupported: device === "jdcloud-ax1800",
              resetSupported: device === "jdcloud-ax1800",
            },
          ];
        // 演示模式不生成或操作真实系统归档，也不重启主机。
        if (method === "led_status") result = [0, { ok: true, ...ledSettings }];
        if (method === "schedule_status")
          result = [
            0,
            {
              ok: true,
              policy: schedulePolicy,
              localTime: new Date().toLocaleString("sv-SE", { timeZone: timeSettings.zone }),
              timezone: timeSettings.zone,
              next: schedulePolicy.enabled
                ? `下个所选日期 ${schedulePolicy.time}（本地演示）`
                : null,
              last: null,
              cronRunning: true,
            },
          ];
        if (method === "schedule_save") {
          if (configurationBusy) result = [0, { ok: false, error: "configuration_busy" }];
          else {
            try {
              validateSchedulePolicy(args as unknown as SchedulePolicy);
              schedulePolicy = structuredClone(args as unknown as SchedulePolicy);
              result = [0, { ok: true }];
            } catch {
              result = [0, { ok: false, error: "schedule_invalid" }];
            }
          }
        }
        if (method === "time_status")
          result = [
            0,
            {
              ok: true,
              settings: timeSettings,
              zones: ["UTC", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore"],
            },
          ];
        if (method === "time_save") {
          if (configurationBusy) result = [0, { ok: false, error: "configuration_busy" }];
          else {
            timeSettings = {
              zone: String(args.zone),
              enabled: args.enabled === true,
              useDhcp: args.useDhcp === true,
              servers: args.servers as string[],
            };
            result = [0, { ok: true }];
          }
        }
        if (method === "led_save") {
          if (configurationBusy) result = [0, { ok: false, error: "configuration_busy" }];
          else {
            try {
              const policy = JSON.parse(String(args.policy)) as LedPolicy;
              validateLedPolicy(policy, ledSettings.leds);
              ledSettings.policy = policy;
              ledSettings.current = policy.enabled
                ? { state: "normal", checkedAt: Math.floor(Date.now() / 1000) }
                : null;
              result = [0, { ok: true }];
            } catch {
              result = [0, { ok: false, error: "led_invalid" }];
            }
          }
        }
        if (
          ![
            "status",
            "led_status",
            "led_save",
            "time_status",
            "time_save",
            "schedule_status",
            "schedule_save",
          ].includes(method)
        )
          result = [
            0,
            { ok: false, error: configurationBusy ? "configuration_busy" : "preview_only" },
          ];
      }
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
        if (method === "add" && configs.includes(config) && !transaction) {
          const draft = drafts.get(sid) ?? structuredClone(committed),
            name = String(args.name);
          if (draft[config][name]) result = [2];
          else {
            draft[config][name] = {
              ".type": String(args.type),
              ...(args.values as Record<string, string>),
            };
            drafts.set(sid, draft);
            result = [0, { section: name }];
          }
        }
        if (["set", "delete"].includes(method) && configs.includes(config) && !transaction) {
          const draft = drafts.get(sid) ?? structuredClone(committed);
          const section = draft[config][String(args.section)];
          if (!section) result = [4];
          else {
            if (method === "set") Object.assign(section, args.values);
            else if (args.option !== undefined) delete section[String(args.option)];
            else delete draft[config][String(args.section)];
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
    return { jsonrpc: "2.0", id: body.id, result };
  },
};

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
    const body = (await request.json()) as RpcRequest | RpcRequest[];
    return Response.json(Array.isArray(body) ? body.map(rpc.respond) : rpc.respond(body));
  },
});
console.log(`本地演示接口，设备：${device}，演示密码：preview-only`);
