# PR Workflow

> **Trigger:** "create PR", "prepare pull request", "open PR", "submit PR"

## Purpose

Create pull requests using the GitHub MCP with proper templates and review setup.

## MCP Tools Used

- `github-nobs/get_me` - Get authenticated user info
- `github-nobs/create_pull_request` - Create the PR
- `github-nobs/search_code` - Find PR templates
- `github-nobs/get_file_contents` - Read PR template content

## Workflow Steps

### Step 1: Verify Branch State

```bash
CURRENT_BRANCH=$(git branch --show-current)
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
```

**Protected branch check:** If on `main` or `master`, warn user and suggest creating a feature branch first.

### Step 2: Ensure Changes are Pushed

```bash
git status
```

If there are unpushed commits:
```bash
git push -u origin [current-branch]
```

### Step 3: Get Repository Info

```bash
# Extract owner and repo from remote
REMOTE_URL=$(git remote get-url origin)
# Parse to get owner and repo name
```

### Step 4: Check for PR Template

Search for PR template in the repository:
```
mcp-cli call github-nobs/get_file_contents '{"owner": "[owner]", "repo": "[repo]", "path": ".github/PULL_REQUEST_TEMPLATE.md"}'
```

Also check:
- `.github/PULL_REQUEST_TEMPLATE/` directory
- `docs/PULL_REQUEST_TEMPLATE.md`
- `PULL_REQUEST_TEMPLATE.md` (root)

### Step 5: Gather PR Information

Analyze commits on branch:
```bash
git log $DEFAULT_BRANCH..HEAD --oneline
git diff $DEFAULT_BRANCH...HEAD --stat
```

### Step 6: Create Pull Request via MCP

```
mcp-cli call github-nobs/create_pull_request '{
  "owner": "[owner]",
  "repo": "[repo]",
  "title": "[PR title]",
  "head": "[current-branch]",
  "base": "[default-branch]",
  "body": "[PR description following template]",
  "draft": false
}'
```

**PR Title:** Use imperative mood, max 72 chars (e.g., "Add user authentication flow")

**PR Body Structure** (if no template):
```markdown
## Summary
[1-3 bullet points describing the change]

## Test plan
- [ ] [Testing steps]

🤖 Generated with [Claude Code](https://claude.ai/code)
```

### Step 7: Return PR URL

Extract and display the PR URL from the response so user can review.

## Draft PRs

For work-in-progress, set `"draft": true` in the create call.

## Updating Existing PRs

Use `github-nobs/update_pull_request` to modify title, body, or state:
```
mcp-cli call github-nobs/update_pull_request '{
  "owner": "[owner]",
  "repo": "[repo]",
  "pull_number": [number],
  "title": "[new title]",
  "body": "[new body]"
}'
```

## Checklist

- [ ] Verified not on protected branch
- [ ] Pushed all commits to remote
- [ ] Checked for PR template
- [ ] Gathered commit information
- [ ] Created descriptive PR title
- [ ] Wrote PR body (following template if available)
- [ ] Created PR via MCP
- [ ] Returned PR URL to user
