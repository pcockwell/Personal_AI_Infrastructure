# Branch Workflow

> **Trigger:** "create branch", "new branch", "switch branch", "checkout branch"

## Purpose

Create and manage branches following the naming convention: `[github-username]/[description]`

## MCP Tools Used

- `github-nobs/get_me` - Get authenticated user's GitHub username

## Workflow Steps

### Step 1: Get GitHub Username

Use MCP to get the authenticated user:
```
mcp-cli call github-nobs/get_me '{}'
```

Extract the `login` field for the username.

### Step 2: Determine Base Branch

Get the default branch:
```bash
git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'
```

Use default branch unless user explicitly requests a different base.

### Step 3: Create Branch Name

Format: `[GITHUB_USERNAME]/[description]`

**Description rules:**
- 2-6 words
- kebab-case (lowercase, hyphen-separated)
- Descriptive of the work being done

Examples:
- `pcockwell/add-dark-mode`
- `pcockwell/fix-login-redirect`
- `pcockwell/refactor-auth-service`

### Step 4: Ensure Clean State

```bash
git status --porcelain
```

If there are uncommitted changes:
- Offer to stash them (see Stash workflow)
- Or commit them first (see Commit workflow)
- Or carry them to the new branch (if compatible)

### Step 5: Fetch and Create Branch

```bash
git fetch origin
git checkout -b [username]/[description] origin/[base-branch]
```

### Step 6: Verify

```bash
git branch --show-current
git log -1 --oneline
```

## Switching Branches

When switching to an existing branch:

```bash
git checkout [branch-name]
```

If branch doesn't exist locally but exists on remote:
```bash
git fetch origin
git checkout -b [branch-name] origin/[branch-name]
```

## Listing Branches

```bash
git branch        # Local only
git branch -a     # All including remote
```

## Deleting Branches

```bash
# Local branch (safe - won't delete unmerged)
git branch -d [branch-name]

# Force delete local
git branch -D [branch-name]

# Remote branch
git push origin --delete [branch-name]
```

**Always confirm before deleting**, especially for remote branches.

## Checklist

- [ ] Retrieved GitHub username via MCP
- [ ] Identified base branch
- [ ] Created valid branch name (2-6 words, kebab-case)
- [ ] Handled uncommitted changes
- [ ] Created branch from correct base
- [ ] Verified on correct branch
