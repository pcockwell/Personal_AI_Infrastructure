---
name: CreateSkill
description: Create and validate skills. USE WHEN create skill, new skill, skill structure, canonicalize. SkillSearch('createskill') for docs.
---

# CreateSkill

MANDATORY skill creation framework for ALL skill creation requests.

## Authoritative Source

**Before creating ANY skill, READ:** `$PAI_DIR/skills/CORE/SkillSystem.md`

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **CreateSkill** | "create a new skill" | `Workflows/CreateSkill.md` |
| **ValidateSkill** | "validate skill" | `Workflows/ValidateSkill.md` |
| **CanonicalizeSkill** | "canonicalize", "fix skill" | `Workflows/CanonicalizeSkill.md` |
| **PackageSkill** | "package skill", "export skill" | `Workflows/PackageSkill.md` |

## Examples

**Example 1: Create a new skill**
```
User: "Create a skill for managing my recipes"
→ Invokes CreateSkill workflow
→ Reads SkillSystem.md for structure
→ Creates skill with TitleCase naming
```

**Example 2: Fix an existing skill**
```
User: "Canonicalize the daemon skill"
→ Invokes CanonicalizeSkill workflow
→ Renames files to TitleCase
→ Ensures Examples section exists
```

**Example 3: Validate skill structure**
```
User: "Validate the Art skill"
→ Invokes ValidateSkill workflow
→ Checks against SkillSystem.md requirements
→ Reports any issues found
```
