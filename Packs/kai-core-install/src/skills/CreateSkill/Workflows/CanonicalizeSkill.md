# CanonicalizeSkill Workflow

> **Trigger:** "canonicalize skill", "fix skill", "make skill compliant"

## Purpose

Fixes an existing skill to comply with SkillSystem.md requirements.

## Workflow Steps

### Step 1: Identify Target Skill

```bash
ls $PAI_DIR/skills/
```

### Step 2: Run Validation First

Execute ValidateSkill workflow to identify issues.

### Step 3: Fix Directory Naming

If directory isn't TitleCase:
```bash
# Example: rename 'my-skill' to 'MySkill'
mv $PAI_DIR/skills/my-skill $PAI_DIR/skills/MySkill
```

### Step 4: Fix SKILL.md Frontmatter

Ensure:
```yaml
---
name: TitleCaseName
description: [Single line]. USE WHEN [triggers]. [Additional info].
---
```

**Common fixes:**
- Convert multi-line description to single line
- Add missing USE WHEN clause
- Fix name to TitleCase

### Step 5: Add Missing Sections

If missing, add:

```markdown
## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **[WorkflowName]** | "[trigger]" | `Workflows/[WorkflowName].md` |

## Examples

**Example 1: [Use case]**
\`\`\`
User: "[Request]"
→ [Action]
→ [Result]
\`\`\`
```

### Step 6: Rename Files to TitleCase

```bash
# Workflows
mv Workflows/create.md Workflows/Create.md
mv Workflows/update-info.md Workflows/UpdateInfo.md

# Tools
mv Tools/my-tool.ts Tools/MyTool.ts
```

### Step 7: Ensure Directories Exist

```bash
mkdir -p $PAI_DIR/skills/[SkillName]/Tools
mkdir -p $PAI_DIR/skills/[SkillName]/Workflows
```

### Step 8: Regenerate Index

```bash
bun run $PAI_DIR/Tools/GenerateSkillIndex.ts
```

### Step 9: Re-validate

Run ValidateSkill workflow to confirm all issues resolved.

### Step 10: Offer Packaging

Ask the user: "Would you like to package this skill for export to Claude.ai?"

If yes:
```bash
bun run $PAI_DIR/tools/PackageSkill.ts [SkillName]
```

## Output

```
📋 SUMMARY: Canonicalized [SkillName] skill
⚡ ACTIONS:
  - Renamed directory to TitleCase
  - Fixed frontmatter description
  - Added Examples section
  - Renamed 3 workflow files
✅ RESULTS: Skill now compliant with SkillSystem.md
```
