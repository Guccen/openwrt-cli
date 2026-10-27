import { readClients } from "../lib/status";
import { createSessionResource } from "./resource";
export const useClients = createSessionResource(readClients);
