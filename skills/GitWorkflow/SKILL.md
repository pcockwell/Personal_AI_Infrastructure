---
name: GitWorkflow
description: Git branching strategies and commit protection. USE WHEN creating branches OR committing changes OR pushing code OR preparing PRs OR syncing with remote OR managing stashes. Enforces branch naming ([github-username]/[description]) and protects main/master.
---

# GitWorkflow

Manages Git operations with branch protection, naming conventions, and safe workflows.

## Branch Naming Convention

Format: `[GITHUB_USERNAME]/[description]`

- **GITHUB_USERNAME**: User's GitHub username (retrieve via `gh api user -q .login` or ask)
- **description**: 2-6 words, kebab-case, describing the work

Examples: `pcockwell/add-user-auth`, `pcockwell/fix-login-redirect-bug`

## Protected Branches

These branches require explicit user permission for ANY write operation:
- `main`
- `master`
- Any branch with GitHub protection rules

**Before writing to protected branches:** Always ask for confirmation.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Commit** | "commit changes", "save my work" | `Workflows/Commit.md` |
| **Branch** | "create branch", "new branch", "switch branch" | `Workflows/Branch.md` |
| **PR** | "create PR", "prepare pull request", "open PR" | `Workflows/PR.md` |
| **Sync** | "sync branch", "pull changes", "update from main" | `Workflows/Sync.md` |
| **Stash** | "stash changes", "save for later", "pop stash" | `Workflows/Stash.md` |

## Examples

**Example 1: Create a new feature branch**
```
User: "Create a branch for adding dark mode"
-> Invokes Branch workflow
-> Gets GitHub username (pcockwell)
-> Creates: pcockwell/add-dark-mode
-> Switches to new branch
```

**Example 2: Commit with protection check and push prompt**
```
User: "Commit these changes"
-> Invokes Commit workflow
-> Checks current branch (main)
-> Asks for confirmation (protected branch)
-> User confirms -> proceeds with commit
-> Asks "Would you like to push?"
-> User confirms -> pushes to remote
```

**Example 3: Sync feature branch with main**
```
User: "Update my branch from main"
-> Invokes Sync workflow
-> Stashes uncommitted changes (if any)
-> Fetches and rebases from origin/main
-> Restores stashed changes
```
