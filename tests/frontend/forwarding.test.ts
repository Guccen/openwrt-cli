import { describe, expect, test } from "bun:test";
import {
  forwardingPlan,
  dmzDraft,
  dmzPlan,
  ipv6RulePlan,
  ipv6RuleRows,
  securityDraft,
  securityPlan,
  type Forwarding,
  type Ipv6Rule,
} from "../../frontend/src/lib/forwarding";
import { settingsFixture } from "../helpers/settings-fixture";

describe("DMZ 主机设置", () => {
  test("DMZ 初始读取、目标校验与创建清理", () => {
    const s = settingsFixture();
    expect(dmzDraft(s)).toEqual({ enabled: false, address: "" });

    // 无改动返回空操作
    expect(dmzPlan(s, { enabled: false, address: "" }).edits).toHaveLength(0);

    // 拒绝路由器自身 IP 与非 LAN 网段 IP
    expect(() => dmzPlan(s, { enabled: true, address: "192.168.69.1" })).toThrow("路由器地址");
    expect(() => dmzPlan(s, { enabled: true, address: "10.0.0.5" })).toThrow("网段内");

    // 启用 DMZ
    const plan = dmzPlan(s, { enabled: true, address: "192.168.69.50" });
    expect(plan.edits).toContainEqual(
      expect.objectContaining({
        config: "firewall",
        section: "router_ui_dmz",
        add: "redirect",
        values: expect.objectContaining({
          name: "DMZ",
          src: "wan",
          dest: "lan",
          target: "DNAT",
          proto: "all",
          dest_ip: "192.168.69.50",
          enabled: "1",
        }),
      }),
    );

    // 应用后读取
    s.firewall.router_ui_dmz = {
      ".type": "redirect",
      name: "DMZ",
      src: "wan",
      dest: "lan",
      target: "DNAT",
      proto: "all",
      dest_ip: "192.168.69.50",
      enabled: "1",
    };
    expect(dmzDraft(s)).toEqual({ enabled: true, address: "192.168.69.50" });

    // 关闭 DMZ
    const disablePlan = dmzPlan(s, { enabled: false, address: "" });
    expect(disablePlan.edits).toContainEqual({
      config: "firewall",
      section: "router_ui_dmz",
      deleteSection: true,
    });
  });
});

describe("IPv6 端口放行规则", () => {
  test("IPv6 放行新增、地址可选性、校验与删除", () => {
    const s = settingsFixture();
    expect(ipv6RuleRows(s)).toHaveLength(0);

    const rule: Ipv6Rule = {
      section: "",
      name: "NAS-Web",
      protocol: "tcp",
      address: "240e:399:e67:afa0::100",
      port: "5000",
      enabled: true,
      editable: true,
    };

    // 校验端口与地址
    expect(() => ipv6RulePlan(s, { ...rule, port: "70000" })).toThrow("端口");
    expect(() => ipv6RulePlan(s, { ...rule, address: "invalid-ipv6" })).toThrow("单播地址");
    expect(() => ipv6RulePlan(s, { ...rule, name: "" })).toThrow("名称");

    // 新增特定目标 IPv6
    const plan = ipv6RulePlan(s, rule);
    expect(plan.edits).toContainEqual(
      expect.objectContaining({
        config: "firewall",
        add: "rule",
        values: expect.objectContaining({
          name: "NAS-Web",
          src: "wan",
          dest: "lan",
          family: "ipv6",
          target: "ACCEPT",
          proto: "tcp",
          dest_port: "5000",
          dest_ip: "240e:399:e67:afa0::100",
          enabled: "1",
        }),
      }),
    );

    // 新增任意内网设备的 IPv6 放行（地址留空）
    const wildcardPlan = ipv6RulePlan(s, { ...rule, address: "" });
    expect(wildcardPlan.edits[0].values).not.toHaveProperty("dest_ip");

    // 模拟写入并读取
    const section = plan.edits[0].section;
    s.firewall[section] = {
      ".type": "rule",
      ...plan.edits[0].values,
    };
    const rows = ipv6RuleRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "NAS-Web",
      port: "5000",
      address: "240e:399:e67:afa0::100",
      enabled: true,
      editable: true,
    });

    // 删除规则
    const deletePlan = ipv6RulePlan(s, { ...rows[0] }, true);
    expect(deletePlan.edits).toContainEqual({
      config: "firewall",
      section,
      deleteSection: true,
    });
  });
});

describe("安全与远程访问", () => {
  test("WAN Ping 开关与外网访问管理页面（DNAT 与端口冲突）", () => {
    const s = settingsFixture();
    s.firewall["Allow-Ping"] = {
      ".type": "rule",
      name: "Allow-Ping",
      src: "wan",
      proto: "icmp",
      icmp_type: "echo-request",
      family: "ipv4",
      target: "ACCEPT",
      enabled: "1",
    };

    const draft = securityDraft(s);
    expect(draft.wanPing).toBe(true);
    expect(draft.remoteWebEnabled).toBe(false);

    // 关闭 WAN Ping
    const pingPlan = securityPlan(s, { ...draft, wanPing: false });
    expect(pingPlan.edits).toContainEqual({
      config: "firewall",
      section: "Allow-Ping",
      values: { enabled: "0" },
    });

    // 启用外网 Web 访问
    const remotePlan = securityPlan(s, {
      ...draft,
      remoteWebEnabled: true,
      remoteWebPort: "8443",
    });
    expect(remotePlan.edits).toContainEqual(
      expect.objectContaining({
        config: "firewall",
        section: "router_ui_remote_web",
        add: "redirect",
        values: expect.objectContaining({
          name: "Router-Remote-Web",
          src: "wan",
          dest: "lan",
          dest_ip: "192.168.69.1",
          src_dport: "8443",
          dest_port: "443",
          proto: "tcp",
          target: "DNAT",
          enabled: "1",
        }),
      }),
    );

    // 模拟写入远程 Web 规则
    s.firewall.router_ui_remote_web = {
      ".type": "redirect",
      name: "Router-Remote-Web",
      src: "wan",
      dest: "lan",
      dest_ip: "192.168.69.1",
      src_dport: "8443",
      dest_port: "443",
      proto: "tcp",
      target: "DNAT",
      enabled: "1",
    };

    // 端口转发不能与远程管理端口冲突
    const forwardConflict: Forwarding = {
      section: "",
      name: "Conflict",
      protocol: "tcp",
      external: "8443",
      address: "192.168.69.20",
      internal: "80",
      enabled: true,
      editable: true,
    };
    expect(() => forwardingPlan(s, forwardConflict)).toThrow("冲突");

    // 反向冲突检查：启用远程访问时，如果端口已被端口转发占用
    s.firewall.fwd1 = {
      ".type": "redirect",
      src: "wan",
      src_dport: "9443",
      dest_ip: "192.168.69.20",
      enabled: "1",
    };
    expect(() =>
      securityPlan(s, { ...draft, remoteWebEnabled: true, remoteWebPort: "9443" }),
    ).toThrow("冲突");

    // 禁用远程 Web 访问
    const disableRemote = securityPlan(s, { ...draft, remoteWebEnabled: false });
    expect(disableRemote.edits).toContainEqual({
      config: "firewall",
      section: "router_ui_remote_web",
      deleteSection: true,
    });
  });
});

test("保存已有远程管理规则会迁移到 HTTPS，重复保存保持无改动", () => {
  const snapshot = settingsFixture();
  snapshot.firewall.router_ui_remote_web = {
    ".type": "redirect",
    name: "Router-Remote-Web",
    src: "wan",
    dest: "lan",
    dest_ip: "192.168.69.1",
    src_dport: "8443",
    dest_port: "80",
    proto: "tcp",
    target: "DNAT",
    enabled: "1",
  };
  const draft = securityDraft(snapshot);
  const plan = securityPlan(snapshot, draft);
  expect(plan.edits).toContainEqual(
    expect.objectContaining({
      section: "router_ui_remote_web",
      values: expect.objectContaining({ dest_port: "443" }),
    }),
  );
  snapshot.firewall.router_ui_remote_web.dest_port = "443";
  expect(securityPlan(snapshot, draft).edits).toHaveLength(0);
});

test("按真实节名关闭旧 DMZ 和远程管理，不残留或创建第二条规则", () => {
  const snapshot = settingsFixture();
  snapshot.firewall.legacy_dmz = {
    ".type": "redirect",
    name: "DMZ",
    src: "wan",
    dest: "lan",
    proto: "all",
    dest_ip: "192.168.69.50",
  };
  expect(dmzDraft(snapshot).enabled).toBe(true);
  expect(dmzPlan(snapshot, { enabled: false, address: "192.168.69.50" }).edits).toEqual([
    { config: "firewall", section: "legacy_dmz", deleteSection: true },
  ]);
  snapshot.firewall.legacy_web = {
    ".type": "redirect",
    name: "Router-Remote-Web",
    src: "wan",
    dest: "lan",
    src_dport: "8443",
    dest_port: "80",
    dest_ip: "192.168.69.1",
    proto: "tcp",
  };
  const draft = securityDraft(snapshot);
  expect(securityPlan(snapshot, { ...draft, remoteWebEnabled: false }).edits).toContainEqual({
    config: "firewall",
    section: "legacy_web",
    deleteSection: true,
  });
  const migrate = securityPlan(snapshot, draft);
  expect(migrate.edits).toContainEqual(
    expect.objectContaining({
      section: "legacy_web",
      values: expect.objectContaining({ dest_port: "443" }),
    }),
  );
  expect(migrate.edits.some((edit) => edit.section === "router_ui_remote_web")).toBe(false);
});

test("DMZ 已开启时新增端口转发会把兜底规则移到最后并保留参数", () => {
  const snapshot = settingsFixture();
  snapshot.firewall.legacy_dmz = {
    ".type": "redirect",
    ".anonymous": true,
    name: "DMZ",
    src: "wan",
    dest: "lan",
    proto: "all",
    dest_ip: "192.168.69.50",
    reflection: "0",
  };
  const plan = forwardingPlan(snapshot, {
    section: "",
    name: "NAS",
    protocol: "tcp",
    external: "8080",
    internal: "80",
    address: "192.168.69.20",
    enabled: true,
    editable: true,
  });
  expect(plan.edits[0]).toMatchObject({ add: "redirect", values: { src_dport: "8080" } });
  expect(plan.edits.slice(-2)).toEqual([
    { config: "firewall", section: "legacy_dmz", deleteSection: true },
    {
      config: "firewall",
      section: "legacy_dmz",
      add: "redirect",
      values: {
        name: "DMZ",
        src: "wan",
        dest: "lan",
        proto: "all",
        dest_ip: "192.168.69.50",
        reflection: "0",
      },
    },
  ]);
  const web = securityPlan(snapshot, { ...securityDraft(snapshot), remoteWebEnabled: true });
  expect(web.edits.at(-1)?.section).toBe("legacy_dmz");
});

test("拒绝覆盖同名的非转发配置及重复的 DMZ 配置", () => {
  const snapshot = settingsFixture();
  snapshot.firewall.router_ui_dmz = { ".type": "rule", name: "unrelated" };
  expect(() => dmzDraft(snapshot)).toThrow("高级配置");
  snapshot.firewall.router_ui_dmz = { ".type": "redirect", name: "DMZ", src: "wan", dest: "lan" };
  snapshot.firewall.duplicate = { ...snapshot.firewall.router_ui_dmz };
  expect(() => dmzPlan(snapshot, { enabled: false, address: "" })).toThrow("多条");
});

test("远程管理和转发统一检查协议、区间、列表及禁用规则", () => {
  const snapshot = settingsFixture();
  const draft = { ...securityDraft(snapshot), remoteWebEnabled: true, remoteWebPort: "8443" };
  const forward: Forwarding = {
    section: "",
    name: "NAS",
    protocol: "tcp",
    external: "8443",
    internal: "443",
    address: "192.168.69.20",
    enabled: true,
    editable: true,
  };
  for (const src_dport of ["8000-9000", "8000:9000", "443 8443", ["443", "8400-8500"]]) {
    snapshot.firewall.other = { ".type": "redirect", src: "wan", proto: "tcp", src_dport };
    expect(() => securityPlan(snapshot, draft)).toThrow("冲突");
    expect(() => forwardingPlan(snapshot, forward)).toThrow("冲突");
    snapshot.firewall.other.proto = "udp";
    expect(securityPlan(snapshot, draft).edits).not.toHaveLength(0);
    expect(forwardingPlan(snapshot, forward).edits).not.toHaveLength(0);
    expect(() => forwardingPlan(snapshot, { ...forward, protocol: "tcp udp" })).toThrow("冲突");
    snapshot.firewall.other.proto = "all";
    expect(() => securityPlan(snapshot, draft)).toThrow("冲突");
    snapshot.firewall.other.enabled = "0";
    expect(securityPlan(snapshot, draft).edits).not.toHaveLength(0);
    snapshot.firewall.other.enabled = "1";
    snapshot.firewall.other.family = "ipv6";
    expect(securityPlan(snapshot, draft).edits).not.toHaveLength(0);
  }
});
