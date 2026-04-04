# Axiom OTel Observability

## Goal
Wire Claude Code's built-in OpenTelemetry into Axiom so we can see what the agent is doing inside the sandbox — every file read, edit, bash command, token usage, and cost.

## Setup
1. Create Axiom account + dataset (e.g. `athanir-traces`)
2. Generate API token with ingest permissions
3. Add to Vercel env vars:
   - `AXIOM_TOKEN` — API token
   - `AXIOM_DATASET` — dataset name (e.g. `athanir-traces`)

## Code Changes

### `lib/agent.ts` — `runClaude`
Add OTel env vars to the Claude Code process, opt-in when Axiom is configured:

```typescript
const otelEnv = process.env.AXIOM_TOKEN
  ? {
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.axiom.co",
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${process.env.AXIOM_TOKEN},X-Axiom-Dataset=${process.env.AXIOM_DATASET}`,
    }
  : {};
```

Then spread into the runCommand env:
```typescript
env: {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  ...otelEnv,
},
```

### Optional: Enhanced traces (beta)
For full distributed tracing with span waterfalls, also add:
```typescript
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
OTEL_TRACES_EXPORTER: "otlp",
```

## What You'll See in Axiom
- `claude_code.tool_result` — every Read, Edit, Write, Bash, Glob, Grep with file paths, duration, success/failure
- `claude_code.api_request` — each API call with model, token counts
- `claude_code.cost.usage` — USD cost per request
- `claude_code.token.usage` — input/output/cache token counts
- `claude_code.session.count` — sessions started

Filter by session ID to see the full trace of what the agent did for a given Slack thread.

## Nice-to-haves (later)
- Pass Slack thread ID as a resource attribute so you can correlate traces to conversations
- Axiom dashboard with cost per session, avg tool calls per turn, error rates
- Alerts on failures or cost spikes
