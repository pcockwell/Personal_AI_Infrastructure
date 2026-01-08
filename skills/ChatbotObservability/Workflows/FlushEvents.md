# FlushEvents Workflow

> **Trigger:** "flush events", "sync events to local", "before response sync"

## Purpose

Sync pending events from container temp file to user's local filesystem via `Filesystem:write_file` MCP tool.

**IMPORTANT:** Claude.ai runs in an isolated container. Files written via bash to `~/.claude/` stay in the container and don't reach the user's Mac. You MUST use the `Filesystem:write_file` MCP tool to persist data to the user's actual filesystem.

## When to Use

Before completing any response where events were queued with `--queue-local`.

## Workflow Steps

### Step 1: Get Pending Events

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --dry-run
```

**Output:**
```json
{
  "pending_count": 3,
  "by_date": [
    {
      "date": "2026-01-08",
      "year_month": "2026-01",
      "session_id": "20260108002738-a1b2c3d4-chatbot",
      "target_file": "2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl",
      "events": [...],
      "event_ids": ["uuid-1", "uuid-2", "uuid-3"]
    }
  ]
}
```

If `pending_count` is 0, skip remaining steps.

**Note:** Events are grouped by date AND session_id. Each session writes to its own unique file.

### Step 2: Write Events to Local Filesystem

For each entry in `by_date`:

1. **Build JSONL content** from the `events` array (one JSON object per line)
2. **Write directly** via `Filesystem:write_file` MCP tool:

```
Filesystem:write_file
Path: /Users/pcockwell/.claude/history/raw-outputs/{year_month}/{target_file}
Content: {events as JSONL}
```

Example path: `/Users/pcockwell/.claude/history/raw-outputs/2026-01/2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl`

**Note:** Since each session has a unique file, we can safely overwrite the entire file. The `pai_metrics.py` Datadog check uses timestamp-based watermarking to avoid re-processing old events, so overwriting is safe.

### Step 3: Clear Pending Events

After all files written successfully:

```bash
TIME_ZONE=America/Los_Angeles npx tsx ChatbotSessionTelemetry.ts flush --clear-pending
```

### Step 4: Report to User

Display sync summary:

```
📊 Synced 3 events to local history
   → 2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl (3 events)
```

Or if nothing to sync:
```
📊 No new events to sync
```

## Error Handling

| Scenario | Action |
|----------|--------|
| `pending_count: 0` | Skip sync, no message |
| Filesystem write fails | Don't clear pending, report error |

## Duplicate Protection

The system protects against duplicate event processing in two ways:

1. **Session-specific files** - Each chatbot session writes to its own file (`{date}_{session_id}.jsonl`), so concurrent sessions never conflict.

2. **Timestamp watermarking** - The `pai_metrics.py` Datadog check tracks the last processed event timestamp. Events at or before the watermark are skipped, so even if a file is re-written, old events won't be counted twice.

## Session-Specific Files

Events are written to session-specific files:
```
/Users/pcockwell/.claude/history/raw-outputs/YYYY-MM/YYYY-MM-DD_{session_id}.jsonl
```

Example: `/Users/pcockwell/.claude/history/raw-outputs/2026-01/2026-01-08_20260108002738-a1b2c3d4-chatbot.jsonl`

**Why session-specific files:**
- Prevents concurrent chatbot sessions from overwriting each other
- Simple direct-write pattern (no read-merge-write complexity)
- The `pai_metrics.py` Datadog check scans all `*.jsonl` files in the raw-outputs directory
