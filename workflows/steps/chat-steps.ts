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

/** Deserialize a payload string into thread + message + repoConfig. */
export async function parsePayload(payload: string) {
  "use step";
  await bot.initialize();
  const parsed = JSON.parse(payload, bot.reviver());
  // Return the thread as serialized JSON so it can cross workflow boundaries
  return {
    threadJson: JSON.stringify(parsed.thread.toJSON()),
    messageText: parsed.message.text as string,
    repoConfig: parsed.repoConfig as RepoConfig,
  };
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
