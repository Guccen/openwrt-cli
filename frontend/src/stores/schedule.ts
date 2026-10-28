import { ScheduleClient } from "../lib/schedule";
import { createSessionResource } from "./resource";

export const scheduleClient = new ScheduleClient();
export const useSchedule = createSessionResource((session) => scheduleClient.read(session));
