import { RouterClient, RpcError } from "./rpc";
import type { ConfigEdit, ConfigName, SettingsSnapshot, UciSections } from "./settings";

export const APPLY_TIMEOUT = 120;
export const CONFIGS: ConfigName[] = ["network", "dhcp", "wireless", "firewall"];

export class ConfigClient {
  constructor(readonly rpc = new RouterClient()) {}

  async read(session: string): Promise<SettingsSnapshot> {
    const get = async (config: ConfigName) => {
      try {
        return (await this.rpc.call<{ values: UciSections }>(session, "uci", "get", { config }))
          .values;
      } catch (error) {
        if (config === "wireless" && error instanceof RpcError && error.code === 4) return {};
        throw error;
      }
    };
    const [network, dhcp, wireless, firewall] = await Promise.all(CONFIGS.map(get));
    if (!network?.lan || !dhcp || !wireless || !firewall) throw new Error("设备配置不完整");
    return { network, dhcp, wireless, firewall };
  }

  async changes(session: string) {
    const result = await this.rpc.call<{ changes: Record<string, unknown[]> }>(
      session,
      "uci",
      "changes",
    );
    return Object.values(result.changes ?? {}).some((items) => items.length);
  }

  async applyPending(session: string) {
    const result = await this.rpc.call<{ ok?: boolean; applyPending?: boolean }>(
      session,
      "router.maintenance",
      "status",
    );
    if (result?.ok !== true || typeof result.applyPending !== "boolean")
      throw new Error("无法核对配置确认状态，请等待设备自动恢复");
    return result.applyPending;
  }

  async stage(session: string, edits: ConfigEdit[]) {
    for (const edit of edits) {
      if (!CONFIGS.includes(edit.config)) throw new Error("不支持此配置文件");
      if (edit.deleteSection) {
        await this.rpc.call(session, "uci", "delete", {
          config: edit.config,
          section: edit.section,
        });
        continue;
      }
      if (edit.add) {
        const result = await this.rpc.call<{ section: string }>(session, "uci", "add", {
          config: edit.config,
          name: edit.section,
          type: edit.add,
          values: edit.values ?? {},
        });
        if (result?.section !== edit.section) throw new Error("设备返回的新配置名称不一致");
        continue;
      }
      if (edit.values && Object.keys(edit.values).length)
        await this.rpc.call(session, "uci", "set", {
          config: edit.config,
          section: edit.section,
          values: edit.values,
        });
      for (const option of edit.remove ?? [])
        await this.rpc.call(session, "uci", "delete", {
          config: edit.config,
          section: edit.section,
          option,
        });
    }
  }

  async revert(session: string, configs: ConfigName[]) {
    for (const config of configs) {
      try {
        await this.rpc.call(session, "uci", "revert", { config });
      } catch (error) {
        if (!(error instanceof RpcError && error.code === 4)) throw error;
      }
    }
  }

  apply(session: string, timeout = APPLY_TIMEOUT) {
    return this.rpc.call(session, "uci", "apply", { rollback: true, timeout });
  }
  confirm(session: string) {
    return this.rpc.call(session, "uci", "confirm");
  }
  rollback(session: string) {
    return this.rpc.call(session, "uci", "rollback");
  }
}
