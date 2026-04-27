import { WebClient } from "@slack/web-api";
import {
  getChannelHistoryCharLimit,
  getChannelHistoryMessageLimit,
  type RepoConfig,
} from "@/lib/config";

type SlackHistoryMessage = {
  type?: string;
  subtype?: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  ts?: string;
};

type SlackUserInfo = {
  name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
  };
  real_name?: string;
};

function getSlackBotToken(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

function parseSlackChannelId(channelId: string): string | null {
  if (!channelId.startsWith("slack:")) return null;
  return channelId.slice("slack:".length) || null;
}

function normalizeText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>\s*/g, "")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function speakerFor(message: SlackHistoryMessage): string {
  if (message.bot_id) return "Assistant";
  return message.username || (message.user ? `User ${message.user}` : "User");
}

function resolveSpeakerLabel(
  message: SlackHistoryMessage,
  userNames: Map<string, string>
): string {
  if (message.bot_id) {
    return normalizeText(message.username ?? "") || "Assistant";
  }

  if (message.user) {
    const userName = userNames.get(message.user);
    if (userName) return userName;
  }

  return normalizeText(speakerFor(message));
}

function trimHistory(history: string, charLimit: number): string {
  if (history.length <= charLimit) return history;

  const trimmed = history.slice(history.length - charLimit);
  const firstNewline = trimmed.indexOf("\n");
  return firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed;
}

async function lookupSlackUserNames(
  client: WebClient,
  messages: SlackHistoryMessage[]
): Promise<Map<string, string>> {
  const uniqueUserIds = [...new Set(messages.map((message) => message.user).filter(Boolean))];
  const userNames = new Map<string, string>();

  await Promise.all(
    uniqueUserIds.map(async (userId) => {
      if (!userId) return;

      try {
        const result = await client.users.info({ user: userId });
        const user = result.user as SlackUserInfo | undefined;
        const name = normalizeText(
          user?.profile?.display_name ??
            user?.profile?.real_name ??
            user?.real_name ??
            user?.name ??
            ""
        );

        if (name) {
          userNames.set(userId, name);
        }
      } catch {
        // Missing scopes or lookup failures should not block the agent.
      }
    })
  );

  return userNames;
}

export async function fetchSlackChannelHistoryContext(
  channelId: string,
  repoConfig: RepoConfig,
  currentMessageText: string
): Promise<string> {
  if (!repoConfig.channelHistory) return "";

  const slackChannelId = parseSlackChannelId(channelId);
  const token = getSlackBotToken();
  if (!slackChannelId || !token) return "";

  const messageLimit = getChannelHistoryMessageLimit(repoConfig);
  const charLimit = getChannelHistoryCharLimit(repoConfig);
  const currentText = normalizeText(currentMessageText);

  try {
    const client = new WebClient(token);
    const result = await client.conversations.history({
      channel: slackChannelId,
      limit: messageLimit + 1,
      inclusive: true,
    });

    if (!result.ok || !result.messages?.length) {
      return "";
    }

    const messages = (result.messages as SlackHistoryMessage[])
      .filter((message) => message.type === "message" || !message.type)
      .filter((message) => !message.subtype || message.subtype === "bot_message")
      .reverse();

    const userNames = await lookupSlackUserNames(client, messages);
    const formattedMessages = messages
      .map((message) => ({
        speaker: resolveSpeakerLabel(message, userNames),
        text: normalizeText(message.text ?? ""),
      }))
      .filter((message) => message.text);

    if (formattedMessages.length > 0) {
      const lastMessage = formattedMessages[formattedMessages.length - 1];
      if (lastMessage.speaker !== "Assistant" && lastMessage.text === currentText) {
        formattedMessages.pop();
      }
    }

    const history = formattedMessages
      .slice(-messageLimit)
      .map(({ speaker, text }) => `${speaker}: ${text}`)
      .join("\n");

    return trimHistory(history, charLimit);
  } catch (error) {
    console.warn("Failed to fetch Slack channel history", error);
    return "";
  }
}
