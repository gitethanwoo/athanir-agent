/**
 * Channel-to-repo mapping. Maps Slack channel IDs to the GitHub repo
 * the agent should operate on when receiving messages from that channel.
 *
 * Each channel gets its own GitHub token (env var name) so tokens are
 * scoped to a single repo per client.
 *
 * For DMs, falls back to `defaultRepo`.
 */

export interface RepoConfig {
  owner: string;
  repo: string;
  baseBranch: string;
  githubTokenEnv: string; // name of the env var, e.g. "GITHUB_TOKEN_ACME"
}

const channelRepos: Record<string, RepoConfig> = {
  "slack:C0AR6AGTZED": { owner: "gitethanwoo", repo: "liquidportfolio", baseBranch: "main", githubTokenEnv: "GITHUB_TOKEN_DEFAULT" },
};

const defaultRepo: RepoConfig | null = null;

export function getRepoForChannel(channelId: string): RepoConfig | null {
  return channelRepos[channelId] ?? defaultRepo;
}

export function getGitHubToken(config: RepoConfig): string {
  const token = process.env[config.githubTokenEnv];
  if (!token) {
    throw new Error(`Missing env var ${config.githubTokenEnv}`);
  }
  return token;
}
