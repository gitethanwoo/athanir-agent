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
  "",
  "VERIFICATION — after making visual or UI changes:",
  "1. Start the dev server in the background (e.g. `npm run dev &`) and wait for it to be ready.",
  "2. Use `agent-browser` to verify your work:",
  "   - `agent-browser open http://localhost:3000 && agent-browser wait --load networkidle && agent-browser screenshot /tmp/verify.png`",
  "   - Then read /tmp/verify.png to visually confirm the changes look correct.",
  "3. If something looks wrong, fix it and re-verify.",
  "4. Stop the dev server when done (`kill %1` or similar).",
  "Skip verification for non-visual changes (config, backend logic, etc.).",
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

  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  };

  if (process.env.AXIOM_TOKEN) {
    env.CLAUDE_CODE_ENABLE_TELEMETRY = "1";
    env.OTEL_METRICS_EXPORTER = "otlp";
    env.OTEL_LOGS_EXPORTER = "otlp";
    env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/json";
    env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://api.axiom.co";
    env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Bearer ${process.env.AXIOM_TOKEN},X-Axiom-Dataset=${process.env.AXIOM_DATASET}`;
  }

  const result = await sandbox.runCommand({
    cmd: "claude",
    args,
    env,
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

/** Poll GitHub Deployments API for a Vercel preview URL.
 *  Only considers deployments created after `afterTimestamp` to avoid
 *  returning stale URLs from previous pushes on the same branch. */
export async function getPreviewDeploymentUrl(
  owner: string,
  repo: string,
  branchName: string,
  githubToken: string,
  afterTimestamp: string,
  timeoutMs = 180_000,
  pollIntervalMs = 5_000
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  const cutoff = new Date(afterTimestamp).getTime();
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
  };

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/deployments?ref=${branchName}&per_page=5`,
        { headers }
      );

      if (res.ok) {
        const deployments = (await res.json()) as Array<{
          created_at: string;
          statuses_url: string;
        }>;

        for (const deployment of deployments) {
          if (new Date(deployment.created_at).getTime() < cutoff) continue;

          const statusRes = await fetch(deployment.statuses_url, { headers });
          if (!statusRes.ok) continue;
          const statuses = (await statusRes.json()) as Array<{
            state: string;
            environment_url?: string;
          }>;
          const withUrl = statuses.find((s) => s.environment_url);
          if (withUrl?.environment_url) {
            return withUrl.environment_url;
          }
        }
      }
    } catch {
      // Network errors are fine — we'll retry
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return null;
}

function buildBypassedPreviewUrl(previewUrl: string): string | null {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!bypassSecret) return null;

  try {
    const url = new URL(previewUrl);
    url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
    url.searchParams.set("x-vercel-set-bypass-cookie", "true");
    return url.toString();
  } catch {
    return null;
  }
}

/** Return a preview URL that humans can open when deployment protection is enabled. */
export function getAccessiblePreviewUrl(previewUrl: string): string {
  return buildBypassedPreviewUrl(previewUrl) ?? previewUrl;
}

/** Stop a sandbox (safe to call if already stopped). */
export async function stopSandbox(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.stop();
  } catch {
    // May have already timed out
  }
}
