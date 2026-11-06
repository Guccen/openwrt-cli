import { WirelessClient } from "../lib/wireless-client";
import { createSessionResource } from "./resource";
import { registerSessionBinder } from "./session-binding";

const client = new WirelessClient();
export const useWireless = createSessionResource((session, signal) => client.read(session, signal));
registerSessionBinder((session) => useWireless.getState().bind(session));
