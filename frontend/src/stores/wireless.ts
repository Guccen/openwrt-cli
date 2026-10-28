import { WirelessClient } from "../lib/wireless-client";
import { createSessionResource } from "./resource";

const client = new WirelessClient();
export const useWireless = createSessionResource((session, signal) => client.read(session, signal));
