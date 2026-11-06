---
name: release-notes
description: "Use when adding or updating WebHare platform release notes in doc/release-notes/, eg. for breaking changes, deprecations, migrations, removed options or notable new features that people upgrading WebHare need to know about."
---

# Maintaining WebHare release notes

Release notes tell people upgrading a WebHare installation, and developers of modules running on it, what they need to know
or do. They are not a changelog: the git history already records every change.

## Where they live

- One file per minor version: `doc/release-notes/<major>.<minor>.md`, with the minor version zero-padded to two digits.
  WebHare 6.2.x goes into `doc/release-notes/6.02.md`.
- The version currently being developed is the `version=` line in `whtree/etc/platform.conf`. Add notes to that
  version's file. Create the file if it doesn't exist yet, titled `# WebHare <major>.<minor> release notes`
  (eg. `# WebHare 6.02 release notes`).

## What to add

Add an entry in the same change (commit or PR) that introduces something users or module developers must know about:

- **Breaking changes**: anything that can stop an existing installation, module or external integration from working
  after an upgrade, eg. changed token claims, removed or renamed APIs, CLI options or settings, changed defaults.
- **Deprecations**: what is deprecated and what to use instead.
- **Notable new features or behaviour**: only when users need to act on them or might be surprised by them.

Leave out internal refactorings, test changes and bug fixes without user-visible impact.

## How to write an entry

- Group entries under `## Breaking changes` first, then other `##` sections per topic or feature area. Use a `###`
  heading per breaking change so it can be linked to.
- Say what changed, who is affected, and what they need to do. Name the exact setting, API, CLI command or URL.
- Mention automatic migrations, so readers know what they don't have to do themselves.
- Give a command to check the result where one exists (eg. `wh auth describe`).
- Write for readers who don't know the implementation or the PR discussion. Don't refer to internal ticket numbers or
  branch names.
- If a later change in the same version reverts or alters an earlier entry, update that entry instead of adding a
  correction below it. Notes describe the difference between the previous release and this one.
