import { emoji, type Message, type Thread } from "chat";
import { resumeHook, start } from "workflow/api";
import { bot, type ThreadState } from "@/lib/bot";
import { getRepoForChannel } from "@/lib/config";
import { fetchAttachments } from "@/lib/attachments";
import { durableChatSession } from "@/workflows/durable-chat-session";
import type { ChatTurnPayload } from "@/workflows/chat-turn-hook";

async function startSession(
  thread: Thread<ThreadState>,
  message: Message,
  repoConfig: ReturnType<typeof getRepoForChannel>
) {
  const attachments = await fetchAttachments(message);
  const run = await start(durableChatSession, [
    JSON.stringify({
      thread: thread.toJSON(),
      message: message.toJSON(),
      repoConfig,
      attachments,
    }),
  ]);

  await thread.setState({ runId: run.runId }, { replace: true });
}

async function routeTurn(
  thread: Thread<ThreadState>,
  message: Message
) {
  const channelId = thread.channel?.id ?? "";
  const repoConfig = getRepoForChannel(channelId);

  if (!repoConfig) {
    await thread.post(
      `I don't know which repo to target for this channel (${channelId}). ` +
        "Ask a developer to add this channel to the config."
    );
    return;
  }

  const prompt = message.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
  if (!prompt) {
    await thread.post("What change would you like me to make?");
    return;
  }

  const state = await thread.state;

  if (!state?.runId) {
    await thread.subscribe();
    await thread.createSentMessageFromMessage(message).addReaction(emoji.eyes);
    await startSession(thread, message, repoConfig);
    return;
  }

  try {
    await thread.createSentMessageFromMessage(message).addReaction(emoji.eyes);
    const attachments = await fetchAttachments(message);
    await resumeHook<ChatTurnPayload>(state.runId, {
      message: message.toJSON(),
      attachments,
    });
  } catch {
    // Workflow may have ended — start a fresh session
    await startSession(thread, message, repoConfig);
  }
}

bot.onNewMention(async (thread, message) => {
  await routeTurn(thread, message);
});

bot.onDirectMessage(async (thread, message) => {
  await routeTurn(thread, message);
});

bot.onSubscribedMessage(async (thread, message) => {
  await routeTurn(thread, message);
});
