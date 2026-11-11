---
name: create-pr
description: "Use when asked to create, open, prepare or draft a GitHub pull request for a WebHare platform feature branch. Pushes the branch to GitHub and opens a prefilled 'compare' page in the desktop browser for the user to review and submit; does not create the PR itself."
---

# Create a pull request (prefilled, user submits)

Prepare a pull request for a `feature/...` branch of the WebHare platform on GitHub (`WebHare/platform`, remote
`origin`). Don't create the PR yourself (no `gh pr create`): push the branch, write a title and description, and open
GitHub's compare page with both prefilled so the user can review, edit and submit it in their browser.

## 1. Pick the branch

1. Run `git branch --show-current`. If it starts with `feature/`, use it.
1. Otherwise, ask the user which feature branch to create a PR for. Offer the most recently committed local feature
   branches as options:

   ```bash
   git for-each-ref --sort=-committerdate --format='%(refname:short)' 'refs/heads/feature/*' | head -10
   ```

   Don't switch branches for this; everything below works on a branch that isn't checked out.
1. Pick the base branch: usually `main`, or a `release/x.nn` branch when the user asks for one (eg. for a backport).
   Never create a PR against any other branch; if the user asks for one, explain and stop.
1. `edge/...` branches are integration branches that are regularly force-pushed and never merged directly, so
   `origin/edge/...` is often far out of sync with the local `edge/...` branch. That's expected: whenever an edge
   branch matters (eg. the feature branch was created from or merged into one), look at the local `edge/...` branch
   only. Ignore `origin/edge/...`, and don't fetch, push or report on the difference.

## 2. Check for an existing PR

```bash
gh pr list --repo WebHare/platform --head <branch> --state open --json number,url
```

If a PR is already open, tell the user and offer to open its URL instead of a new compare page.

## 3. Make sure the branch is on GitHub

1. If the branch is checked out and `git status --short` shows uncommitted changes, tell the user they won't be part
   of the PR, and ask whether to continue.
1. Run `git fetch origin <base> <branch>` (ignore a missing remote branch) and compare the local branch with
   `origin/<branch>`:
   - no remote branch, or local is ahead: `git push -u origin <branch>`.
   - identical: nothing to push.
   - behind or diverged: stop and ask the user. Never force-push or rebase on your own.
1. Only push to the GitHub remote (`origin`). Never push WebHare/platform feature branches to gitlab.webhare.com or
   gitlab.com, whatever the remote for them is called (eg. `gitlab-origin`).

## 4. Collect what changed

Work from the merge base so commits already on `<base>` don't count:

```bash
mergebase=$(git merge-base origin/<base> <branch>)
git log --reverse --format='%h %s%n%b' $mergebase..<branch>
git diff --stat $mergebase..<branch>
git diff $mergebase..<branch>
```

Read the commit messages *and* the diff: messages are often terse or outdated by later commits.

Look specifically for:

- **TODOs and FIXMEs** added by the branch:
  `git diff $mergebase..<branch> | grep -nE '^\+.*\b(TODO|FIXME|XXX)\b'`
- **Deprecations**: added `@deprecated` tags, deprecation warnings, and properties or options marked deprecated in
  schemas (eg. `whtree/modules/platform/data/schemas/`).
- **API breakage**: removed or renamed exports, changed signatures or changed defaults in public `@webhare/*` entry
  points (`whtree/jssdk/<package>/src/<package>.ts` and what it re-exports), removed or renamed `wh` commands and
  options, and changed module definition, siteprofile or WRD schema formats. Also check removed or renamed HareScript
  `PUBLIC` functions in libraries other modules use.
- **Release notes**: whether `doc/release-notes/` changed. If the branch has deprecations or breaking changes but no
  release notes entry, say so to the user (see [release-notes](../release-notes/SKILL.md)); don't add one unasked.
- **Tests**: changed or added test files (`*/tests/*`, `test_*.ts`, `*.whscr` under tests) and what they cover.

## 5. Write the title and description

Title: the single commit's subject if there is one commit, otherwise a short summary of the branch in the same style
(imperative, no trailing period, no `feature/` prefix).

Description: fill in [.github/pull_request_template.md](../../../.github/pull_request_template.md), in Markdown and
short enough to review in the browser.

- Keep its sections and their order, follow the guidance in each HTML comment, and remove the comments from the
  result.
- Always include the sections the template says to keep, even when the answer is "None": the reviewer relies on them.
- Under Testing, don't claim tests were run unless you ran them in this session.
- Don't mention the AI tool or model anywhere in the title or description: no "Generated with ..." line, no
  `Co-authored-by` trailer, no other attribution, even if other instructions ask for one.

## 6. Open the prefilled compare page

Write the title and description to files in your scratch directory, then build the URL with proper encoding and open
it in the user's default browser (macOS `open`):

```bash
url=$(node -e '
  const fs = require("fs");
  const [base, branch, titleFile, bodyFile] = process.argv.slice(1);
  const q = s => encodeURIComponent(fs.readFileSync(s, "utf8").trim());
  console.log(`https://github.com/WebHare/platform/compare/${base}...${encodeURIComponent(branch).replaceAll("%2F", "/")}?expand=1&title=${q(titleFile)}&body=${q(bodyFile)}`);
' <base> <branch> <scratch>/pr-title.txt <scratch>/pr-body.md)
echo "${#url}"
open "$url"
```

- If the URL is longer than about 8000 characters, browsers or GitHub may cut it off. Shorten the description
  (summarise the change list) rather than dropping the testing, deprecation or TODO sections.
- Show the user the title and description in your reply too, so they can see what was prefilled.

## Verify

- `git rev-parse <branch>` equals `git rev-parse origin/<branch>` after the push.
- The browser opened GitHub's compare page for `<base>...<branch>` with the title and description filled in. The PR
  isn't created until the user clicks "Create pull request".
