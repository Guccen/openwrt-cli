import { readClients } from "../lib/status";
import { createSessionResource } from "./resource";
import { registerSessionBinder } from "./session-binding";
export const useClients = createSessionResource((session) => readClients(session));
registerSessionBinder((session) => useClients.getState().bind(session));
