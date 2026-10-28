import { create } from "zustand";
import { maintenanceFailure, type MaintenanceOperationStatus } from "../lib/maintenance-client";

interface OperationToken {
  session: string;
  sequence: number;
}
type OperationKind =
  | "backup"
  | "reboot"
  | "restore"
  | "upgrade"
  | "reset"
  | "upload"
  | "password"
  | "led"
  | "schedule"
  | "time";
export function createMaintenanceOperation() {
  let sequence = 0;
  return create<{
    session: string | null;
    kind: OperationKind | null;
    operationId: string | null;
    startedAt: number;
    failure: string | null;
    bind: (session: string | null) => void;
    begin: (kind: OperationKind) => OperationToken | null;
    finish: (token: OperationToken) => void;
    track: (token: OperationToken, operationId: string | null) => void;
    observe: (status: MaintenanceOperationStatus | null) => void;
  }>((set, get) => ({
    session: null,
    kind: null,
    operationId: null,
    startedAt: 0,
    failure: null,
    bind: (session) => {
      if (session === get().session) return;
      ++sequence;
      set({ session, kind: null, operationId: null, startedAt: 0, failure: null });
    },
    begin: (kind) => {
      const { session } = get();
      if (!session || get().kind) return null;
      const token = { session, sequence: ++sequence };
      set({ kind, operationId: null, startedAt: Date.now(), failure: null });
      return token;
    },
    finish: (token) => {
      if (token.session === get().session && token.sequence === sequence) set({ kind: null });
    },
    track: (token, operationId) => {
      if (token.session === get().session && token.sequence === sequence) set({ operationId });
    },
    observe: (status) => {
      const state = get();
      if (
        !status ||
        !state.kind ||
        status.kind !== state.kind ||
        (state.operationId
          ? status.id !== state.operationId
          : status.updatedAt < Math.floor(state.startedAt / 1000))
      )
        return;
      if (status.state === "failed")
        set({ kind: null, operationId: null, failure: maintenanceFailure(status.error) });
      else if (!state.operationId) set({ operationId: status.id });
    },
  }));
}
export const useMaintenanceOperation = createMaintenanceOperation();
