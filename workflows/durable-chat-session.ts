import { type Sandbox } from "@vercel/sandbox";
import { createHook, getWorkflowMetadata } from "workflow";
import type { RepoConfig } from "@/lib/config";
import type { ChatTurnPayload } from "@/workflows/chat-turn-hook";
import {
  parsePayload,
  setupSandbox,
  executePrompt,
  updateClaudeSession,
  pushChanges,
  postResponse,
  markMessageHandled,
  closeSession,
} from "@/workflows/steps/chat-steps";

async function processTurn(
  threadJson: string,
  messageJson: string,
  messageText: string,
  sandbox: Sandbox,
  branchName: string,
  repoConfig: RepoConfig,
  claudeSessionId?: string,
  prUrl?: string
): Promise<{ claudeSessionId?: string; prUrl?: string; keepRunning: boolean }> {
  const text = messageText.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

  if (text.toLowerCase() === "done") {
    await closeSession(threadJson, sandbox);
    return { keepRunning: false };
  }

  const result = await executePrompt(sandbox, threadJson, text, claudeSessionId);

  const newClaudeSessionId = result.sessionId ?? claudeSessionId;
  if (newClaudeSessionId && newClaudeSessionId !== claudeSessionId) {
    await updateClaudeSession(threadJson, newClaudeSessionId);
  }

  let newPrUrl = prUrl;
  if (result.hasChanges) {
    newPrUrl = await pushChanges(sandbox, text, branchName, repoConfig, prUrl);
  }

  await postResponse(threadJson, result.text, result.hasChanges ? newPrUrl : undefined);
  await markMessageHandled(threadJson, messageJson);
  return {
    claudeSessionId: newClaudeSessionId,
    prUrl: newPrUrl,
    keepRunning: true,
  };
}

export async function durableChatSession(payload: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const { threadJson, messageJson, messageText, repoConfig } = await parsePayload(payload);

  using hook = createHook<ChatTurnPayload>({ token: workflowRunId });

  const { sandbox, branchName } = await setupSandbox(repoConfig);

  let turnResult = await processTurn(
    threadJson,
    messageJson,
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
      JSON.stringify(event.message),
      msgText,
      sandbox,
      branchName,
      repoConfig,
      turnResult.claudeSessionId,
      turnResult.prUrl
    );
    if (!turnResult.keepRunning) return;
  }
}
