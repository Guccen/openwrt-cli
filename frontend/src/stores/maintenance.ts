import { MaintenanceClient } from "../lib/maintenance-client";
import { createSessionResource } from "./resource";
import { registerSessionBinder } from "./session-binding";

export const maintenanceClient = new MaintenanceClient();
export const useMaintenance = createSessionResource((session) => maintenanceClient.read(session));
registerSessionBinder((session) => useMaintenance.getState().bind(session));
