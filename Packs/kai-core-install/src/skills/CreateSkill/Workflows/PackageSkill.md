# PackageSkill Workflow

> **Trigger:** "package skill", "export skill", "create .skill file"

## Purpose

Packages a skill into .skill format (ZIP archive) for export to Claude.ai.

## Prerequisites

The skill must pass validation:
- `SKILL.md` exists with valid frontmatter
- `name` and `description` fields present
- Package size under 30 MB (before compression)

## Size Management

### Size Limits
- **Maximum:** 30 MB (before compression) - packaging blocked if exceeded
- **Warning:** 25 MB - packaging succeeds with warning

### Automatic Exclusions
The following are excluded by default:
- Dependencies: `node_modules/`, `vendor/`
- Build outputs: `dist/`, `build/`, `out/`
- Caches: `__pycache__/`, `.pytest_cache/`
- Secrets: `.env`, `*.pem`, `credentials.json`
- Lock files: `package-lock.json`, `yarn.lock`, `bun.lock`

### Custom Exclusions
Create `.skillignore` in the skill root:
```
# Comments start with #
large-data/
*.mp4
temp-files/
```

### Check Size Before Packaging
```bash
bun run $PAI_DIR/tools/PackageSkill.ts --validate-size [SkillName]
```

## Workflow Steps

### Step 1: Identify Target Skill

If not specified, list available skills:
```bash
bun run $PAI_DIR/tools/PackageSkill.ts --list
```

Ask the user which skill to package.

### Step 2: Validate Skill

Run validation to ensure the skill is ready for packaging:
```bash
bun run $PAI_DIR/tools/PackageSkill.ts --validate [SkillName]
```

If validation fails, suggest running:
```
Canonicalize the [SkillName] skill
```

### Step 3: Package Skill

```bash
bun run $PAI_DIR/tools/PackageSkill.ts [SkillName]
```

Or with custom output directory:
```bash
bun run $PAI_DIR/tools/PackageSkill.ts [SkillName] --output ~/Downloads
```

### Step 4: Report Output

Provide the location of the created .skill file.

## Batch Packaging

To package all skills at once:
```bash
bun run $PAI_DIR/tools/PackageSkill.ts --all
```

## Output

```
📦 PACKAGED: [SkillName].skill
📍 LOCATION: ~/.claude/exports/[SkillName].skill
```

## Directory Mapping

When packaging, directories are mapped to Agent Skills format:

| PAI Structure | .skill Structure |
|---------------|-----------------|
| `Tools/` | `scripts/` |
| `Workflows/` | `references/` |
| `Contexts/` | `references/` |
| `Templates/` | `assets/` |
| `Data/` | `assets/` |
| `*.md` (root) | `references/` |
