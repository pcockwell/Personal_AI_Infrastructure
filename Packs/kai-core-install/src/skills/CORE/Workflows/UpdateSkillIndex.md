# UpdateSkillIndex Workflow

> **Trigger:** "update skill index", "regenerate skill index", "rebuild skills", "refresh skills"

## Purpose

Regenerates the skill-index.json by scanning all SKILL.md files and extracting metadata, triggers, and workflows.

## When This Runs

### Manual Invocation
- User says "update skill index"
- User says "regenerate skill index"
- User says "rebuild skills"

### Automatic Invocation
**This workflow SHOULD run after:**
- Creating a new skill
- Modifying a skill's frontmatter or triggers
- Deleting or renaming a skill

## Workflow Steps

### Step 1: Run the Index Generator

```bash
bun run $PAI_DIR/Tools/GenerateSkillIndex.ts
```

### Step 2: Verify Output

Confirm the index was generated at `$PAI_DIR/skills/skill-index.json`.

### Step 3: Report Results

Output summary showing:
- Total skills indexed
- Always-loaded vs deferred counts
- Any skills skipped (indexed: false)

## Example Output

```
📋 SUMMARY: Regenerated skill index
⚡ ACTIONS:
  - Scanned skills directory
  - Parsed SKILL.md frontmatter
  - Extracted triggers and workflows
✅ RESULTS: skill-index.json updated
   Total: 8 skills (3 always loaded, 5 deferred)
```
