# Sync Workflow

> **Trigger:** "sync branch", "pull changes", "update from main", "rebase on main"

## Purpose

Safely synchronize the current branch with the remote, handling uncommitted changes and conflicts.

## Workflow Steps

### Step 1: Check Current State

```bash
CURRENT_BRANCH=$(git branch --show-current)
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
git status --porcelain
```

### Step 2: Handle Uncommitted Changes

If there are uncommitted changes:
1. **Option A:** Stash them (see Stash workflow)
   ```bash
   git stash push -m "WIP before sync $(date +%Y-%m-%d_%H:%M)"
   ```
2. **Option B:** Commit them first (see Commit workflow)
3. **Option C:** Discard them (ask user for confirmation)

Record whether a stash was created for later restoration.

### Step 3: Fetch Latest

```bash
git fetch origin
```

### Step 4: Sync Strategy

**If syncing with remote tracking branch (same branch):**
```bash
git pull --rebase origin $CURRENT_BRANCH
```

**If syncing with default branch (main/master):**
```bash
git rebase origin/$DEFAULT_BRANCH
```

### Step 5: Handle Conflicts

If conflicts occur during rebase:

1. Show conflicted files:
   ```bash
   git diff --name-only --diff-filter=U
   ```

2. Help user resolve conflicts in each file

3. After resolution:
   ```bash
   git add [resolved-files]
   git rebase --continue
   ```

4. Or abort if user wants to bail:
   ```bash
   git rebase --abort
   ```

### Step 6: Restore Stashed Changes

If changes were stashed in Step 2:
```bash
git stash pop
```

If stash pop has conflicts, help user resolve them.

### Step 7: Verify

```bash
git log --oneline -5
git status
```

## Force Push After Rebase

If branch was already pushed and rebase rewrote history:
```bash
git push --force-with-lease origin $CURRENT_BRANCH
```

**Warning:** Always use `--force-with-lease` instead of `--force` to prevent overwriting others' work.

**Protected branch check:** NEVER force push to `main` or `master` without explicit user permission.

## Quick Sync (Pull Only)

For simple updates without rebase:
```bash
git pull origin $CURRENT_BRANCH
```

## Checklist

- [ ] Checked for uncommitted changes
- [ ] Stashed or committed changes if needed
- [ ] Fetched latest from remote
- [ ] Rebased or pulled as appropriate
- [ ] Resolved any conflicts
- [ ] Restored stashed changes
- [ ] Verified final state
- [ ] Force pushed with lease if needed
