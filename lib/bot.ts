import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";

export interface ThreadState {
  runId?: string;
}

const adapters = {
  slack: createSlackAdapter(),
};

export const bot = new Chat<typeof adapters, ThreadState>({
  userName: "athanir",
  adapters,
  state: createMemoryState(),
  onLockConflict: "force",
}).registerSingleton();
