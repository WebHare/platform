---
name: release-notes
description: "Use when adding or updating WebHare platform release notes in doc/release-notes/ (as fragment files in doc/release-notes/<version>/, merged by make-release-notes.ts), eg. for breaking changes, deprecations, migrations, removed options or notable new features that people upgrading WebHare need to know about."
---

# Maintaining WebHare release notes

Release notes tell people upgrading a WebHare installation, and developers of modules running on it, what they need to know
or do. They are not a changelog: the git history already records every change.

## Where they live

- One file per minor version: `doc/release-notes/<major>.<minor>.md`, with the version numbers as in semantic
  versioning, without zero-padding. WebHare 6.2.x goes into `doc/release-notes/6.2.md`, 6.10.x into `6.10.md`.
- The version currently being developed is the `version=` line in `whtree/etc/platform.conf`. Add notes for that
  version.
- When a version is released (its first `.0` release), add the release date to the title in the form
  `# WebHare <major>.<minor> - <day> <Month> <year>` (eg. `# WebHare 6.2 - 1 December 2026`). The title has
  no date while the version is still in development.

## Add a fragment, not an edit to `<version>.md`

Don't edit `doc/release-notes/<version>.md` in a feature branch. Add a new fragment file instead:
`doc/release-notes/<major>.<minor>/<name>.md`, eg. `doc/release-notes/6.2/openid-issuer.md`. Two PRs that both append
to `<version>.md` conflict, while two new files never do.

- Pick a short, descriptive lowercase kebab-case `<name>` for the change, with the `.md` extension (other files in the
  directory are refused).
- A fragment starts with a `## <section>` heading: the section of the release notes it belongs to. Use the heading of
  an existing section in `<version>.md` (or in another fragment) to add to it, eg. `## Breaking changes`,
  `## Deprecations` or `## WRD`; case doesn't matter. Any other heading starts a new section, which is added at the end
  (or at the top for `## Breaking changes`), and the merge script warns about it so you can check for typos.
- A fragment can contain more than one `##` section, eg. a breaking change plus a related deprecation.
- To change an entry that is already in `<version>.md` (eg. a fix to the text, or because a later change alters it),
  edit `<version>.md` directly. Such edits are rare enough not to conflict often.

Example `doc/release-notes/6.2/openid-issuer.md`:

```markdown
## Breaking changes

### OpenID Connect issuer is now derived from the identity provider site
WebHare no longer stores a configurable OpenID Connect `issuer` per WRD schema. ...
```

### Merging the fragments

`mod::platform/scripts/release/make-release-notes.ts` merges the fragments into `<version>.md`. Run it from inside the
platform checkout, at least before every release:

```bash
wh run mod::platform/scripts/release/make-release-notes.ts           # print the merged notes (also validates the fragments)
wh run mod::platform/scripts/release/make-release-notes.ts --write   # update <version>.md and delete the fragments
```

It merges the version being developed unless you pass one (eg. `6.2`). Commit the result directly on `main` (or the
release branch), not in a feature branch. Fragments that were backported to a release branch are merged there too.

Fragments are merged in order of their file names, compared by code point (so `B.md` before `a.md`, which is why names
should be lowercase). The result doesn't depend on the order in which the fragments were added. The merge logic lives
in `mod::platform/js/devsupport/release-notes.ts` (`mergeReleaseNotes`, `readReleaseNotes`), which the webhare_dev
module also uses to show unreleased notes on the website. Change the format there, not in the script.

## What to add

Add an entry in the same change (commit or PR) that introduces something users or module developers must know about:

- **Breaking changes**: anything that can stop an existing installation, module or external integration from working
  after an upgrade, eg. changed token claims, removed or renamed APIs, CLI options or settings, changed defaults.
- **Deprecations**: what is deprecated and what to use instead.
- **Notable new features or behaviour**: only when users need to act on them or might be surprised by them.

Leave out internal refactorings, test changes and bug fixes without user-visible impact.

## How to write an entry

- Put entries under `## Breaking changes` or other `##` sections per topic or feature area. Use a `###` heading per
  breaking change so it can be linked to.
- Say what changed, who is affected, and what they need to do. Name the exact setting, API, CLI command or URL.
- Mention automatic migrations, so readers know what they don't have to do themselves.
- Give a command to check the result where one exists (eg. `wh auth describe`).
- Write for readers who don't know the implementation or the PR discussion. Don't refer to internal ticket numbers or
  branch names.
- If a later change in the same version reverts or alters an earlier entry, update that entry (in its fragment, or in
  `<version>.md` if it was already merged) instead of adding a correction below it. Notes describe the difference between the previous release and this one.
