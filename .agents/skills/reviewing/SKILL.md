---
name: reviewing
description: "Review a change to the WebHare platform itself (a diff, branch or pull request in this repository). Lists the platform-specific things to check on top of a general code review: the change against the modules installed on your machine, the scope of a commit, storage formats shared by HareScript and TypeScript, made-up names stored as real ones, visitor-supplied input in public RPCs, API design, what tests should look like, and release notes. Use when reviewing, re-reviewing or self-reviewing platform code, eg. before or after creating a PR."
---

# Reviewing changes to the WebHare platform

This skill adds what is specific to the platform to a general code review (eg. the built-in `code-review`, or a team
skill that posts a review on a pull request). It doesn't replace one: look for bugs as usual, and check these points too.

The repository's instructions apply to a review as well: [AGENTS.md](../../../AGENTS.md),
[naming conventions](../naming-conventions/SKILL.md) and [release notes](../release-notes/SKILL.md).

## Who reviews

Review code that this session wrote in a fresh subagent. A session that wrote a change tends to confirm its own
reasoning, and misses what it missed while writing.

- Give the subagent the diff (or the branch and its base) and this skill. Don't give it your conclusions, what you think
  is risky, or why the change is right.
- Its findings are claims, not facts. Check each one against the code before you report or fix it.
- A change someone else wrote can be reviewed in the session itself: there is no earlier reasoning to be anchored on.

## Check the change against installed modules

The platform's users are the modules built on it. When a change touches something modules can use, find out what it
does to the modules installed on your machine, if there are any.

Do this when the change adds, renames, removes or changes the behaviour of:

- an export of an `@webhare/*` package, or a `PUBLIC` HareScript function, objecttype or member in a library that
  modules load
- the shape or meaning of a value such an API returns or accepts (eg. what a record's `filename` cell holds)
- a `wh` command or option
- a module definition, siteprofile or WRD schema format
- a storage format that module code reads directly, eg. with its own database queries

Steps:

1. Find the modules: `wh getdatadir` prints the data root, and the modules are in its `installedmodules` directory. Some
   are in subfolders, eg. `addons/`. Skip `node_modules`.
1. If `wh` isn't available, or there are no installed modules, say in the review that this check wasn't done. Don't
   guess what modules might do.
1. Search the modules' HareScript (`.whlib`, `.whscr`), TypeScript and YAML/XML for the changed names: the function,
   export, option, cell or member, and the values that go with it. Search for the old behaviour as well as the old
   name: code that relied on a cell holding one thing breaks when it starts holding another, without any name changing.
1. Read each hit that isn't obviously something else, and decide whether the change breaks it.
1. If the WebHare running on your machine runs the change under review, also run `wh checkmodule <module>` for the
   modules that use the changed API. It reports type errors and validation errors the change causes. Don't run it
   against a WebHare that runs other code: it then tests the wrong thing.
1. Report what you searched for, how many modules and files are affected, and what breaks in them. If nothing is
   affected, say so, with what you searched for.

Limits to state in the review:

- Only the modules installed on this machine were checked. Modules that aren't checked out here may still break.
- A text search misses code that reaches a value through a differently named variable.

Never change these checkouts. Many of them are customer modules: in anything posted on GitHub, describe what you found
without naming the customer, module, site or path.

## Scope of the change

- A commit or PR does one thing. Report changes that have nothing to do with its subject, especially when they come
  without tests: they belong in their own commit or PR.
- A refactoring that the change needs goes in a separate commit before it.
- A feature that covers only some of a group of related types is half done. Ask to cover them all, or to block the
  ones that aren't supported, rather than leave the others silently behaving differently.
- When the reason for a change isn't clear, ask what real problem it solves. Don't accept a new capability or a
  workaround only because it could be useful.
- For something experimental or opt-in, the main question is whether it affects a WebHare that didn't opt in.
- Check what the PR description claims against the diff, eg. that behaviour or errors are "unchanged", or that a
  feature works without conditions the description doesn't mention. Ask to correct a claim that isn't true.
- Code that is about to be removed doesn't need long-term fixes. Say so instead of asking for them.
- A finding that isn't critical can be left for a follow-up, if the author says so on the PR.

## What to look for

### Storage formats shared by HareScript and TypeScript

WHFS and WRD data is read and written by both languages, and by older WebHare versions that sync with or roll back to
the same data.

- A change to how something is stored must be made in both languages, in the same change.
- Data stored before the change must still read correctly, or the change needs a migration.
- An older version that reads the new data must keep working, or the release notes must say it won't. Prefer adding a
  key that old code ignores over changing the meaning of an existing one.
- The tests must cover both directions: written by HareScript and read by TypeScript, and the other way round. They must
  also cover data in the old format.

### Every code path for a kind of data

One kind of data usually has several readers and writers: WHFS and WRD, HareScript and TypeScript, export and import,
archives, the resource visitor, the rich text editor. A change that updates some and not others corrupts data on the
path that was missed.

- Search for the other users of the format, member type or helper the change touches, eg. by the member type constant
  or the function it calls. Include the low-level readers, eg. every caller of `SplitBlobSetting` or `decodeScanData`:
  they are easy to miss.
- Check that types that share a storage format are all handled. A rich text document, a compound document and a form
  definition store their embedded images the same way.

The same goes for operations and resources:

- When a change adds a second implementation of something (eg. GitHub next to GitLab), compare it with the first one
  and look for what the new one drops, eg. waiting for a state, or removing a branch afterwards.
- An operation that is offered in several places (HareScript, TypeScript, a `wh` command, a screen) must behave the same
  in each. Check this release's notes for related changes in behaviour.
- A resource that is closed, disposed or rolled back on one path must be cleaned up the same way on the others, eg.
  when work is still open, or when a script is aborted. Closing a connection doesn't end its work, nor release the
  mutexes the work holds.

### Made-up values stored as real ones

Check where a name or id the code stores comes from. Values that only look like a file name must not be stored as one:

- `noname` plus an extension, which `WrapBlob` makes up for a file without a name
- an id that is stored where a name is expected, eg. a content id
- the name of a temporary file, eg. `1163.jpg`
- a name derived from a hash

### Public RPCs and visitor-supplied input

Form and other public RPCs are called by anyone. A value a visitor supplies must not change how other data is
interpreted.

- A file name must not influence file type detection: an `.svg` or `.html` name on other contents changes what is
  served.
- Limit what is stored: strip paths and cap the length.
- Limit the work a single call can cause: dedupe and cap the number of items a visitor sends, especially when each one
  is expensive (eg. rendering).
- Check where the stored value is used later, eg. in a URL or as a title.

### API design

- A name says what a function does. One that reads from disk synchronously shouldn't look like the asynchronous ones
  next to it, and a new name should fit the names already there (eg. next to `test.throws`).
- Wrong input throws. An id of the wrong type, or one that doesn't exist, is almost always a bug in the caller, so
  don't skip it silently.
- An error carries a code that says what went wrong (eg. `duplicate-object`), so callers don't have to match on the
  message. General code doesn't carry HTTP status codes: the API layer derives those from the error code.
- Parse dates with `Temporal` (eg. `Temporal.Instant.from`), not `Date.parse`.
- Use the helpers that exist, eg. `intOption()` from `@webhare/cli` for a numeric option, and keep to camelCase in
  output and options.
- Avoid magic numbers: a literal number with a meaning (eg. `source IN [ 2, 3 ]`, or a WHFS id) should be a named
  constant from `mod::system/js/internal/webhareconstants.ts` / `mod::system/lib/internal/webhareconstants.whlib`, or
  from the library that defines the value. If no constant exists yet, consider adding one there.
- Group with `Map.groupBy` (or `Object.groupBy` for string keys) instead of filling a `Map` in a loop or computing
  slice offsets by hand. The callback also gets the item's index, so splitting into batches is
  `Map.groupBy(items, (_, idx) => Math.floor(idx / batchSize)).values()`.
- A `beginWork` and its commit should be visible together. When a called function manages its own work, the calling
  code must make that clear.
- Static imports stay static. Don't turn them into `require()` or dynamic imports to get around the cyclic dependency
  check or to speed up startup: split the module instead.
- `CallAsync` starts a new process and takes about half a second. Don't use it where that matters; prefer `CallJS` or
  a backend service.

### Robustness

- Data from outside (an HTTP response, a token, uploaded content) can have any shape. Check that it's an object with
  the expected members before using it. An HTTP error response may not be JSON at all (eg. a proxy's 502 page).
- Text taken from parsed files (eg. a PDF or Office title) may contain NUL and other control characters. PostgreSQL
  rejects NUL in text, so strip them before storing the text.
- A task or loop that handles several items must not let one bad item fail or block the others. Otherwise a retried
  task fails on the same item every time.
- An action must check the current state before it writes, not trust a flag computed when a list or screen was loaded.
- C++: a pointer passed without a length must not be null, also for empty input. A loop that waits must check
  `HSVM_TestMustAbort`, or the job hangs when it's aborted.
- Don't hand out a URL that the code already knows will fail.
- A user interface that shows something as loading needs a visible state for when loading fails.

### Pitfalls

- Kysely query builders are immutable: `query.where(...)` returns a new builder. A call whose result isn't used does
  nothing.
- Objects directly below the WHFS root have `parent` NULL, not 0. Code that is given id 0 (eg. to list or recurse into
  folders) must handle that.

### Leftovers

- Comments and messages that still use the old name or describe the old behaviour.
- Doc comments that don't match what the code does or returns.
- Code where the obvious way to write it is the bug needs a comment saying so, or the next change will reintroduce
  it.
- Code, imports and options the change no longer uses.
- A warning shown to users was put there for a reason. Don't let a change remove one without replacing what it
  protected against.

### Tests

- A test reproduces the problem the way a developer or user would hit it. A test that builds internal objects,
  overrides internal APIs or calls private methods breaks in the next refactoring for reasons unrelated to the bug,
  and doesn't explain the bug either. Ask what the real scenario was.
- Tests clean up at the start, not at the end: a test first removes what an earlier run may have left behind, and
  leaves what it created itself. The state a failed test leaves behind is what you debug with. Modules whose name
  starts with `tempModuleNamePrefix` (`@webhare/test-backend`) are removed by `test.reset()`.
- A test must run on any developer's machine, not only in CI.
- A new test for an existing area goes into that area's test file, so it reuses the setup there.
- A workaround in a test without an explanation may hide another bug. Ask why it's needed.

### Tests that assert the old behaviour

A change in behaviour breaks tests that nobody edited. CI finds them late.

- Search the tests in `whtree/modules/webhare_testsuite/tests/` and `whtree/modules/devkit/tests/` for assertions on the
  old behaviour, not only the tests the change touches. A test may pass by accident on the old behaviour, eg. by
  accepting any non-empty value.
- A new test must fail without the change. A check that can pass without doing anything (eg. a replacement that didn't
  match) proves nothing: assert that the setup took effect.
- Tests follow the test libraries listed in [AGENTS.md](../../../AGENTS.md).

### Release notes

A change that modules or people upgrading must know about needs an entry, see [release notes](../release-notes/SKILL.md).

- A change in what an existing API returns or does is worth an entry, even if its signature is the same and the new
  behaviour is the right one.
- A fix that only brings TypeScript in line with what HareScript already did doesn't need one.
