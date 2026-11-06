import type { ConfigPlan, SettingsSnapshot, UciSection, UciSections } from "./settings";

const managed = {
  dmz: { section: "router_ui_dmz", name: "DMZ", label: "DMZ" },
  web: { section: "router_ui_remote_web", name: "Router-Remote-Web", label: "远程管理" },
};

// 读取与修改使用同一个真实节名，兼容旧配置并拒绝覆盖同名的其他用途配置。
export function managedRedirect(firewall: UciSections, kind: keyof typeof managed) {
  const spec = managed[kind];
  const matches = Object.entries(firewall).filter(
    ([name, rule]) =>
      name === spec.section || (rule[".type"] === "redirect" && rule.name === spec.name),
  );
  if (matches.length > 1) throw new Error(`检测到多条 ${spec.label} 规则，请先通过 SSH 整理配置。`);
  const entry = matches[0];
  if (!entry) return undefined;
  const [, rule] = entry;
  if (
    rule[".type"] !== "redirect" ||
    rule.src !== "wan" ||
    rule.dest !== "lan" ||
    String(rule.target ?? "DNAT") !== "DNAT" ||
    !["ipv4", "any"].includes(String(rule.family ?? "any")) ||
    (kind === "dmz" && (!!rule.src_dport || !!rule.dest_port))
  )
    throw new Error(`${spec.label} 使用高级配置，请通过 SSH 管理。`);
  return entry;
}

// 只移动本项目识别的兜底规则；仍通过原来的暂存、应用和回滚接口写入。
export function dmzLast(snapshot: SettingsSnapshot, plan: ConfigPlan): ConfigPlan {
  const entry = managedRedirect(snapshot.firewall, "dmz");
  if (!entry) return plan;
  const [name] = entry;
  const sections = Object.entries(snapshot.firewall).sort(
    (a, b) => Number(a[1][".index"] ?? 0) - Number(b[1][".index"] ?? 0),
  );
  const result = new Map(sections.map(([key, value]) => [key, { ...value }]));
  for (const edit of plan.edits) {
    if (edit.config !== "firewall") continue;
    if (edit.deleteSection) result.delete(edit.section);
    else {
      const section: UciSection = { ...result.get(edit.section), ...edit.values };
      if (edit.add) section[".type"] = edit.add;
      for (const option of edit.remove ?? []) delete section[option];
      result.set(edit.section, section);
    }
  }
  const dmz = result.get(name);
  if (!dmz) return plan;
  const redirects = [...result].filter(([, rule]) => rule[".type"] === "redirect");
  if (redirects.at(-1)?.[0] === name) return plan;
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(dmz)) {
    if (key.startsWith(".")) continue;
    if (typeof value !== "string" && !Array.isArray(value))
      throw new Error("DMZ 配置格式不正确，请通过 SSH 检查。");
    values[key] = value;
  }
  return {
    ...plan,
    edits: [
      ...plan.edits.filter((edit) => edit.config !== "firewall" || edit.section !== name),
      { config: "firewall", section: name, deleteSection: true },
      { config: "firewall", section: name, add: "redirect", values },
    ],
  };
}
