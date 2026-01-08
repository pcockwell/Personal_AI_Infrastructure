# CreateSkill Workflow

> **Trigger:** "create a new skill", "make a skill for", "I need a skill that"

## Purpose

Creates a new skill following the mandatory structure defined in SkillSystem.md.

## Prerequisites

1. Read `$PAI_DIR/skills/CORE/SkillSystem.md` for authoritative structure
2. Understand the user's requirements for the new skill

## Workflow Steps

### Step 1: Gather Requirements

Ask the user (if not provided):
- What should the skill do?
- What triggers should activate it?
- What workflows does it need?

### Step 1.5: Evaluate Deterministic Tooling

Ask: "Does this skill involve parsing, transforming, or processing structured data?"

**If YES**, design deterministic tool(s) first:
- Create TypeScript tool in `Tools/` directory
- Tool handles parsing/transformation deterministically
- Workflow then interprets tool output and adds semantic analysis

**Benefits of tool-first approach:**
- Saves AI tokens (no manual parsing)
- Testable (pure functions)
- Reusable (CLI invocable independently)
- Consistent output (same input → same output)

**Examples of skills that need tools:**
- Parsing XML, JSON, YAML files
- Transforming data formats
- Extracting structure from documents
- Validation/linting operations

### Step 2: Create Directory Structure

```bash
SKILL_NAME="[TitleCaseSkillName]"
mkdir -p $PAI_DIR/skills/$SKILL_NAME/Workflows
mkdir -p $PAI_DIR/skills/$SKILL_NAME/Tools
```

### Step 3: Create SKILL.md

Create `$PAI_DIR/skills/$SKILL_NAME/SKILL.md` with:

```markdown
---
name: [TitleCaseSkillName]
description: [What it does]. USE WHEN [trigger words OR separated]. [Additional capabilities].
---

# [TitleCaseSkillName]

[Brief description of the skill]

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **[WorkflowName]** | "[trigger phrase]" | `Workflows/[WorkflowName].md` |

## Examples

**Example 1: [Use case]**
\`\`\`
User: "[Example request]"
→ [What happens]
→ [Result]
\`\`\`

**Example 2: [Use case]**
\`\`\`
User: "[Example request]"
→ [What happens]
→ [Result]
\`\`\`
```

### Step 4: Create Initial Workflows

For each workflow in the routing table, create:
- `$PAI_DIR/skills/$SKILL_NAME/Workflows/[WorkflowName].md`

### Step 5: Regenerate Skill Index

```bash
bun run $PAI_DIR/Tools/GenerateSkillIndex.ts
```

### Step 6: Verify

```bash
bun run $PAI_DIR/Tools/SkillSearch.ts [skill-name]
```

### Step 7: Offer Packaging

Ask the user: "Would you like to package this skill for export to Claude.ai?"

If yes:
```bash
bun run $PAI_DIR/tools/PackageSkill.ts [SkillName]
```

## Checklist

- [ ] Directory uses TitleCase
- [ ] SKILL.md has valid frontmatter
- [ ] Description includes USE WHEN clause
- [ ] Evaluated if deterministic tooling is needed
- [ ] If yes: Tool created before workflow
- [ ] Workflow Routing section exists
- [ ] Examples section has 2-3 patterns
- [ ] All workflow files created
- [ ] Index regenerated
- [ ] Offered packaging option
