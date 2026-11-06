import { LedClient } from "../lib/led-client";
import { createSessionResource } from "./resource";
import { registerSessionBinder } from "./session-binding";
export const ledClient = new LedClient();
export const useLeds = createSessionResource((session) => ledClient.read(session));
registerSessionBinder((session) => useLeds.getState().bind(session));
