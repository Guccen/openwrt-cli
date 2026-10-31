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
          dest_port: "80",
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
      dest_port: "80",
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
