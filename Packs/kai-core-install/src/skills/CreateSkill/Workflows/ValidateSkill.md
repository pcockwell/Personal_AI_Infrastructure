# ValidateSkill Workflow

> **Trigger:** "validate skill", "check skill structure", "is this skill valid"

## Purpose

Validates an existing skill against the requirements in SkillSystem.md.

## Workflow Steps

### Step 1: Identify Target Skill

Ask for or identify the skill to validate:
```bash
ls $PAI_DIR/skills/
```

### Step 2: Read SkillSystem.md Requirements

```bash
cat $PAI_DIR/skills/CORE/SkillSystem.md
```

### Step 3: Validate Structure

Check the following:

#### Directory Structure
- [ ] Skill directory uses TitleCase
- [ ] `SKILL.md` exists
- [ ] `Tools/` directory exists (even if empty)
- [ ] `Workflows/` directory exists (if workflows defined)

#### SKILL.md Frontmatter
- [ ] Has valid YAML frontmatter (---...---)
- [ ] `name:` field uses TitleCase
- [ ] `description:` is single-line (not multi-line with |)
- [ ] `description:` includes USE WHEN clause
- [ ] `description:` is under 1024 characters

#### SKILL.md Body
- [ ] Has `## Workflow Routing` section with table
- [ ] Has `## Examples` section with 2-3 patterns
- [ ] All referenced workflow files exist

#### File Naming
- [ ] All workflow files use TitleCase (e.g., `CreateProject.md`)
- [ ] All tool files use TitleCase (e.g., `ToolName.ts`)

### Step 4: Check Package Size (Warning Only)

Check estimated package size:

```bash
bun run $PAI_DIR/tools/PackageSkill.ts --validate-size [SkillName]
```

#### Size Thresholds
- **< 25 MB**: Good (no action needed)
- **25-30 MB**: Warning (consider optimization)
- **> 30 MB**: Will block packaging (must create .skillignore)

#### If Size Warning Appears
The tool will offer to generate a `.skillignore` file with recommended patterns.
Accept or customize as needed.

### Step 5: Report Results

Output validation results:

```
✅ VALID: [item]
❌ INVALID: [item] - [reason]
⚠️ WARNING: [item] - [suggestion]
```

### Step 6: Suggest Fixes

If issues found, suggest running:
```
Canonicalize the [SkillName] skill
```
