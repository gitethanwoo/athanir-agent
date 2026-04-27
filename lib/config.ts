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
  /**
   * Include recent top-level Slack channel messages in new session prompts.
   * Useful for channels dedicated to one client/bot where users often follow up
   * outside a thread ("yeah on that page"). Keep disabled for shared/noisy rooms.
   */
  channelHistory?: boolean;
  channelHistoryMessageLimit?: number;
  channelHistoryCharLimit?: number;
}

const DEFAULT_CHANNEL_HISTORY_MESSAGE_LIMIT = 8;
const DEFAULT_CHANNEL_HISTORY_CHAR_LIMIT = 3_000;

const channelRepos: Record<string, RepoConfig> = {
  "slack:C0AR6AGTZED": {
    owner: "gitethanwoo",
    repo: "liquidportfolio",
    baseBranch: "main",
    githubTokenEnv: "GITHUB_TOKEN_DEFAULT",
    channelHistory: true,
  },
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

export function getChannelHistoryMessageLimit(config: RepoConfig): number {
  return Math.max(
    1,
    config.channelHistoryMessageLimit ?? DEFAULT_CHANNEL_HISTORY_MESSAGE_LIMIT
  );
}

export function getChannelHistoryCharLimit(config: RepoConfig): number {
  return Math.max(
    1_000,
    config.channelHistoryCharLimit ?? DEFAULT_CHANNEL_HISTORY_CHAR_LIMIT
  );
}
