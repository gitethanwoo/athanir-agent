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
  const repoUrl = `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`;
  const branchName = `athanir/${Date.now()}`;

  await sandbox.runCommand({
    cmd: "git",
    args: ["clone", "--depth", "1", "-b", baseBranch, repoUrl, "project"],
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
}

/** Run Claude Code in the sandbox and check if files changed. */
export async function runClaude(
  sandbox: Sandbox,
  prompt: string
): Promise<ClaudeResult> {
  const cwd = "/vercel/sandbox/project";

  const result = await sandbox.runCommand({
    cmd: "claude",
    args: ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"],
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
    cwd,
  });

  // Extract text response
  let text = "";
  try {
    const stdout = await result.stdout();
    const parsed = JSON.parse(stdout);
    text = parsed.result ?? stdout;
  } catch {
    text = (await result.stdout()).trim();
  }

  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    text = text || `Claude Code error: ${stderr}`;
  }

  // Check for file changes
  const diff = await sandbox.runCommand({ cmd: "git", args: ["status", "--porcelain"], cwd });
  const hasChanges = (await diff.stdout()).trim().length > 0;

  return { text, hasChanges };
}

/** Stage, commit, and push changes. */
export async function commitAndPush(
  sandbox: Sandbox,
  prompt: string,
  branchName: string
): Promise<void> {
  const cwd = "/vercel/sandbox/project";
  const commitMsg = `athanir: ${prompt.slice(0, 72)}`;

  await sandbox.runCommand({ cmd: "git", args: ["add", "-A"], cwd });
  await sandbox.runCommand({ cmd: "git", args: ["commit", "-m", commitMsg], cwd });
  await sandbox.runCommand({ cmd: "git", args: ["push", "origin", branchName], cwd });
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
