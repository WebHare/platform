/* Release notes of the WebHare platform (doc/release-notes/ in the platform repository)

   Each minor version has a file `<major>.<minor>.md`. New notes are added as fragment files in a directory per version
   (`<major>.<minor>/<name>.md`) so concurrent pull requests don't conflict, and merged into the version's file before a
   release. Each fragment starts with a `## <section>` heading and is added to the section with that heading (compared
   case-insensitively), or becomes a new section. See .agents/skills/release-notes/SKILL.md in the platform repository.

   The merge is deterministic: fragments are merged in order of their file names (compared by code point, not
   locale), and merging the same fragments into the same file always gives the same result. Used by
   mod::platform/scripts/release/make-release-notes.ts and by the webhare_dev module to show unreleased notes.
*/

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReleaseNoteFragment {
  /** File name of the fragment, eg. `openid-issuer.md` */
  name: string;
  /** Markdown text of the fragment */
  text: string;
}

export interface ReleaseNotes {
  /** The release notes with all fragments merged in */
  text: string;
  /** Full paths of the fragment files that were merged, in merge order */
  fragmentFiles: string[];
  /** Full path of the version's release notes file (which may not exist yet) */
  notesFile: string;
  /** Things worth checking in the fragments, eg. a fragment that starts a new section (maybe because of a typo in
      its heading) */
  warnings: string[];
}

const breakingChangesHeading = "Breaking changes";

interface Section {
  heading: string;
  lines: string[];
}

interface ParsedNotes {
  /** Lines before the first ## heading (the title and any introduction) */
  preamble: string[];
  sections: Section[];
}

function compareCodePoints(lhs: string, rhs: string): number {
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function isSameHeading(lhs: string, rhs: string): boolean {
  return lhs.toLowerCase() === rhs.toLowerCase();
}

function trimBlankLines(lines: string[], { keepLeading = false } = {}): string[] {
  let start = 0, end = lines.length;
  if (!keepLeading)
    while (start < end && !lines[start].trim())
      ++start;
  while (end > start && !lines[end - 1].trim())
    --end;
  return lines.slice(start, end);
}

/** Whether the line starts a list item */
function isListItem(line: string | undefined): boolean {
  return Boolean(line && /^\s*([-*+]|\d+\.)\s/.test(line));
}

/** Whether the line is a list item or the indented continuation of one */
function isListItemOrContinuation(line: string | undefined): boolean {
  return isListItem(line) || Boolean(line && /^\s{2,}\S/.test(line));
}

/** Split markdown into the part before the first '## ' heading and the '## ' sections, ignoring headings in code blocks
    @param source - Name of the file being parsed, for errors. If set, an unterminated code block throws */
function parseNotes(text: string, source?: string): ParsedNotes {
  const result: ParsedNotes = { preamble: [], sections: [] };
  let fence = ""; //the opening fence of the code block we're in, eg ``` or ~~~~
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      if (!fence) {
        fence = fenceMatch[1];
      } else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        //A closing fence uses the same character, is at least as long as the opening one and has no info string
        fence = "";
      }
    }

    const headingMatch = !fence && line.match(/^## +(.+?)(?:\s+#+)?\s*$/);
    if (headingMatch)
      result.sections.push({ heading: headingMatch[1], lines: [] });
    else if (result.sections.length)
      result.sections.at(-1)!.lines.push(line);
    else
      result.preamble.push(line);
  }
  if (fence && source)
    throw new Error(`Release note fragment '${source}' has an unterminated code block (${fence})`);
  return result;
}

function formatNotes(notes: ParsedNotes): string {
  const parts: string[] = [];
  const preamble = trimBlankLines(notes.preamble);
  if (preamble.length)
    parts.push(preamble.join("\n"));
  for (const section of notes.sections) {
    const body = trimBlankLines(section.lines, { keepLeading: true });
    parts.push(`## ${section.heading}` + (body.length ? "\n" + body.join("\n") : ""));
  }
  return parts.join("\n\n") + "\n";
}

/** Merge a fragment's sections into the release notes. Sections with an existing heading are appended to */
function mergeFragment(notes: ParsedNotes, fragment: ParsedNotes, fragmentName: string, warnings: string[]) {
  for (const section of fragment.sections) {
    const body = trimBlankLines(section.lines, { keepLeading: true });
    const existing = notes.sections.find(s => isSameHeading(s.heading, section.heading));
    if (existing) {
      const current = trimBlankLines(existing.lines, { keepLeading: true });
      const addition = trimBlankLines(body);
      //Continue a list without a blank line, so it doesn't become a 'loose' list
      const continuesList = isListItemOrContinuation(current.at(-1)) && isListItem(addition[0]);
      existing.lines = [...current, ...(continuesList ? [] : [""]), ...addition];
    } else if (isSameHeading(section.heading, breakingChangesHeading)) {
      //Breaking changes go before all other sections
      notes.sections.unshift({ heading: breakingChangesHeading, lines: body });
    } else {
      warnings.push(`Release note fragment '${fragmentName}' adds a new section '${section.heading}'`);
      notes.sections.push({ heading: section.heading, lines: body });
    }
  }
}

/** Merge release note fragments into a version's release notes
    @param version - Minor version, eg. `6.2`. Used for the title if there are no release notes yet
    @param notes - Current text of the version's release notes, or null if the file doesn't exist yet
    @param fragments - Fragments to merge. They are merged in order of their names, whatever the order passed
    @param options.onWarning - Called for things worth checking, eg. a fragment that starts a section that isn't in
        `notes` yet
    @returns The merged release notes. Without fragments, `notes` unchanged
    @throws If a fragment doesn't start with a `## ` heading or has an unterminated code block
*/
export function mergeReleaseNotes(version: string, notes: string | null, fragments: ReleaseNoteFragment[], options?: { onWarning?: (message: string) => void }): string {
  if (notes !== null && !fragments.length)
    return notes; //don't reformat release notes without fragments (eg. older files have no blank line after the title)

  const merged = notes !== null ? parseNotes(notes) : { preamble: [`# WebHare ${version} release notes`], sections: [] };
  const warnings: string[] = [];
  for (const fragment of fragments.toSorted((lhs, rhs) => compareCodePoints(lhs.name, rhs.name))) {
    const parsed = parseNotes(fragment.text, fragment.name);
    if (trimBlankLines(parsed.preamble).length || !parsed.sections.length)
      throw new Error(`Release note fragment '${fragment.name}' must start with a '## <section>' heading`);
    //Only warn about new sections if there were release notes already: all sections are new for a new version
    mergeFragment(merged, parsed, fragment.name, notes !== null ? warnings : []);
  }
  for (const warning of warnings)
    options?.onWarning?.(warning);
  return formatNotes(merged);
}

/** List the versions that have release notes or fragments in a release notes directory, oldest first. Versions with
    zero-padded minor numbers (eg. `4.03`) are returned as they are named */
export async function listReleaseNoteVersions(releaseNotesDir: string): Promise<string[]> {
  const versions = new Set<string>();
  for (const entry of await readdir(releaseNotesDir, { withFileTypes: true })) {
    const match = entry.name.match(entry.isDirectory() ? /^(\d+\.\d+)$/ : /^(\d+\.\d+)\.md$/);
    if (match)
      versions.add(match[1]);
  }
  const toParts = (version: string) => version.split(".").map(Number);
  return [...versions].sort((lhs, rhs) => {
    const [lhsMajor, lhsMinor] = toParts(lhs), [rhsMajor, rhsMinor] = toParts(rhs);
    return lhsMajor - rhsMajor || lhsMinor - rhsMinor || compareCodePoints(lhs, rhs);
  });
}

/** Read a version's release notes with its fragments merged in
    @param releaseNotesDir - The release notes directory, eg. `<checkout>/doc/release-notes`
    @param version - Minor version, eg. `6.2`
    @returns The merged release notes, or null if the version has neither release notes nor fragments
    @throws If the fragment directory contains anything but `.md` files (hidden files are ignored), or a fragment is
            invalid
*/
export async function readReleaseNotes(releaseNotesDir: string, version: string): Promise<ReleaseNotes | null> {
  const notesFile = join(releaseNotesDir, `${version}.md`);
  const fragmentDir = join(releaseNotesDir, version);
  const fragmentNames: string[] = [];
  if (existsSync(fragmentDir)) {
    for (const entry of await readdir(fragmentDir, { withFileTypes: true })) {
      if (entry.name.startsWith("."))
        continue; //eg .DS_Store
      if (!entry.isFile() || !entry.name.endsWith(".md")) //also catches eg. 'notes.MD', which would otherwise be silently skipped
        throw new Error(`Unexpected '${entry.name}' in '${fragmentDir}': release note fragments must be files with a '.md' extension`);
      fragmentNames.push(entry.name);
    }
    fragmentNames.sort(compareCodePoints);
  }

  const notes = existsSync(notesFile) ? await readFile(notesFile, "utf-8") : null;
  if (notes === null && !fragmentNames.length)
    return null;

  const fragments = await Promise.all(fragmentNames.map(async name => ({ name, text: await readFile(join(fragmentDir, name), "utf-8") })));
  const warnings: string[] = [];
  return {
    text: mergeReleaseNotes(version, notes, fragments, { onWarning: message => warnings.push(message) }),
    fragmentFiles: fragmentNames.map(name => join(fragmentDir, name)),
    notesFile,
    warnings
  };
}
