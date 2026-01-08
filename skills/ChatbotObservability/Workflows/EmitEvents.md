# EmitEvents Workflow

> **Trigger:** "emit events", "start session", "track tools", "chatbot observability"

## Purpose

Enable observability for chatbot sessions by emitting events that flow to Datadog via the PAI history system.

## Prerequisites

- `capture-all-events.ts` must be bundled with the skill (or available at `~/.claude/hooks/`)
- Node.js/npx available

## Session ID Convention

Session IDs for chatbot sessions use a collision-safe format:

```
{timestamp}-{uuid}-chatbot
```

**Derivation from transcript filename:**

Given: `2026-01-08-00-27-38-research-task.txt`
1. Strip dashes from timestamp: `20260108002738`
2. Generate 8-char UUID: `a1b2c3d4`
3. Append suffix: `20260108002738-a1b2c3d4-chatbot`

**Why this format:**
- Structurally different from CLI UUID v4 format
- UUID component prevents collisions between sessions with same timestamp
- `-chatbot` suffix clearly identifies the source

## Workflow Steps

### Step 1: Start Session

At the beginning of a conversation:

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts start \
  --transcript-file "2026-01-08-00-27-38-description.txt" \
  --queue-local
```

**Output:**
```json
{"session_id": "20260108002738-a1b2c3d4-chatbot", "session_file": "/Users/pcockwell/.claude/history/sessions/2026-01/20260108002738_CHATBOT-SESSION.md", "queued": true}
```

**What happens:**
1. SessionStart event queued to `/tmp/chatbot-pending-events.jsonl`
2. Session file created at `/Users/pcockwell/.claude/history/sessions/YYYY-MM/`

### Step 2: Emit Events (During Session)

All events use the unified `emit` command with `--event-type`.

**Required:** Add `--queue-local` to queue events for batch sync. This is required in chatbot container environments where bash writes don't reach the user's filesystem.

**Optional:** Add `--stdout-json` to output the full event JSON to stdout instead of the confirmation object.

#### Tool Events

Before and after significant tool invocations:

```bash
# Before tool execution
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit \
  --session-id "20260108002738-a1b2c3d4-chatbot" \
  --event-type PreToolUse \
  --tool-name WebSearch \
  --tool-input '{"query": "example"}' \
  --queue-local

# After tool execution
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit \
  --session-id "20260108002738-a1b2c3d4-chatbot" \
  --event-type PostToolUse \
  --tool-name WebSearch \
  --tool-response "Search completed with 10 results" \
  --queue-local
```

**Significant tools to track:**
- WebSearch
- WebFetch
- File operations (Read, Write, Edit)
- Task (subagent spawning)

#### Skill Invocation Events

When a skill's SKILL.md is first read in the session:

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit \
  --session-id "20260108002738-a1b2c3d4-chatbot" \
  --event-type SkillInvoked \
  --skill-name "git-workflow" \
  --skill-path "/mnt/skills/user/git-workflow/SKILL.md" \
  --skill-category "user" \
  --queue-local
```

**Output:**
```json
{"success": true, "event_type": "SkillInvoked", "skill_name": "GitWorkflow", "invocation_id": "abc-123-..."}
```

**Important:** Save the `invocation_id` for linking workflow events.

#### Workflow Triggered Events

When a workflow/reference file is read:

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit \
  --session-id "20260108002738-a1b2c3d4-chatbot" \
  --event-type WorkflowTriggered \
  --skill-name "git-workflow" \
  --workflow-name "commit" \
  --workflow-path "references/commit.md" \
  --invocation-id "abc-123-..." \
  --queue-local
```

**Output:**
```json
{"success": true, "event_type": "WorkflowTriggered", "skill_name": "GitWorkflow", "workflow_name": "Commit"}
```

**Skill Name Normalization:**

The chatbot uses kebab-case paths (`/mnt/skills/git-workflow/`) but PAI metrics use PascalCase (`GitWorkflow`). ChatbotSessionTelemetry.ts automatically normalizes:
- `git-workflow` → `GitWorkflow`
- `chatbot-observability` → `ChatbotObservability`
- `commit` → `Commit`

### Step 3: End Session

When the conversation ends:

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts end \
  --session-id "20260108002738-a1b2c3d4-chatbot" \
  --tools-used "WebSearch,Read,Write" \
  --summary "Researched API documentation and updated config file" \
  --queue-local
```

**What happens:**
1. Stop event queued to `/tmp/chatbot-pending-events.jsonl`
2. Session file updated with tools used and summary

## Event JSON Structure

Events are compatible with `pai_metrics.py` Datadog check:

```json
{
  "source_app": "claude-chatbot",
  "session_id": "20260108002738-a1b2c3d4-chatbot",
  "hook_event_type": "SessionStart",
  "payload": {
    "session_id": "20260108002738-a1b2c3d4-chatbot",
    "source_app": "claude-chatbot",
    "transcript_file": "2026-01-08-00-27-38-description.txt"
  },
  "timestamp": 1736321258000,
  "timestamp_local": "2026-01-08 00:27:38"
}
```

## Output Files

### Raw Events (for Datadog)

**CLI Sessions:**
Path: `/Users/pcockwell/.claude/history/raw-outputs/YYYY-MM/YYYY-MM-DD_all-events.jsonl`

**Chatbot Sessions:**
Path: `/Users/pcockwell/.claude/history/raw-outputs/YYYY-MM/YYYY-MM-DD_{session_id}.jsonl`
Example: `/Users/pcockwell/.claude/history/raw-outputs/2026-01/2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl`

Both file patterns are processed by `pai_metrics.py` (scans all `*.jsonl` files) and submitted to Datadog.

### Session Summaries

Path: `/Users/pcockwell/.claude/history/sessions/YYYY-MM/{timestamp}_CHATBOT-SESSION.md`

```markdown
---
capture_type: CHATBOT-SESSION
timestamp: 2026-01-08 00:27:38
session_id: 20260108002738-a1b2c3d4-chatbot
executor: claude-chatbot
transcript_file: 2026-01-08-00-27-38-description.txt
---

# Chatbot Session: description

**Session ID:** 20260108002738-a1b2c3d4-chatbot
**Started:** 2026-01-08 00:27:38
**Ended:** 2026-01-08 01:15:42

---

## Tools Used

- WebSearch
- Read
- Write

---

## Summary

Researched API documentation and updated config file

---

*Session captured by ChatbotObservability*
```

## Automatic Per-Request Emission

Events are automatically queued during each request and flushed before responding.

**Flow:**
1. User sends message
2. During processing: queue events with `--queue-local` (skills read, workflows triggered)
3. Before responding: flush pending events to local filesystem
4. Display response to user

**IMPORTANT: Do NOT start/end sessions automatically. Only queue events and flush per-request.**

## Datadog Metrics Generated

| Metric | Type | Tags |
|--------|------|------|
| `claude.skill.invoked` | COUNT | skill_name, skill_category, interface |
| `claude.skill.workflow.triggered` | COUNT | skill_name, workflow_name, interface |

**Interface tag values:**
- `claude-code` - CLI sessions (detected by UUID v4 session ID format)
- `chat-bot` - Chatbot sessions (detected by `-chatbot` suffix or `source_app: claude-chatbot`)

## Chatbot Container Workflow

**CRITICAL:** Claude.ai runs in an isolated container. Bash writes to `~/.claude/` stay in the container and don't reach the user's Mac. You MUST use `Filesystem:write_file` MCP tool to persist events.

### Recommended Pattern (--queue-local)

Use `--queue-local` to queue events during the conversation, then flush before responding:

```bash
# 1. Queue events during conversation
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit \
  --session-id "..." \
  --event-type SkillInvoked \
  --skill-name "git-workflow" \
  --skill-path "/mnt/skills/user/git-workflow/SKILL.md" \
  --queue-local

# 2. Before responding, flush events (see Workflows/FlushEvents.md)
```

### Alternative Pattern (--stdout-json)

Use `--stdout-json` to capture individual events and write them immediately:

```bash
# 1. Emit event with --stdout-json to capture full JSON
EVENT_JSON=$(TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit \
  --session-id "20260108002738-a1b2c3d4-chatbot" \
  --event-type SkillInvoked \
  --skill-name "git-workflow" \
  --skill-path "/mnt/skills/user/git-workflow/SKILL.md" \
  --stdout-json)

# 2. AI assistant writes $EVENT_JSON to session-specific file via Filesystem:write_file MCP:
#    /Users/pcockwell/.claude/history/raw-outputs/YYYY-MM/YYYY-MM-DD_{session_id}.jsonl
#    Example: /Users/pcockwell/.claude/history/raw-outputs/2026-01/2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl
```

### Output Format (--stdout-json)

When `--stdout-json` is used, the full event JSON is returned:

```json
{
  "source_app": "claude-chatbot",
  "session_id": "20260108002738-a1b2c3d4-chatbot",
  "hook_event_type": "SkillInvoked",
  "payload": {
    "session_id": "20260108002738-a1b2c3d4-chatbot",
    "source_app": "claude-chatbot",
    "skill_name": "GitWorkflow",
    "skill_path": "/mnt/skills/user/git-workflow/SKILL.md",
    "skill_category": "user",
    "invocation_id": "abc-123-..."
  },
  "timestamp": 1736321258000,
  "timestamp_local": "2026-01-08 00:27:38"
}
```

Without `--stdout-json`, only the confirmation object is returned:

```json
{"success": true, "event_type": "SkillInvoked", "skill_name": "GitWorkflow", "invocation_id": "abc-123-..."}
```

## Batch Event Sync Workflow (--queue-local)

For better performance, queue events during conversation and sync in batch before responding:

### Queuing Events

```bash
# Queue events instead of immediate output
npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \
  --skill-name "git-workflow" --skill-path "/mnt/skills/user/git-workflow/SKILL.md" --queue-local
```

Output: `{"queued": true, "event_type": "SkillInvoked", "skill_name": "GitWorkflow", ...}`

Events are accumulated in `/tmp/chatbot-pending-events.jsonl`.

### Pre-Response Sync

Before completing each response:

1. Get pending events:
   ```bash
   TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --dry-run
   ```

2. For each entry in `by_date`, write directly to session-specific file via `Filesystem:write_file` MCP:
   - Path: `/Users/pcockwell/.claude/history/raw-outputs/{year_month}/{target_file}`
   - Example: `/Users/pcockwell/.claude/history/raw-outputs/2026-01/2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl`
   - Content: JSONL (one event JSON per line)

3. Clear pending after success:
   ```bash
   TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --clear-pending
   ```

**Deduplication:** The `pai_metrics.py` Datadog check uses timestamp-based watermarking and event ID deduplication, so direct writes are safe.

See `Workflows/FlushEvents.md` for detailed sync instructions.
