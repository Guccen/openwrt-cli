import { create } from "zustand";

interface OperationToken {
  session: string;
  sequence: number;
}
export function createMaintenanceOperation() {
  let sequence = 0;
  return create<{
    session: string | null;
    kind: "backup" | "reboot" | null;
    bind: (session: string | null) => void;
    begin: (kind: "backup" | "reboot") => OperationToken | null;
    finish: (token: OperationToken) => void;
  }>((set, get) => ({
    session: null,
    kind: null,
    bind: (session) => {
      if (session === get().session) return;
      ++sequence;
      set({ session, kind: null });
    },
    begin: (kind) => {
      const { session } = get();
      if (!session || get().kind) return null;
      const token = { session, sequence: ++sequence };
      set({ kind });
      return token;
    },
    finish: (token) => {
      if (token.session === get().session && token.sequence === sequence) set({ kind: null });
    },
  }));
}
export const useMaintenanceOperation = createMaintenanceOperation();
