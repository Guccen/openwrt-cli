import { RouterClient } from "./rpc";
export type DiagnosticOperation = "ping4" | "ping6" | "dns" | "logs";
export interface DiagnosticResult {
  ok: boolean;
  success: boolean;
  code: number;
  output: string;
  limited: boolean;
  error?: string;
}
export class DiagnosticsClient {
  constructor(readonly rpc = new RouterClient()) {}
  async run(session: string, operation: DiagnosticOperation, target: string) {
    const response = await this.rpc.call<DiagnosticResult>(session, "router.diagnostics", "run", {
      operation,
      target: operation === "logs" ? "" : target.trim(),
    });
    if (!response?.ok || typeof response.output !== "string")
      throw new Error(
        response?.error === "operation_busy"
          ? "设备正在执行另一项诊断，请稍后重试。"
          : response?.error === "invalid_target"
            ? "请输入 IP 地址或域名，不要填写 URL、端口或命令。"
            : "诊断暂不可用，请确认已安装完整组件。",
      );
    return response;
  }
}
