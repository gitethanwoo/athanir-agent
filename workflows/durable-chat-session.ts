import { type Sandbox } from "@vercel/sandbox";
import { createHook, getWorkflowMetadata } from "workflow";
import type { RepoConfig } from "@/lib/config";
import type { ChatTurnPayload } from "@/workflows/chat-turn-hook";
import {
  parsePayload,
  setupSandbox,
  executePrompt,
  pushChanges,
  postResponse,
  closeSession,
} from "@/workflows/steps/chat-steps";

async function processTurn(
  threadJson: string,
  messageText: string,
  sandbox: Sandbox,
  branchName: string,
  repoConfig: RepoConfig,
  prUrl?: string
): Promise<{ prUrl?: string; keepRunning: boolean }> {
  const text = messageText.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

  if (text.toLowerCase() === "done") {
    await closeSession(threadJson, sandbox);
    return { keepRunning: false };
  }

  const result = await executePrompt(sandbox, text);

  let newPrUrl = prUrl;
  if (result.hasChanges) {
    newPrUrl = await pushChanges(sandbox, text, branchName, repoConfig, prUrl);
  }

  await postResponse(threadJson, result.text, result.hasChanges ? newPrUrl : undefined);
  return { prUrl: newPrUrl, keepRunning: true };
}

export async function durableChatSession(payload: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const { threadJson, messageText, repoConfig } = await parsePayload(payload);

  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });

  const { sandbox, branchName } = await setupSandbox(repoConfig);

  let turnResult = await processTurn(
    threadJson,
    messageText,
    sandbox,
    branchName,
    repoConfig
  );
  if (!turnResult.keepRunning) return;

  for await (const event of hook) {
    // Extract text from the serialized message
    const msgText = (event.message as unknown as { text?: string }).text ?? "";
    turnResult = await processTurn(
      threadJson,
      msgText,
      sandbox,
      branchName,
      repoConfig,
      turnResult.prUrl
    );
    if (!turnResult.keepRunning) return;
  }
}
