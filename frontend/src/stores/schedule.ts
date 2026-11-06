import { ScheduleClient } from "../lib/schedule";
import { createSessionResource } from "./resource";
import { registerSessionBinder } from "./session-binding";

export const scheduleClient = new ScheduleClient();
export const useSchedule = createSessionResource((session) => scheduleClient.read(session));
registerSessionBinder((session) => useSchedule.getState().bind(session));
