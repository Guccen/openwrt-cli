import { MaintenanceClient } from "../lib/maintenance-client";
import { createSessionResource } from "./resource";

export const maintenanceClient = new MaintenanceClient();
export const useMaintenance = createSessionResource((session) => maintenanceClient.read(session));
