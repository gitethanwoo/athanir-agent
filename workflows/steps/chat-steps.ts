import { type Sandbox } from "@vercel/sandbox";
import { emoji } from "chat";
import { bot } from "@/lib/bot";
import {
  createSandbox,
  cloneRepo,
  runClaude,
  commitAndPush,
  openOrUpdatePR,
  getPreviewDeploymentUrl,
  getAccessiblePreviewUrl,
  stopSandbox,
} from "@/lib/agent";
import { type RepoConfig, getGitHubToken } from "@/lib/config";
import type { SerializedAttachment } from "@/lib/attachments";

const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_CHARS = 12_000;

/** Deserialize a payload string into thread + message + repoConfig + attachments. */
export async function parsePayload(payload: string) {
  "use step";
  await bot.initialize();
  const parsed = JSON.parse(payload, bot.reviver());
  return {
    threadJson: JSON.stringify(parsed.thread.toJSON()),
    messageJson: JSON.stringify(parsed.message.toJSON()),
    messageText: parsed.message.text as string,
    repoConfig: parsed.repoConfig as RepoConfig,
    attachments: (parsed.attachments ?? []) as SerializedAttachment[],
  };
}

export async function setupSandbox(repoConfig: RepoConfig) {
  "use step";
  const sandbox = await createSandbox();
  const branchName = await cloneRepo(sandbox, repoConfig);
  return { sandbox, branchName };
}

const UPLOADS_DIR = "/tmp/uploads";

/** Write serialized attachments into the sandbox and return their file paths. */
export async function writeAttachmentsToSandbox(
  sandbox: Sandbox,
  attachments: SerializedAttachment[]
): Promise<string[]> {
  "use step";
  if (!attachments.length) return [];

  await sandbox.runCommand({ cmd: "mkdir", args: ["-p", UPLOADS_DIR] });

  const files = attachments.map((att, i) => ({
    path: `${UPLOADS_DIR}/${i}-${att.name}`,
    content: Uint8Array.from(Buffer.from(att.dataBase64, "base64")),
  }));

  await sandbox.writeFiles(files);

  return files.map((f) => f.path);
}

async function getThreadState(threadJson: string) {
  await bot.initialize();
  const thread = JSON.parse(threadJson, bot.reviver());
  return thread.state;
}

export async function updateClaudeSession(
  threadJson: string,
  claudeSessionId?: string
) {
  "use step";
  await bot.initialize();
  const thread = JSON.parse(threadJson, bot.reviver());

  if (claudeSessionId) {
    await thread.setState({ claudeSessionId });
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function buildContextualPrompt(
  threadJson: string,
  prompt: string
): Promise<string> {
  await bot.initialize();
  const thread = JSON.parse(threadJson, bot.reviver());
  const currentText = normalizeText(prompt);
  const recentMessages: Array<{ speaker: string; text: string }> = [];

  for await (const message of thread.messages) {
    const text = normalizeText(message.text ?? "");
    if (!text) continue;

    const speaker = message.author.isMe
      ? "Assistant"
      : message.author.fullName || message.author.userName || "User";

    recentMessages.push({ speaker, text });

    if (recentMessages.length >= MAX_CONTEXT_MESSAGES + 1) {
      break;
    }
  }

  const transcript = recentMessages
    .reverse()
    .map(({ speaker, text }) => `${speaker}: ${text}`);

  if (transcript.length > 0) {
    const lastLine = transcript[transcript.length - 1];
    if (
      !lastLine.startsWith("Assistant:") &&
      normalizeText(lastLine.slice(lastLine.indexOf(":") + 1)) === currentText
    ) {
      transcript.pop();
    }
  }

  const trimmedTranscript = transcript.slice(-MAX_CONTEXT_MESSAGES);
  let history = trimmedTranscript.join("\n");

  if (history.length > MAX_CONTEXT_CHARS) {
    history = history.slice(history.length - MAX_CONTEXT_CHARS);
    const firstNewline = history.indexOf("\n");
    history = firstNewline >= 0 ? history.slice(firstNewline + 1) : history;
  }

  return [
    "You are continuing an existing Slack thread about this repository.",
    "Use the prior thread context when interpreting short follow-ups like 'yes', 'that one', or 'make it white'.",
    "If the user is replying to a prior assistant question, answer that question directly instead of treating the reply as a brand-new request.",
    history ? `Thread history (oldest to newest):\n${history}` : "",
    `Current user message:\n${currentText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildFileManifest(filePaths: string[]): string {
  if (!filePaths.length) return "";
  const listing = filePaths
    .map((p) => `- ${p.split("/").pop()} → ${p}`)
    .join("\n");
  return [
    "The user attached the following files (saved to /tmp/uploads/):",
    listing,
    "Use these files to fulfill the request. Images can be viewed for visual reference. Other files (SVGs, CSVs, etc.) can be read or copied into the project as needed.",
  ].join("\n");
}

export async function executePrompt(
  sandbox: Sandbox,
  threadJson: string,
  prompt: string,
  claudeSessionId?: string,
  filePaths: string[] = []
) {
  "use step";
  const state = await getThreadState(threadJson);
  const sessionIdToResume = claudeSessionId ?? state?.claudeSessionId;
  const fileManifest = buildFileManifest(filePaths);
  const promptWithFiles = fileManifest
    ? `${prompt}\n\n${fileManifest}`
    : prompt;

  if (sessionIdToResume) {
    const resumedResult = await runClaude(sandbox, promptWithFiles, sessionIdToResume);
    const resumeFailed =
      !resumedResult.success &&
      /resume|session/i.test(
        `${resumedResult.stderr ?? ""}\n${resumedResult.text}`
      );

    if (!resumeFailed) {
      return resumedResult;
    }
  }

  const contextualPrompt = await buildContextualPrompt(threadJson, prompt);
  const fullPrompt = fileManifest
    ? `${contextualPrompt}\n\n${fileManifest}`
    : contextualPrompt;

  return runClaude(sandbox, fullPrompt);
}

export async function pushChanges(
  sandbox: Sandbox,
  prompt: string,
  branchName: string,
  repoConfig: RepoConfig,
  existingPrUrl?: string
) {
  "use step";
  await commitAndPush(sandbox, prompt, branchName, repoConfig);
  return openOrUpdatePR(branchName, prompt, repoConfig, existingPrUrl);
}

export async function postPreviewWhenReady(
  threadJson: string,
  branchName: string,
  repoConfig: RepoConfig,
  pushedAt: string
) {
  "use step";
  const { owner, repo } = repoConfig;
  const githubToken = getGitHubToken(repoConfig);
  const previewUrl = await getPreviewDeploymentUrl(owner, repo, branchName, githubToken, pushedAt);
  if (previewUrl) {
    const accessiblePreviewUrl = getAccessiblePreviewUrl(previewUrl);
    await bot.initialize();
    const thread = JSON.parse(threadJson, bot.reviver());
    await thread.post(`Preview ready: ${accessiblePreviewUrl}`);
  }
}

/** Post a response to the thread. Takes serialized thread JSON, not Thread object. */
export async function postResponse(
  threadJson: string,
  text: string,
  prUrl?: string
) {
  "use step";
  await bot.initialize();
  const thread = JSON.parse(threadJson, bot.reviver());
  if (prUrl) {
    await thread.post(text ? `${text}\n\nPR: ${prUrl}` : `Done! PR: ${prUrl}`);
  } else {
    await thread.post(text || "Done — no changes needed.");
  }
}

export async function markMessageHandled(
  threadJson: string,
  messageJson: string
) {
  "use step";
  await bot.initialize();
  const thread = JSON.parse(threadJson, bot.reviver());
  const message = JSON.parse(messageJson, bot.reviver());
  const sentMessage = thread.createSentMessageFromMessage(message);

  try {
    await sentMessage.removeReaction(emoji.eyes);
  } catch {
    // The message may not have an eyes reaction yet.
  }

  try {
    await sentMessage.addReaction(emoji.thumbs_up);
  } catch {
    // Reactions can fail if the platform rejects duplicates or permissions changed.
  }
}

/** Close the session: stop sandbox, post, unsubscribe. */
export async function closeSession(
  threadJson: string,
  sandbox: Sandbox
) {
  "use step";
  await bot.initialize();
  const thread = JSON.parse(threadJson, bot.reviver());
  await stopSandbox(sandbox);
  await thread.post("Session closed.");
  await thread.unsubscribe();
  await thread.setState({}, { replace: true });
}
