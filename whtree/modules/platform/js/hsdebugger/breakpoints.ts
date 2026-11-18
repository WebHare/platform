/* Line breakpoints and stepping. Lines are mapped to code positions with a library's debug info.

   The C++ debugger stops a job at a code position in its breakpoint list (optionally only at a specific stack size), and at
   every instruction executed with a stack size outside [minstacksize, maxstacksize]. Stepping is built from those:
   - step in: stop at the first instruction of a deeper call (maxstacksize = current) or at the next line of this function
   - step over: stop at the next line of this function, or when it returns (minstacksize = current)
   - step out: stop when the function returns (minstacksize = current)
*/

import type { HSDebugJob } from "./client";
import type { DebugBreakpoint } from "./protocol";

export interface LineBreakpointRequest {
  liburi: string;
  line: number;
}

export interface ResolvedLineBreakpoint extends LineBreakpointRequest {
  /** Whether the breakpoint could be set */
  verified: boolean;
  /** Line the breakpoint ended up on (the first line with code at or after the requested line) */
  actualLine: number;
  /** Why the breakpoint couldn't be set */
  message?: string;
}

export type StepKind = "in" | "over" | "out";

const maxStackSize = 0x7fffffff;

/** Manages the breakpoints of a job the debugger is attached to */
export class JobBreakpoints {
  private readonly job: HSDebugJob;
  private userBreakpoints: DebugBreakpoint[] = [];
  private breakOnException = false;
  private stepping = false;

  constructor(job: HSDebugJob) {
    this.job = job;
  }

  /** Set the line breakpoints, replacing earlier ones. The job must be paused. Breakpoints in libraries the job hasn't
      loaded can't be set (the debugger needs the compile id of the loaded library)
  */
  async setLineBreakpoints(requests: LineBreakpointRequest[], { breakOnException = this.breakOnException }: { breakOnException?: boolean } = {}): Promise<ResolvedLineBreakpoint[]> {
    const libraries = new Map((await this.job.getLibraries()).map(lib => [lib.liburi, lib]));
    const breakpoints: DebugBreakpoint[] = [];
    const resolved: ResolvedLineBreakpoint[] = [];

    for (const req of requests) {
      const lib = libraries.get(req.liburi);
      if (!lib) {
        resolved.push({ ...req, verified: false, actualLine: req.line, message: "The job hasn't loaded this library" });
        continue;
      }

      const info = await this.job.getDebugInfo(req.liburi);
      const actualLine = info.findLineWithCode(req.line);
      const codeptrs = actualLine !== null ? info.getLineStarts(actualLine) : [];
      if (actualLine === null || !codeptrs.length) {
        resolved.push({ ...req, verified: false, actualLine: req.line, message: "No code at or after this line" });
        continue;
      }

      for (const codeptr of codeptrs)
        breakpoints.push({ liburi: req.liburi, compile_id: lib.compile_id, codeptr, stacksize: -1, manual: true });
      resolved.push({ ...req, verified: true, actualLine });
    }

    // Keep the breakpoints of other libraries
    const libs = new Set(requests.map(req => req.liburi));
    this.userBreakpoints = [...this.userBreakpoints.filter(bp => !libs.has(bp.liburi)), ...breakpoints];
    this.breakOnException = breakOnException;
    await this.apply();
    return resolved;
  }

  /** Replace all line breakpoints of a library (DAP sets breakpoints per source) */
  async setLibraryBreakpoints(liburi: string, lines: number[]): Promise<ResolvedLineBreakpoint[]> {
    this.userBreakpoints = this.userBreakpoints.filter(bp => bp.liburi !== liburi);
    if (!lines.length) {
      await this.apply();
      return [];
    }
    return await this.setLineBreakpoints(lines.map(line => ({ liburi, line })));
  }

  async setBreakOnException(enable: boolean) {
    this.breakOnException = enable;
    await this.apply();
  }

  private async apply() {
    await this.job.setBreakpoints({ breakpoints: this.userBreakpoints, breakOnException: this.breakOnException });
  }

  /** Prepare a step and let the job continue. The job must be paused. Call stepDone() when it stops again */
  async step(kind: StepKind): Promise<void> {
    const status = this.job.status;
    const frames = status.stacktrace ?? [];
    const stackSize = status.stacksize ?? frames.length;
    // The innermost HareScript frame (native frames have codeptr -1)
    const frame = frames.find(f => f.codeptr !== undefined && f.codeptr >= 0);

    let breakpoints = this.userBreakpoints;
    let minStackSize = 0, maxStack = maxStackSize;
    if (kind === "out" || !frame) {
      minStackSize = stackSize;
    } else {
      // Stop at the start of any other line of the library, but only at the current stack size
      const lib = (await this.job.getLibraries()).find(l => l.liburi === frame.filename);
      if (lib) {
        const info = await this.job.getDebugInfo(frame.filename);
        const lines = new Set(info.sourcemap.map(entry => entry.line));
        lines.delete(frame.line);
        const stepBreakpoints: DebugBreakpoint[] = [];
        for (const line of lines)
          for (const codeptr of info.getLineStarts(line))
            stepBreakpoints.push({ liburi: frame.filename, compile_id: lib.compile_id, codeptr, stacksize: stackSize, manual: false });
        breakpoints = [...breakpoints, ...stepBreakpoints];
      }
      minStackSize = stackSize;
      if (kind === "in")
        maxStack = stackSize;
    }

    this.stepping = true;
    await this.job.setBreakpoints({ breakpoints, breakOnException: this.breakOnException, minStackSize, maxStackSize: maxStack });
    this.job.continue();
  }

  /** Restore the user breakpoints after a step stopped */
  async stepDone(): Promise<void> {
    if (!this.stepping)
      return;
    this.stepping = false;
    await this.apply();
  }
}
