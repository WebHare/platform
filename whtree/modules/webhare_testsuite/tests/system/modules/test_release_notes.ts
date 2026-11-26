import * as test from "@webhare/test";
import { listReleaseNoteVersions, mergeReleaseNotes, readReleaseNotes } from "@mod-platform/js/devsupport/release-notes";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const notes = `# WebHare 9.1 release notes

## Breaking changes

### Foo removed
Foo is gone.

## WRD
- First WRD change
- Second WRD change
  continued

## Validation
Validation is stricter.
`;

function testMerge() {
  //Without fragments the notes are unchanged
  test.eq(notes, mergeReleaseNotes("9.1", notes, []));
  test.eq("# Old style\n## Section\n\n\nText", mergeReleaseNotes("4.3", "# Old style\n## Section\n\n\nText", []));

  //No notes yet
  test.eq("# WebHare 9.1 release notes\n\n## WRD\n- A change\n", mergeReleaseNotes("9.1", null, [{ name: "a.md", text: "## WRD\n- A change\n" }]));

  const warnings: string[] = [];
  const merged = mergeReleaseNotes("9.1", notes, [
    { name: "b-wrd.md", text: "## WRD\n- Third WRD change\n\n## Tasks\nNew tasks API.\n" },
    { name: "a-bar.md", text: "\n## Breaking changes\n\n### Bar removed\nBar is gone.\n\n```markdown\n## Not a heading\n```\n" },
    { name: "c-wrd.md", text: "## WRD\nA paragraph about WRD.\n" },
  ], { onWarning: message => warnings.push(message) });

  test.eq(`# WebHare 9.1 release notes

## Breaking changes

### Foo removed
Foo is gone.

### Bar removed
Bar is gone.

\`\`\`markdown
## Not a heading
\`\`\`

## WRD
- First WRD change
- Second WRD change
  continued
- Third WRD change

A paragraph about WRD.

## Validation
Validation is stricter.

## Tasks
New tasks API.
`, merged);
  test.eq(["Release note fragment 'b-wrd.md' adds a new section 'Tasks'"], warnings);

  //Fragments are merged by file name (code point order) regardless of the order they're passed in
  const fragments = [
    { name: "B.md", text: "## New\nB\n" },
    { name: "a.md", text: "## New\na\n" },
    { name: "A.md", text: "## New\nA\n" },
  ];
  test.eq("# T\n\n## New\nA\n\nB\n\na\n", mergeReleaseNotes("9.1", "# T\n", fragments));
  test.eq("# T\n\n## New\nA\n\nB\n\na\n", mergeReleaseNotes("9.1", "# T\n", fragments.toReversed()));

  //A new 'Breaking changes' section goes first
  test.eq("# T\n\n## Breaking changes\n### X\n\n## Other\nO\n", mergeReleaseNotes("9.1", "# T\n\n## Other\nO\n", [{ name: "x.md", text: "## Breaking changes\n### X\n" }]));

  //Headings match case-insensitively and may have closing #s. A list continues without a blank line, other text doesn't
  const noWarnings = { onWarning: (message: string) => { throw new Error(`Unexpected warning: ${message}`); } };
  test.eq("# T\n\n## Breaking changes\n### X\n\n### Y\n\n## WRD\n- a\n- b\n\n    code\n", mergeReleaseNotes("9.1", "# T\n\n## Breaking changes\n### X\n\n## WRD\n- a\n", [
    { name: "1.md", text: "## breaking Changes\n### Y\n" },
    { name: "2.md", text: "## WRD ##\n- b\n" },
    { name: "3.md", text: "## wrd\n    code\n" },
  ], noWarnings));
  //...but no warnings about new sections for a version without release notes
  mergeReleaseNotes("9.1", null, [{ name: "a.md", text: "## A\nA\n" }, { name: "b.md", text: "## B\nB\n" }], noWarnings);

  //Code blocks: a longer fence isn't closed by a shorter one or one with an info string
  test.eq("# T\n\n## A\n````md\n```\n## Inner\n```js\n````\n", mergeReleaseNotes("9.1", "# T\n", [{ name: "a.md", text: "## A\n````md\n```\n## Inner\n```js\n````\n" }]));
  test.throws(/'open.md' has an unterminated code block/, () => mergeReleaseNotes("9.1", notes, [{ name: "open.md", text: "## A\n```\n## B\n" }]));

  test.throws(/'bad.md' must start with a '## <section>' heading/, () => mergeReleaseNotes("9.1", notes, [{ name: "bad.md", text: "Text\n## WRD\n" }]));
  test.throws(/'empty.md' must start/, () => mergeReleaseNotes("9.1", notes, [{ name: "empty.md", text: "" }]));
}

async function testReadFromDisk() {
  const dir = await mkdtemp(join(tmpdir(), "release-notes-"));
  await writeFile(join(dir, "9.1.md"), notes);
  await writeFile(join(dir, "README.md"), "# Release notes\n");
  await writeFile(join(dir, "4.03.md"), "# WebHare 4.03\n");
  await mkdir(join(dir, "9.1"));
  await mkdir(join(dir, "9.10"));
  await writeFile(join(dir, "9.1", "z.md"), "## Tasks\nZ\n");
  await writeFile(join(dir, "9.1", "a.md"), "## Tasks\nA\n");
  await writeFile(join(dir, "9.1", ".DS_Store"), "ignored");
  await writeFile(join(dir, "9.10", "new.md"), "## New\nNew\n");

  test.eq(["4.03", "9.1", "9.10"], await listReleaseNoteVersions(dir));

  const result = await readReleaseNotes(dir, "9.1");
  test.eq([join(dir, "9.1", "a.md"), join(dir, "9.1", "z.md")], result?.fragmentFiles);
  test.eq(join(dir, "9.1.md"), result?.notesFile);
  test.eq(notes + "\n## Tasks\nA\n\nZ\n", result?.text);

  test.eq("# WebHare 9.10 release notes\n\n## New\nNew\n", (await readReleaseNotes(dir, "9.10"))?.text);
  test.eq(["Release note fragment 'a.md' adds a new section 'Tasks'"], result?.warnings);
  test.eq(null, await readReleaseNotes(dir, "9.2"));

  //Files that look like fragments but aren't '.md' would be skipped silently, so they throw
  await writeFile(join(dir, "9.1", "upper.MD"), "## Tasks\nU\n");
  await test.throws(/Unexpected 'upper.MD'/, readReleaseNotes(dir, "9.1"));
}

test.runTests([
  testMerge,
  testReadFromDisk
]);
