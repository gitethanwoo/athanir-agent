import type { SerializedMessage } from "chat";
import type { SerializedAttachment } from "@/lib/attachments";

export type ChatTurnPayload = {
  message: SerializedMessage;
  attachments?: SerializedAttachment[];
};
