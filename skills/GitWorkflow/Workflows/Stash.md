# Stash Workflow

> **Trigger:** "stash changes", "save for later", "pop stash", "list stashes"

## Purpose

Manage uncommitted changes by temporarily storing them in the git stash.

## Workflow Steps

### Stashing Changes

#### Step 1: Check for Changes

```bash
git status --porcelain
```

If no changes, inform user there's nothing to stash.

#### Step 2: Create Descriptive Stash

```bash
git stash push -m "[description] - [branch] - $(date +%Y-%m-%d_%H:%M)"
```

**Naming convention:**
- Include what the changes are for
- Include the branch name for context
- Include timestamp for ordering

Example: `"WIP auth refactor - pcockwell/add-user-auth - 2026-01-07_10:30"`

#### Step 3: Verify Stash Created

```bash
git stash list
git status
```

### Listing Stashes

```bash
git stash list
```

Output format: `stash@{N}: WIP on [branch]: [message]`

### Viewing Stash Contents

```bash
# Summary of changes in a stash
git stash show stash@{N}

# Full diff
git stash show -p stash@{N}
```

### Restoring Stashed Changes

#### Option A: Pop (apply and remove)

```bash
git stash pop stash@{N}
```

If `N` is omitted, uses most recent stash (`stash@{0}`).

#### Option B: Apply (apply but keep in stash)

```bash
git stash apply stash@{N}
```

Useful when applying the same changes to multiple branches.

### Handling Stash Conflicts

If `pop` or `apply` results in conflicts:

1. The stash is NOT removed (even with pop)
2. Resolve conflicts manually
3. After resolution:
   ```bash
   git add [resolved-files]
   git stash drop stash@{N}  # Only if using pop
   ```

### Dropping Stashes

```bash
# Drop specific stash
git stash drop stash@{N}

# Clear all stashes (use with caution)
git stash clear
```

**Always confirm before dropping or clearing stashes.**

### Creating Branch from Stash

To create a new branch and apply stash in one step:
```bash
git stash branch [branch-name] stash@{N}
```

This creates the branch from the commit where stash was created, then applies and drops the stash.

## Common Patterns

### Quick Save Before Switching Branches
```bash
git stash push -m "WIP before switching to [target-branch]"
git checkout [target-branch]
# ... do work ...
git checkout [original-branch]
git stash pop
```

### Partial Stash (Interactive)
```bash
git stash push -p -m "[description]"
```

Allows selecting specific hunks to stash.

### Stash Including Untracked Files
```bash
git stash push -u -m "[description]"
```

### Stash Including Ignored Files
```bash
git stash push -a -m "[description]"
```

## Checklist

- [ ] Verified changes exist to stash
- [ ] Created descriptive stash message
- [ ] Confirmed stash was created
- [ ] When popping: checked for conflicts
- [ ] When dropping: confirmed with user
