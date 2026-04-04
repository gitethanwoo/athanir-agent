import { Sandbox } from "@vercel/sandbox";
import { getGitHubToken, type RepoConfig } from "./config";

const BASE_SNAPSHOT_ID = "snap_7mhOzyonNr8voAi0sUqqXuvaxKka";

/** Create a sandbox from the base snapshot (Claude Code pre-installed). */
export async function createSandbox(): Promise<Sandbox> {
  return Sandbox.create({
    source: { type: "snapshot", snapshotId: BASE_SNAPSHOT_ID },
    resources: { vcpus: 4 },
    timeout: 30 * 60 * 1000, // 30 minutes
  });
}

/** Clone the target repo into the sandbox and create a working branch. */
export async function cloneRepo(
  sandbox: Sandbox,
  repoConfig: RepoConfig
): Promise<string> {
  const { owner, repo, baseBranch } = repoConfig;
  const githubToken = getGitHubToken(repoConfig);
  const repoUrl = `https://github.com/${owner}/${repo}.git`;
  const branchName = `athanir/${Date.now()}`;
  const gitEnv = { GIT_TOKEN: githubToken };

  // Configure a credential helper that reads the token from an env var
  // so it never appears in .git/config where Claude Code could read it.
  await sandbox.runCommand({
    cmd: "git",
    args: [
      "config", "--global", "credential.helper",
      "!f() { echo username=x-access-token; echo password=$GIT_TOKEN; }; f",
    ],
    env: gitEnv,
  });

  await sandbox.runCommand({
    cmd: "git",
    args: ["clone", "--depth", "1", "-b", baseBranch, repoUrl, "project"],
    env: gitEnv,
  });

  await sandbox.runCommand({
    cmd: "git",
    args: ["checkout", "-b", branchName],
    cwd: "/vercel/sandbox/project",
  });

  return branchName;
}

export interface ClaudeResult {
  text: string;
  hasChanges: boolean;
  sessionId?: string;
  success: boolean;
  stderr?: string;
}

const SYSTEM_PROMPT = [
  "You are Athanir, an AI coding agent. Users ask you to make changes to this repository via chat.",
  "You are running inside a sandboxed environment. The repository is cloned at /vercel/sandbox/project.",
  "",
  "IMPORTANT rules:",
  "- Do NOT run git commit, git push, or any git commands that modify history. Committing and pushing is handled automatically after you finish.",
  "- Only edit files. Make the requested changes to the codebase.",
  "- If the user asks a question, just answer it. Do not make changes unless asked.",
  "- If the user attached files, they are saved to /tmp/uploads/. Images can be viewed as visual references. Other files can be read or copied into the project as needed.",
  "- Keep changes minimal and focused on what the user asked for.",
].join("\n");

/** Run Claude Code in the sandbox and check if files changed. */
export async function runClaude(
  sandbox: Sandbox,
  prompt: string,
  sessionId?: string
): Promise<ClaudeResult> {
  const cwd = "/vercel/sandbox/project";
  const args = ["-p"];

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  args.push(
    prompt,
    "--output-format",
    "json",
    "--system-prompt",
    SYSTEM_PROMPT,
    "--permission-mode",
    "bypassPermissions",
    "--disallowedTools",
    "Bash(git commit:*)",
    "Bash(git push:*)",
    "Bash(git merge:*)",
    "Bash(git rebase:*)",
    "Bash(git reset:*)",
    "Bash(git checkout -B:*)",
    "Bash(curl:*)",
    "Bash(wget:*)",
  );

  const result = await sandbox.runCommand({
    cmd: "claude",
    args,
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
    cwd,
  });

  // Extract text response
  let text = "";
  let returnedSessionId: string | undefined;
  let stderr = "";
  try {
    const stdout = await result.stdout();
    const parsed = JSON.parse(stdout);
    text = parsed.result ?? stdout;
    returnedSessionId =
      typeof parsed.session_id === "string" ? parsed.session_id : undefined;
  } catch {
    text = (await result.stdout()).trim();
  }

  if (result.exitCode !== 0) {
    stderr = await result.stderr();
    text = text || `Claude Code error: ${stderr}`;
  }

  // Check for file changes
  const diff = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd });
  const hasChanges = (await diff.stdout()).trim().length > 0;

  return {
    text,
    hasChanges,
    sessionId: returnedSessionId,
    success: result.exitCode === 0,
    stderr,
  };
}

/** Stage, commit, and push changes. */
export async function commitAndPush(
  sandbox: Sandbox,
  prompt: string,
  branchName: string,
  repoConfig: RepoConfig
): Promise<void> {
  const cwd = "/vercel/sandbox/project";
  const commitMsg = `athanir: ${prompt.slice(0, 72)}`;

  await sandbox.runCommand({ cmd: "git", args: ["add", "-A"], cwd });
  await sandbox.runCommand({ cmd: "git", args: ["commit", "-m", commitMsg], cwd });
  await sandbox.runCommand({
    cmd: "git",
    args: ["push", "origin", branchName],
    cwd,
    env: { GIT_TOKEN: getGitHubToken(repoConfig) },
  });
}

/** Open a new PR or return the existing one. */
export async function openOrUpdatePR(
  branchName: string,
  prompt: string,
  repoConfig: RepoConfig,
  existingPrUrl?: string
): Promise<string> {
  if (existingPrUrl) return existingPrUrl;

  const { owner, repo, baseBranch } = repoConfig;
  const githubToken = getGitHubToken(repoConfig);
  const commitMsg = `athanir: ${prompt.slice(0, 72)}`;

  const prResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        title: commitMsg,
        head: branchName,
        base: baseBranch,
        body: `Requested via Slack:\n\n> ${prompt}`,
      }),
    }
  );

  if (!prResponse.ok) {
    const body = await prResponse.text();
    throw new Error(`GitHub PR creation failed (${prResponse.status}): ${body}`);
  }

  const pr = (await prResponse.json()) as { html_url: string };
  return pr.html_url;
}

/** Stop a sandbox (safe to call if already stopped). */
export async function stopSandbox(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.stop();
  } catch {
    // May have already timed out
  }
}
