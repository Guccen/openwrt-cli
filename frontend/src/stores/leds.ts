import { LedClient } from "../lib/led-client";
import { createSessionResource } from "./resource";
export const ledClient = new LedClient();
export const useLeds = createSessionResource((session) => ledClient.read(session));
