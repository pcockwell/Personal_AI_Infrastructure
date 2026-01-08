---
description: Compile captured learnings into actionable CLAUDE.md directives
allowed-tools: Read, Write, Edit, Glob, Bash(ls:*), Bash(cat:*), Bash(date:*)
model: sonnet
---

# Compile Learnings into CLAUDE.md

Process all learnings from `~/.claude/history/learnings/` and transform them into actionable directives for CLAUDE.md.

## Step 1: Load Tracking State

Read the tracking file to find last compilation timestamp:

```
~/.claude/history/.learnings-compiled.json
```

Expected format:
```json
{
  "last_compiled": "2025-01-07T10:30:00Z",
  "last_file_processed": "20250107T103000_LEARNING_some-topic.md",
  "directives_count": 12
}
```

If file doesn't exist, process ALL learnings (first run).

## Step 2: Find New Learnings

Scan all learning files in `~/.claude/history/learnings/` (recursively through YYYY-MM subdirectories).

Filter to files with filename timestamp AFTER `last_compiled` timestamp.

Learning files have format: `YYYYMMDDTHHMMSS_LEARNING_description.md`

## Step 3: Extract Actionable Content

For each new learning file, extract:

1. **The core insight** - What was learned?
2. **The trigger** - When does this apply?
3. **The action** - What should be done?

Parse the learning file structure:
- YAML frontmatter contains: capture_type, timestamp, session_id, executor, tags
- Body contains: problem description, solution, key takeaways

## Step 4: Categorize and Transform

Transform each learning into ONE directive in the appropriate category:

### Category: Tools
- Pattern: "PREFER [tool] for [use case]" or "USE [tool] when [condition]"
- Example: "PREFER `AskUserQuestion` tool when soliciting user feedback"

### Category: Workflows
- Pattern: "WHEN [trigger], DO [action]" or "WHEN [trigger]: [multi-step process]"
- Example: "WHEN user says 'collect a learning': Save to history/learnings/YYYY-MM/ with proper frontmatter"

### Category: Preferences
- Pattern: "FAVOR [approach] over [alternative]" or "KEEP [aspect] [quality]"
- Example: "FAVOR explicit confirmation over assumptions for destructive operations"

### Category: Insights
- Pattern: "NOTE: [observation about system behavior or limitations]"
- Example: "NOTE: Learning capture is one-way - compile regularly to incorporate"

## Step 5: Update CLAUDE.md

Read current `~/.claude/CLAUDE.md`.

For each category, find the markers and append new directives:
- `<!-- TOOLS_DIRECTIVES_START -->` ... `<!-- TOOLS_DIRECTIVES_END -->`
- `<!-- WORKFLOWS_DIRECTIVES_START -->` ... `<!-- WORKFLOWS_DIRECTIVES_END -->`
- `<!-- PREFERENCES_DIRECTIVES_START -->` ... `<!-- PREFERENCES_DIRECTIVES_END -->`
- `<!-- INSIGHTS_DIRECTIVES_START -->` ... `<!-- INSIGHTS_DIRECTIVES_END -->`

**Deduplication:** Before adding, check if a semantically similar directive exists. Skip duplicates.

**Update timestamp:** Replace the "Last compiled:" line with current datetime.

## Step 6: Update Tracking File

Write updated tracking state to `~/.claude/history/.learnings-compiled.json`:

```json
{
  "last_compiled": "[CURRENT_ISO_TIMESTAMP]",
  "last_file_processed": "[NEWEST_FILE_NAME]",
  "directives_count": [TOTAL_COUNT],
  "compilation_history": [
    {
      "timestamp": "[CURRENT_ISO_TIMESTAMP]",
      "files_processed": [COUNT],
      "directives_added": [COUNT]
    }
  ]
}
```

## Step 7: Report Results

Output summary:

```
Learnings Compilation Complete
==============================
Files scanned: X
New learnings found: Y
Directives added:
  - Tools: N
  - Workflows: N
  - Preferences: N
  - Insights: N

New directives:
- [List each new directive added]

CLAUDE.md updated at: ~/.claude/CLAUDE.md
```

## Error Handling

- If CLAUDE.md doesn't have markers, create the Compiled Directives section with markers
- If learnings directory doesn't exist, report "No learnings to compile"
- If a learning file is malformed, log warning and skip

## Quality Rules

1. **One directive per learning** - Condense to single actionable line
2. **Max 100 characters per directive** - Keep scannable
3. **Active voice** - "DO this" not "This should be done"
4. **Specific triggers** - "WHEN X" not "Sometimes"
5. **No duplicates** - Check semantic similarity before adding
