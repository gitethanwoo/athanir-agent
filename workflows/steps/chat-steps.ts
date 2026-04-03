import { type Thread } from "chat";
import { type Sandbox } from "@vercel/sandbox";
import { bot, type ThreadState } from "@/lib/bot";
import {
  createSandbox,
  cloneRepo,
  runClaude,
  commitAndPush,
  openOrUpdatePR,
  stopSandbox,
} from "@/lib/agent";
import { type RepoConfig } from "@/lib/config";

export async function parsePayload(payload: string) {
  "use step";
  return JSON.parse(payload, bot.reviver());
}

export async function setupSandbox(repoConfig: RepoConfig) {
  "use step";
  const sandbox = await createSandbox();
  const branchName = await cloneRepo(sandbox, repoConfig);
  return { sandbox, branchName };
}

export async function executePrompt(sandbox: Sandbox, prompt: string) {
  "use step";
  return runClaude(sandbox, prompt);
}

export async function pushChanges(
  sandbox: Sandbox,
  prompt: string,
  branchName: string,
  repoConfig: RepoConfig,
  existingPrUrl?: string
) {
  "use step";
  await commitAndPush(sandbox, prompt, branchName);
  return openOrUpdatePR(branchName, prompt, repoConfig, existingPrUrl);
}

export async function postResponse(
  thread: Thread<ThreadState>,
  text: string,
  prUrl?: string
) {
  "use step";
  await bot.initialize();
  if (prUrl) {
    await thread.post(text ? `${text}\n\nPR: ${prUrl}` : `Done! PR: ${prUrl}`);
  } else {
    await thread.post(text || "Done — no changes needed.");
  }
}

export async function closeSession(
  thread: Thread<ThreadState>,
  sandbox: Sandbox
) {
  "use step";
  await bot.initialize();
  await stopSandbox(sandbox);
  await thread.post("Session closed.");
  await thread.unsubscribe();
  await thread.setState({}, { replace: true });
}

export async function deserializeMessage(serialized: unknown) {
  "use step";
  const { Message } = await import("chat");
  return Message.fromJSON(serialized as import("chat").SerializedMessage);
}
