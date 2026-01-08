---
name: ChatbotObservability
description: Emit PAI events from chatbot sessions to Datadog. USE WHEN chatbot observability, emit events, track session, log tool use.
---

# ChatbotObservability

Enables observability for chatbot sessions by emitting events to the PAI history system, which are then processed by Datadog.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **EmitEvents** | "emit events", "start session", "track tools" | `Workflows/EmitEvents.md` |
| **FlushEvents** | "flush events", "sync events to local" | `Workflows/FlushEvents.md` |

## Session ID Convention

Session IDs for chatbot sessions use a collision-safe format:

```
{timestamp}-{uuid}-chatbot
```

Example: `20260108002738-a1b2c3d4-chatbot`

**Components:**
- `timestamp`: Derived from transcript filename (YYYYMMDDHHMMSS)
- `uuid`: 8-character unique identifier
- `chatbot`: Suffix identifying source

**No collision with CLI sessions:** CLI sessions use UUID v4 format (e.g., `fbeb5e0e-aad2-4d3a-8ebb-e8b61766b5ab`), which is structurally different.

## Commands

All commands use `npx tsx ChatbotSessionTelemetry.ts`:

### start - Begin a session
```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts start --transcript-file "YYYY-MM-DD-HH-MM-SS-description.txt" --queue-local
```

### emit - Emit any event type
```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id <id> --event-type <type> [options]
```

**Event types:** `PreToolUse`, `PostToolUse`, `SkillInvoked`, `WorkflowTriggered`

**Options:**
- `--stdout-json` - Output full event JSON to stdout (for chatbot workflows that need to write events locally)
- `--queue-local` - Queue event to temp file for batch sync (use with `flush` command)

Run `npx tsx ChatbotSessionTelemetry.ts emit --help` for detailed options.

### flush - Manage pending events

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush [--dry-run | --clear-pending]
```

**Options:**
- `--dry-run` - Show pending events grouped by date for AI sync
- `--clear-pending` - Clear pending events after successful sync

### end - End a session
```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts end --session-id <id> [--tools-used "..."] [--summary "..."] --queue-local
```

## Automatic Event Emission (Per-Request)

Events are automatically queued during request processing and flushed before each response.

**IMPORTANT: Do NOT start/end sessions automatically. Only queue events and flush per-request.**

### During Request Processing

When reading skill or workflow files, automatically queue the event:

```bash
# When a skill's SKILL.md is read
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \
  --skill-name "git-workflow" \
  --skill-path "/mnt/skills/user/git-workflow/SKILL.md" \
  --queue-local

# When a workflow/reference file is read
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type WorkflowTriggered \
  --skill-name "git-workflow" \
  --workflow-name "commit" \
  --workflow-path "references/commit.md" \
  --invocation-id "uuid-from-skill-invoked" \
  --queue-local
```

### Before Outputting Response (FlushEvents Workflow)

**CRITICAL:** Claude.ai runs in an isolated container. Bash writes to `~/.claude/` stay in the container and don't reach the user's Mac. You MUST use `Filesystem:write_file` MCP tool to persist events.

**Always flush pending events before displaying your response to the user:**

1. **Get pending events:**
   ```bash
   TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --dry-run
   ```

2. **If `pending_count` > 0, for each entry in `by_date`:**
   - Each entry includes `session_id` and `target_file` (e.g., `2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl`)
   - Build JSONL content from the `events` array (one JSON object per line)
   - Write directly via `Filesystem:write_file` to `/Users/pcockwell/.claude/history/raw-outputs/{year_month}/{target_file}`
   - **Note:** Session-specific files mean we can safely overwrite; timestamp watermarking in pai_metrics.py prevents duplicate event processing

3. **Clear the queue:**
   ```bash
   TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --clear-pending
   ```

See `Workflows/FlushEvents.md` for detailed instructions.

## Skill Name Normalization

The chatbot uses **kebab-case** skill names in `/mnt/skills/`:
- `/mnt/skills/git-workflow/SKILL.md`
- `/mnt/skills/chatbot-observability/SKILL.md`

But PAI metrics use **PascalCase**:
- `GitWorkflow`
- `ChatbotObservability`

**ChatbotSessionTelemetry.ts automatically normalizes** kebab-case to PascalCase when emitting events, so metrics match between CLI and chatbot sessions.

## Examples

**Example 1: Start a chatbot session**
```
User: [Opens new conversation in Claude.ai]
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts start --transcript-file "2026-01-08-00-27-38-research-task.txt" --queue-local
→ Output: {"session_id": "20260108002738-a1b2c3d4-chatbot", "queued": true}
→ Session file created at /Users/pcockwell/.claude/history/sessions/2026-01/
```

**Example 2: Track a tool invocation**
```
User: [Uses WebSearch tool]
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type PreToolUse --tool-name WebSearch --queue-local
→ [Tool executes]
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type PostToolUse --tool-name WebSearch --queue-local
```

**Example 3: End a session**
```
User: [Conversation ends]
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts end --session-id "..." --tools-used "WebSearch,Read" --summary "Researched API docs" --queue-local
→ Session file updated with tools and summary
→ Stop event queued (flush with Filesystem:write_file MCP to persist)
```

**Example 4: Track skill invocation**
```
User: [Reads /mnt/skills/git-workflow/SKILL.md]
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \
    --skill-name "git-workflow" --skill-path "/mnt/skills/user/git-workflow/SKILL.md" --queue-local
→ Output: {"success": true, "skill_name": "GitWorkflow", "invocation_id": "abc-123-..."}
→ SkillInvoked event queued (normalized to PascalCase)
```

**Example 5: Track workflow trigger**
```
User: [Reads /mnt/skills/git-workflow/references/commit.md]
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type WorkflowTriggered \
    --skill-name "git-workflow" --workflow-name "commit" \
    --workflow-path "references/commit.md" --invocation-id "abc-123-..." --queue-local
→ Output: {"success": true, "skill_name": "GitWorkflow", "workflow_name": "Commit"}
→ WorkflowTriggered event queued (normalized to PascalCase)
```

**Example 6: Chatbot workflow with --stdout-json**
```
# In Claude.ai chatbot (isolated container), capture full event JSON for local file write
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \
    --skill-name "git-workflow" --skill-path "/mnt/skills/user/git-workflow/SKILL.md" --stdout-json
→ Output: {"source_app":"claude-chatbot","session_id":"...","hook_event_type":"SkillInvoked","payload":{...},"timestamp":...,"timestamp_local":"..."}
→ AI assistant captures this JSON and writes it to user's local /Users/pcockwell/.claude/history/raw-outputs/ via Filesystem:write_file MCP
```

**Example 7: Batch event sync with --queue-local and flush**
```
# Queue events during conversation
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts emit --session-id "..." --event-type SkillInvoked \
    --skill-name "git-workflow" --skill-path "/mnt/skills/user/git-workflow/SKILL.md" --queue-local
→ Output: {"queued": true, "event_type": "SkillInvoked", "skill_name": "GitWorkflow", ...}
→ Event appended to /tmp/chatbot-pending-events.jsonl

# Before response, flush pending events
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --dry-run
→ Output: {"pending_count": 3, "by_date": [...]}
→ AI syncs events to /Users/pcockwell/.claude/history/raw-outputs/ via Filesystem:write_file MCP

# After successful sync, clear pending
→ Run: TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --clear-pending
→ Output: {"cleared": true}
```
