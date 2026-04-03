import { type Message, type Thread } from "chat";
import { type Sandbox } from "@vercel/sandbox";
import { createHook, getWorkflowMetadata } from "workflow";
import type { ThreadState } from "@/lib/bot";
import type { RepoConfig } from "@/lib/config";
import type { ChatTurnPayload } from "@/workflows/chat-turn-hook";
import {
  parsePayload,
  setupSandbox,
  executePrompt,
  pushChanges,
  postResponse,
  closeSession,
  deserializeMessage,
} from "@/workflows/steps/chat-steps";

async function processTurn(
  thread: Thread<ThreadState>,
  message: Message,
  sandbox: Sandbox,
  branchName: string,
  repoConfig: RepoConfig,
  prUrl?: string
): Promise<{ prUrl?: string; keepRunning: boolean }> {
  const text = message.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

  if (text.toLowerCase() === "done") {
    await closeSession(thread, sandbox);
    return { keepRunning: false };
  }

  const result = await executePrompt(sandbox, text);

  let newPrUrl = prUrl;
  if (result.hasChanges) {
    newPrUrl = await pushChanges(sandbox, text, branchName, repoConfig, prUrl);
  }

  await postResponse(thread, result.text, result.hasChanges ? newPrUrl : undefined);
  return { prUrl: newPrUrl, keepRunning: true };
}

export async function durableChatSession(payload: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const { thread, message, repoConfig } = (await parsePayload(payload)) as {
    thread: Thread<ThreadState>;
    message: Message;
    repoConfig: RepoConfig;
  };

  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });

  const { sandbox, branchName } = await setupSandbox(repoConfig);

  let turnResult = await processTurn(
    thread,
    message,
    sandbox,
    branchName,
    repoConfig
  );
  if (!turnResult.keepRunning) return;

  for await (const event of hook) {
    const nextMessage = await deserializeMessage(event.message);
    turnResult = await processTurn(
      thread,
      nextMessage as Message,
      sandbox,
      branchName,
      repoConfig,
      turnResult.prUrl
    );
    if (!turnResult.keepRunning) return;
  }
}
