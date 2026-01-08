# Commit Workflow

> **Trigger:** "commit changes", "save my work", "commit this"

## Purpose

Safely commit changes with branch protection verification.

## Workflow Steps

### Step 1: Verify Current Branch

```bash
CURRENT_BRANCH=$(git branch --show-current)
echo "Current branch: $CURRENT_BRANCH"
```

### Step 2: Check Branch Protection

If `$CURRENT_BRANCH` is `main`, `master`, or a known protected branch:
- **STOP** and ask user for explicit confirmation
- Explain the risk of committing directly to protected branches
- Suggest creating a feature branch instead

### Step 3: Review Changes

```bash
git status
git diff --staged
```

If no staged changes:
```bash
git diff  # Show unstaged changes
```

Ask user what to stage, or stage all with `git add -A` if requested.

### Step 4: Create Commit

```bash
git commit -m "$(cat <<'EOF'
[Commit message here]

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

**Commit message guidelines:**
- First line: imperative mood, max 50 chars (e.g., "Add user authentication")
- Blank line after subject
- Body: explain why, not what (code shows what)

### Step 5: Verify Commit

```bash
git log -1 --oneline
git status
```

### Step 6: Offer to Push

After successful commit, ask the user if they want to push:

**Use AskUserQuestion:**
- Question: "Would you like to push this commit to the remote?"
- Options:
  - "Yes, push now" - Push to origin
  - "No, I'll push later" - End workflow

If user selects "Yes":

First, check if remote branch exists:
```bash
git ls-remote --heads origin $(git branch --show-current)
```

If remote branch exists:
```bash
git push origin $(git branch --show-current)
```

If remote branch doesn't exist (set upstream):
```bash
git push -u origin $(git branch --show-current)
```

Verify push success:
```bash
git status
```

## Amend Rules

Only use `git commit --amend` when ALL conditions are met:
1. User explicitly requested amend
2. HEAD commit was created in this session (verify: `git log -1 --format='%an %ae'`)
3. Commit has NOT been pushed to remote (verify: `git status` shows "Your branch is ahead")

If already pushed, create a new commit instead.

## Checklist

- [ ] Verified current branch
- [ ] Checked if branch is protected
- [ ] Got user confirmation for protected branches
- [ ] Staged appropriate changes
- [ ] Wrote descriptive commit message
- [ ] Verified commit succeeded
- [ ] Offered to push changes
- [ ] Pushed if user confirmed
