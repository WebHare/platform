---
name: create-pr
description: "Use when asked to create, open, prepare or draft a GitHub pull request for a WebHare platform feature branch. Checks that the branch had a local review with its findings handled (and offers to review or fix first), pushes the branch to GitHub and creates a draft PR with a written title and description, then returns its link; with an explicit request to merge it immediately, creates a ready PR set to auto-merge instead. When the change must be backported, also requests the cherry-pick to the previous release with a PR comment."
---

# Create a pull request (as a draft)

Create a pull request for a `feature/...` branch of the WebHare platform on GitHub (`WebHare/platform`, remote
`origin`): push the branch, write a title and description, and create the PR as a draft. The user marks it ready for
review themselves, after the build results and reviews are in and they've checked the change.

## 1. Pick the branch

1. Run `git branch --show-current`. If it starts with `feature/`, use it.
1. Otherwise, ask the user which feature branch to create a PR for. Offer the most recently committed local feature
   branches as options:

   ```bash
   git for-each-ref --sort=-committerdate --format='%(refname:short)' 'refs/heads/feature/*' | head -10
   ```

   Don't switch branches for this; everything below works on a branch that isn't checked out.
1. Pick the base branch: usually `main`, or a `release/x.nn` branch when the user explicitly asks for a PR against it.
   A backport doesn't need a PR against the release branch: create the PR as usual and request the backport with a
   comment (see [section 8](#8-request-a-backport)). Never create a PR against any other branch; if the user asks for
   one, explain and stop.
1. `edge/...` branches are integration branches that are regularly force-pushed and never merged directly, so
   `origin/edge/...` is often far out of sync with the local `edge/...` branch. That's expected: whenever an edge
   branch matters (eg. the feature branch was created from or merged into one), look at the local `edge/...` branch
   only. Ignore `origin/edge/...`, and don't fetch, push or report on the difference.

## 2. Check for an existing PR

```bash
gh pr list --repo WebHare/platform --head <branch> --state open --json number,url
```

If a PR is already open, don't create another one: give the user its URL.

## 3. Check that the branch was reviewed

A PR should only be created for a change that has had a local review, with the issues it found handled. Reviewing on
GitHub after the PR exists costs reviewers' time and CI runs on problems a local review would have caught.

Check whether the branch's current changes were reviewed locally, eg. with the built-in `code-review` together with
the [reviewing](../reviewing/SKILL.md) skill. Count a review only if it covered the branch as it is now: you saw it
in this session, or the user tells you it was done. Commits added after the review weren't reviewed.

- **Reviewed, and every finding was fixed or deliberately dismissed:** continue.
- **Not reviewed:** warn the user that the branch hasn't had a local review, and ask with `AskUserQuestion` (the
  recommended option first):
  - *Review first (Recommended)*: review the branch as described in [reviewing](../reviewing/SKILL.md), report the
    findings and stop. Don't create the PR in the same go.
  - *Review and fix*: review it, fix the findings that hold up after checking them against the code, commit the
    fixes into the commits they belong to (with the user's consent if that rewrites pushed commits), then continue
    with the next step.
  - *Create the PR anyway*: continue without a review.
- **Reviewed, but findings are still open:** list them, and ask with `AskUserQuestion`:
  - *Handle the findings first (Recommended)*: fix them as under *Review and fix*, then continue.
  - *Create the PR anyway*: continue, and list the open findings to the user in your reply.

Ask this even if the user's request already said to create the PR: a request for a PR isn't a decision to skip the
review.

## 4. Make sure the branch is on GitHub

1. If the branch is checked out and `git status --short` shows uncommitted changes, tell the user they won't be part
   of the PR, and ask whether to continue.
1. Run `git fetch origin <base> <branch>` (ignore a missing remote branch) and compare the local branch with
   `origin/<branch>`:
   - no remote branch, or local is ahead: `git push -u origin <branch>`.
   - identical: nothing to push.
   - behind or diverged: stop and ask the user. Never force-push or rebase on your own.
1. Only push to the GitHub remote (`origin`). Never push WebHare/platform feature branches to gitlab.webhare.com or
   gitlab.com, whatever the remote for them is called (eg. `gitlab-origin`).

## 5. Collect what changed

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

## 6. Write the title and description

Title: the single commit's subject if there is one commit, otherwise a short summary of the branch in the same style
(imperative, no trailing period, no `feature/` prefix).

Description: fill in [.github/pull_request_template.md](../../../.github/pull_request_template.md), in Markdown and
short enough to review on GitHub.

- Keep its sections and their order, follow the guidance in each HTML comment, and remove the comments from the
  result.
- Leave out the "Deprecations and API changes" and "TODOs / FIXMEs" sections when there is nothing to list in them.
  Always include "Changes" and "Testing".
- Under Testing, don't claim tests were run unless you ran them in this session.
- Don't mention the AI tool or model anywhere in the title or description: no "Generated with ..." line, no
  `Co-authored-by` trailer, no other attribution, even if other instructions ask for one.

## 7. Create the draft PR

Write the title and description to files in your scratch directory, then create the PR as a draft:

```bash
gh pr create --repo WebHare/platform --draft --base <base> --head <branch> \
  --title "$(cat <scratch>/pr-title.txt)" --body-file <scratch>/pr-body.md
```

`gh pr create` prints the PR's URL. Reply with just that link: the title and description are on the PR.

Only when the user explicitly asks to merge the PR right away (eg. "create the PR and merge it"), create it without
`--draft` and enable auto-merge, so GitHub merges it once the required checks pass and it has the required approvals
(the `main` ruleset requires two approving reviews, one from the required team, and all review threads resolved):

```bash
gh pr merge <url> --auto --merge
```

Reply with the link and say that auto-merge is enabled but the PR still needs two approvals. A request for a PR
alone is not a request to merge it.

## 8. Request a backport

Only when the user says the change must be backported (eg. "we need this in 6.1 too", "backport it"): after creating
the PR, add a comment to it, never a line in the description, that asks for a cherry-pick to the previous release.
The [cherry-pick workflow](../../../.github/workflows/cherry-pick.yml) picks up comments starting with
`cherry-pick to`, and creates the cherry-pick PR once this PR is merged.

1. Find the version of the PR's base branch, from `version=` in its `whtree/etc/platform.conf`:

   ```bash
   git show origin/<base>:whtree/etc/platform.conf | grep '^version='
   ```

   Its major.minor is the current range, eg. `version=6.2.1` is the "6.2" range.
1. The previous version is the highest `release/x.y` branch below that range: for 6.2 that's `release/6.1`. List them
   with `git branch -r --list 'origin/release/*'`; for a x.0 range (eg. 7.0) it's the last 6.x release. If the user
   names another version, use theirs.
1. Add the comment, with exactly `cherry-pick to release/<previous>` and nothing else (eg.
   `cherry-pick to release/6.1`):

   ```bash
   gh pr comment <url> --repo WebHare/platform --body 'cherry-pick to release/<previous>'
   ```

Mention in your reply that the backport was requested and to which release branch.

## Verify

- `git rev-parse <branch>` equals `git rev-parse origin/<branch>` after the push.
- `gh pr view <url> --json isDraft,autoMergeRequest,baseRefName` shows a draft PR against `<base>`, or, when the user
  asked to merge it right away, a ready PR with `autoMergeRequest` set.
- For a backport: `gh pr view <url> --json comments --jq '.comments[].body'` shows the
  `cherry-pick to release/<previous>` comment, and the description doesn't mention the cherry-pick.
