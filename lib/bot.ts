import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";

export interface ThreadState {
  runId?: string;
  claudeSessionId?: string;
}

const adapters = {
  slack: createSlackAdapter(),
};

export const bot = new Chat<typeof adapters, ThreadState>({
  userName: "athanir",
  adapters,
  state: createRedisState(),
  onLockConflict: "force",
}).registerSingleton();
