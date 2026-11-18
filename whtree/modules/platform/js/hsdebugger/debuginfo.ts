/* Debug information of compiled HareScript libraries, as written by the compiler (harescript/compiler/codelibrarywriter.cpp)
   and returned by the debugger's 'getdebuginfo' request for the library a job has loaded.

   This replaces mod::system/lib/internal/debugger/compiledlibrary.whlib, which needs __HS_LIBDUMP and so a HareScript VM.
*/

import { gunzipSync } from "node:zlib";
import { lowerBound, recordLowerBound, recordUpperBound, upperBound } from "@webhare/hscompat";

/** Variable flags in variablepositions */
const VarFlags = {
  /** The variable is erased (no longer live) at this position */
  erase: 1,
  /** Only the location changed, not the value */
  locationOnly: 2,
  /** Global variable */
  global: 4,
} as const;

/** Raw debug info, as encoded by the compiler */
export interface RawDebugInfo {
  version: number;
  scopecount: number;
  scoperanges: Array<{ id: number; begin: { line: number; col: number }; end: { line: number; col: number } }>;
  variables: Array<{ scope: number; name: string; globalvar: number }>;
  codesize: number;
  basicblockpositions: number[];
  variablepositions: Array<{ variable: number; codeptr: number; position: number; flags: number }>;
  warnings?: unknown[];
}

/** Mapping of a code position to a source position */
export interface SourceMapEntry {
  codeptr: number;
  line: number;
  col: number;
}

/** A local variable of a stack frame */
export interface FrameVariable {
  /** Variable name (uppercase, as in the compiled library) */
  name: string;
  /** Id to request the variable's value with */
  id: number;
}

/** Debug information of one compiled library */
export class LibraryDebugInfo {
  readonly debuginfo: RawDebugInfo;
  readonly sourcemap: SourceMapEntry[];
  private lineStartsCache = new Map<number, number[]>();

  constructor(debuginfo: RawDebugInfo, sourcemap: SourceMapEntry[]) {
    this.debuginfo = debuginfo;
    this.sourcemap = [...sourcemap].sort((a, b) => a.codeptr - b.codeptr);
  }

  /** Parse the gzipped JSON debug info as stored in a compiled library */
  static fromCompressed(compressed: Uint8Array, sourcemap: SourceMapEntry[]): LibraryDebugInfo {
    const json = compressed.length ? gunzipSync(compressed).toString("utf-8") : "";
    if (!json)
      throw new Error("The library has no debug information");
    return new LibraryDebugInfo(JSON.parse(json) as RawDebugInfo, sourcemap);
  }

  /** Get the variables that are live in a stack frame (port of CompiledLibrary::GetFrameVariables)
      @param codeptr - Code position of the frame
      @param baseptr - Stack position of the frame
      @returns Variables, with the ids to request their values with
  */
  getFrameVariables(codeptr: number, baseptr: number): FrameVariable[] {
    const blocks = this.debuginfo.basicblockpositions;
    const pos = lowerBound(blocks, codeptr);
    // Start of the basic block containing codeptr
    const blockStart = blocks[pos.position - (pos.found ? 0 : 1)] ?? 0;

    const positions = this.debuginfo.variablepositions;
    const start = recordLowerBound(positions, { codeptr: blockStart }, ["codeptr"]).position;
    const end = recordUpperBound(positions, { codeptr }, ["codeptr"]);

    // Later positions override earlier ones; erased variables are dropped. Map keeps the order of the last update
    const live = new Map<string, { name: string; position: number }>();
    for (let i = start; i < end; ++i) {
      const rec = positions[i];
      const name = this.debuginfo.variables[rec.variable].name;
      live.delete(name);
      if (!(rec.flags & VarFlags.erase))
        live.set(name, { name, position: rec.position });
    }

    return [...live.values()].map(v => ({ name: v.name, id: baseptr + v.position }));
  }

  /** Get the source position of a code position */
  getSourcePosition(codeptr: number): SourceMapEntry | null {
    const pos = recordLowerBound(this.sourcemap, { codeptr }, ["codeptr"]);
    return this.sourcemap[pos.position - (pos.found ? 0 : 1)] ?? null;
  }

  /** Get the code positions where execution of a line can start, for setting breakpoints (simplified port of
      CompiledLibrary::GetLineStarts: without the code dump we can't skip ranges that only load variables)
      @param line - Line number
      @returns Code positions, empty if the line has no code
  */
  getLineStarts(line: number): number[] {
    const cached = this.lineStartsCache.get(line);
    if (cached)
      return cached;

    const ranges: Array<{ start: number; until: number }> = [];
    let last: SourceMapEntry | null = null;
    for (const entry of this.sourcemap) {
      if (last) {
        if (entry.line === last.line)
          continue;
        if (last.line === line)
          ranges.push({ start: last.codeptr, until: entry.codeptr });
      }
      last = entry;
    }
    if (last && last.line === line)
      ranges.push({ start: last.codeptr, until: this.debuginfo.codesize });

    const blocks = this.debuginfo.basicblockpositions;
    const result: number[] = [];
    for (const range of ranges) {
      result.push(range.start);
      // Every basic block starting inside the range is also a possible entry point
      for (let i = upperBound(blocks, range.start); i < blocks.length && blocks[i] < range.until; ++i)
        result.push(blocks[i]);
    }

    this.lineStartsCache.set(line, result);
    return result;
  }

  /** Find the first line at or after the requested line that has code (to move a breakpoint on an empty line) */
  findLineWithCode(line: number): number | null {
    let best: number | null = null;
    for (const entry of this.sourcemap)
      if (entry.line >= line && (best === null || entry.line < best))
        best = entry.line;
    return best;
  }
}

