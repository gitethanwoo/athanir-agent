# Axiom OTel Observability — DONE

Wired in commit 5dc0d44. Env vars (`AXIOM_TOKEN`, `AXIOM_DATASET`) set in Vercel for production and development. Will start logging on next deploy.

**TODO:** Rotate the Axiom token (it was exposed in a conversation).

---

# Agent Browser Verification

## Goal
Let Claude Code verify its own visual/UI changes by starting a dev server and screenshotting with `agent-browser` before declaring done.

## Status
- System prompt instructions added (commit pending)
- Sandbox snapshot needs updating to include agent-browser + Chromium

## What's needed

### 1. New sandbox snapshot
The current snapshot (`snap_7mhOzyonNr8voAi0sUqqXuvaxKka`) has Claude Code pre-installed but no browser. Need to build a new snapshot with:
- Chromium (headless)
- `agent-browser` CLI (`npm i -g agent-browser`)
- Possibly `xvfb` or similar if Chromium needs a display server

Steps:
1. Create a sandbox from the current snapshot
2. Install Chromium + agent-browser inside it
3. Snapshot the result
4. Update `BASE_SNAPSHOT_ID` in `lib/agent.ts`

### 2. System prompt (done)
Already added instructions telling Claude to:
1. Start dev server in background after visual changes
2. Use `agent-browser open ... && agent-browser screenshot`  
3. Read the screenshot to visually verify
4. Fix and re-verify if something looks wrong
5. Skip for non-visual changes

### 3. Test
- Trigger a visual change request via Slack ("change the heading to Welcome")
- Confirm Claude starts the dev server, screenshots, and self-corrects if needed
- Check that the dev server is killed before the session ends

## Open questions
- Does the sandbox have network access to `localhost` within itself? (almost certainly yes)
- What port will the dev server use? Varies by project — the prompt says 3000 but Claude should detect from package.json
- Memory: Chromium is hungry. May need to bump sandbox resources from 4 vCPU if OOM.
