# Athanir Agent

An AI agent that lets anyone — clients, teammates, stakeholders — make website updates through the chat tools they already use. No CMS login, no code review bottleneck, no waiting on a developer. Just ask in the channel.

A stakeholder says *"change the hero heading to Welcome to Freedom Missions"* in Slack, and the agent clones the repo, makes the edit, opens a PR with a preview deploy, and posts the link back. They review it visually, request tweaks in the same thread, and approve when it looks right. Nothing merges without human review.

## How it works

```
Stakeholder messages @bot in Slack
  → Vercel Sandbox spins up with the target repo
  → Claude makes the requested changes
  → Agent pushes a branch, opens a PR
  → Preview URL posted back to the thread
  → Follow-up messages in the same thread refine the change
  → PR merges when approved
```

The agent handles questions too. Ask *"what font are we using on the homepage?"* and it reads the code and answers — no PR, no branch, just an answer in the thread.

Sessions are durable. The sandbox stays alive across a conversation, so follow-ups build on previous changes instead of starting from scratch.

## Multi-client by design

This isn't tied to one project. Each Slack channel maps to a different GitHub repo. Invite a client as a Slack guest to their channel, and they can request changes to their site without touching anything else.

GitHub tokens are scoped per channel — a client's token only has access to their repo.

## Multi-platform intent

Slack is first, but the architecture supports any platform the [Vercel Chat SDK](https://github.com/vercel/chat) provides adapters for. The same bot logic works across Slack, Microsoft Teams, Google Chat, and others with minimal wiring — swap the adapter, point the webhook.

## Stack

- **Next.js** on Vercel — hosts the webhook endpoint
- **Chat SDK** (`chat` + `@chat-adapter/slack`) — normalizes platform events into threads and messages
- **Vercel Workflow** — durable multi-turn sessions that survive deploys
- **Vercel Sandbox** — ephemeral VMs where Claude reads and edits code safely
- **Claude Code** — runs inside the sandbox with full file access
- **GitHub API** — pushes branches and opens PRs

## Setup

```bash
bun install
```

Set environment variables in `.env.local` (or via `vercel env`):

```
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
GITHUB_TOKEN_DEFAULT=
VERCEL_AUTOMATION_BYPASS_SECRET=
```

In your Slack app, make sure the bot token has `files:read`. Without it, the agent can see that a file was attached but cannot download the contents. This is especially important in Slack Connect channels, where Slack may send file placeholders that must be resolved via `files.info` before download.

If you enable `channelHistory` for a Slack channel in `lib/config.ts`, the bot token also needs permission to call `conversations.history` for that channel. Add `channels:history` for public channels and/or `groups:history` for private channels, then reinstall the Slack app so the token receives the new scopes.

If your Vercel previews are protected, set `VERCEL_AUTOMATION_BYPASS_SECRET` so the bot can post preview links that open directly in a browser. Vercel documents this bypass mechanism for protected deployments and webhooks.

Add channel-to-repo mappings in `lib/config.ts`.

Deploy to Vercel and set your Slack app's Event Subscriptions URL to `https://<domain>/api/slack`.
