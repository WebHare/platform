/**
 * HareScript function profiles for the MCP server. Profiles are too big to hand to a model as a whole, so the server
 * keeps them (for its own lifetime) and offers tools to query them: the top functions, and the callers and callees of a function.
 *
 * Profiles come from three sources, like in the HareScript debugger and profiler app:
 * - profiling a running job for a while (wh_debug_profile_job)
 * - live profiles reported to the global 'system:profiles' port (wh_debug_profile_listener), eg by tests run with profiling,
 *   profiled managed tasks, and requests and RPCs with the 'apr' debug option
 * - profiles stored on disk when the 'apr' debug tag is set (caches/platform/hs-profiles/<session>/)
 */
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { callJobDebugger, callJobDebuggerIsolated } from "./jobdebuggerlib";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const profilesPortName = "system:profiles";

export const profileJobToolName = "wh_debug_profile_job";
export const profileListenerToolName = "wh_debug_profile_listener";
export const listProfilesToolName = "wh_debug_list_profiles";
export const profileFunctionsToolName = "wh_debug_profile_functions";
export const profileFunctionToolName = "wh_debug_profile_function";

const defaultProfileDuration = 5000;
const maxProfileDuration = 60000;
/** Maximum time to wait for the job to pause at the start and end of profiling */
const pauseTimeout = 5000;
/** Maximum number of live profiles kept (oldest are dropped) */
const maxLiveProfiles = 200;
/** Maximum number of analysed profiles kept in memory (least recently used are dropped, but can be recaptured or reloaded) */
const maxCachedProfiles = 50;

interface RawProfile {
  items: Array<{ location: number; parentlocation: number; callcount: number; selftime: number; totaltime: number; totaltime_callee_nr: number }>;
  locations: Array<{ id: number; func: string; library: string; line: number; col: number }>;
}

interface ProfileFunction {
  location: number;
  name: string;
  library: string;
  line: number;
  calls: number;
  /** Time spent in the function and its callees (ms), recursion counted once */
  total: number;
  /** Time spent in the function itself (ms) */
  self: number;
}

interface ProfileRelation {
  parent: number;
  child: number;
  calls: number;
  total: number;
  self: number;
}

interface AnalysedProfile {
  id: string;
  description: string;
  when: Date | null;
  totalSelf: number;
  functions: Map<number, ProfileFunction>;
  relations: ProfileRelation[];
}

interface LiveProfile {
  id: string;
  description: string;
  when: Date;
  type: string;
  rawdata: RawProfile | null;
}

/** Turn a raw function profile into per-function totals and caller/callee relations (like DisplayedFunctionProfile in
    mod::system/lib/internal/debugger/profilingsupport.whlib) */
export function analyseProfile(id: string, description: string, when: Date | null, raw: RawProfile): AnalysedProfile {
  const locations = new Map(raw.locations.map(loc => [loc.id, loc]));
  const functions = new Map<number, ProfileFunction>();
  const relations = new Map<string, ProfileRelation>();

  const getFunction = (location: number) => {
    let func = functions.get(location);
    if (!func) {
      const loc = locations.get(location);
      func = {
        location,
        name: location === 0 ? "(root)" : (loc?.func.split("::")[0] || `location #${location}`),
        library: loc?.library ?? "",
        line: loc?.line ?? 0,
        calls: 0, total: 0, self: 0
      };
      functions.set(location, func);
    }
    return func;
  };

  let totalSelf = 0;
  for (const item of raw.items) {
    const self = Number(item.selftime) * 1000;
    const func = getFunction(item.location);
    func.calls += Number(item.callcount);
    func.self += self;
    func.total += Number(item.totaltime_callee_nr) * 1000;
    totalSelf += self;

    getFunction(item.parentlocation); //make sure callers that weren't profiled themselves (eg the entry point) are listed
    const key = `${item.parentlocation}\t${item.location}`;
    const relation = relations.get(key) ?? { parent: item.parentlocation, child: item.location, calls: 0, total: 0, self: 0 };
    relation.calls += Number(item.callcount);
    relation.total += Number(item.totaltime) * 1000;
    relation.self += self;
    relations.set(key, relation);
  }

  // Callers that weren't profiled themselves: their total is the time spent in their callees
  for (const func of functions.values())
    if (func.calls === 0)
      func.total = [...relations.values()].filter(rel => rel.parent === func.location).reduce((sum, rel) => sum + rel.total, 0);

  return { id, description, when, totalSelf, functions, relations: [...relations.values()] };
}

class ProfileStore {
  private analysed = new Map<string, AnalysedProfile>();
  private live: LiveProfile[] = [];
  private captureCounter = 0;
  private liveCounter = 0;
  private port: ReturnType<typeof bridge.createPort> | null = null;
  private listeningSince: Date | null = null;

  private remember(profile: AnalysedProfile) {
    this.analysed.delete(profile.id); //re-insert to mark as recently used
    this.analysed.set(profile.id, profile);
    while (this.analysed.size > maxCachedProfiles)
      this.analysed.delete(this.analysed.keys().next().value!);
    return profile;
  }

  async captureJob(groupid: string, duration: number): Promise<AnalysedProfile> {
    const raw = await callJobDebuggerIsolated<RawProfile>("ProfileDebugJob", groupid, duration, pauseTimeout);
    const id = `job-${++this.captureCounter}`;
    return this.remember(analyseProfile(id, `job ${groupid}, profiled for ${duration}ms`, new Date, raw));
  }

  async get(id: string): Promise<AnalysedProfile> {
    const cached = this.analysed.get(id);
    if (cached)
      return this.remember(cached);

    const live = this.live.find(profile => profile.id === id);
    if (live) {
      if (!live.rawdata || live.type !== "functionprofile")
        throw new Error(`Profile '${id}' is a ${live.type}; only function profiles can be analysed`);
      return this.remember(analyseProfile(id, live.description, live.when, live.rawdata));
    }

    const stored = id.match(/^stored:([^/]+)\/(.+)$/);
    if (stored) {
      const result = await callJobDebugger<{ header: { type?: string; script?: string; groupid?: string; profilingstart?: string }; rawdata: RawProfile }>("ReadStoredProfile", stored[1], stored[2]);
      if (result.header.type && result.header.type !== "functionprofile")
        throw new Error(`Profile '${id}' is a ${result.header.type}; only function profiles can be analysed`);
      const when = result.header.profilingstart ? new Date(result.header.profilingstart) : null;
      return this.remember(analyseProfile(id, `${result.header.script ?? "?"} (job ${result.header.groupid ?? "?"})`, when, result.rawdata));
    }

    throw new Error(`Unknown profile '${id}'. Use ${listProfilesToolName} to find profiles`);
  }

  listInMemory() {
    return {
      captured: [...this.analysed.values()].filter(profile => profile.id.startsWith("job-")),
      live: this.live
    };
  }

  async startListening(): Promise<string> {
    if (this.port)
      return `Already listening for live profiles since ${this.listeningSince!.toISOString()}`;

    const port = bridge.createPort(profilesPortName, { global: true });
    port.on("accept", link => {
      link.on("message", packet => {
        // Reports are sent as fire-and-forget messages, but the profiler app acks them, so do the same
        const msg = packet.message as { task?: string; source?: string; command?: string; start?: Date; type?: string; rawdata?: RawProfile };
        if (packet.msgid)
          link.send({ type: "ack" }, packet.msgid);
        if (msg?.task === "addprofile")
          this.addLive(msg);
      });
      void link.activate();
    });
    try {
      await port.activate();
    } catch (e) {
      port.close();
      throw new Error(`Could not register the global port '${profilesPortName}' (is the profiler app listening to live profiles?): ${(e as Error).message}`);
    }
    this.port = port;
    this.listeningSince = new Date;
    return `Listening for live profiles on '${profilesPortName}'. They will be listed by ${listProfilesToolName}`;
  }

  stopListening(): string {
    if (!this.port)
      return "Not listening for live profiles";
    this.port.close();
    this.port = null;
    this.listeningSince = null;
    return `Stopped listening for live profiles. The ${this.live.length} received profile(s) remain available`;
  }

  status(): string {
    return this.port
      ? `Listening for live profiles since ${this.listeningSince!.toISOString()}, ${this.live.length} profile(s) received (keeping at most ${maxLiveProfiles})`
      : `Not listening for live profiles${this.live.length ? `, ${this.live.length} earlier received profile(s) available` : ""}`;
  }

  private addLive(msg: { source?: string; command?: string; start?: Date; type?: string; rawdata?: RawProfile }) {
    this.live.push({
      id: `live-${++this.liveCounter}`,
      description: [msg.source, msg.command].filter(Boolean).join(": ") || "(unknown source)",
      when: msg.start instanceof Date ? msg.start : new Date,
      type: msg.type ?? "functionprofile",
      rawdata: msg.rawdata ?? null
    });
    if (this.live.length > maxLiveProfiles)
      this.live.splice(0, this.live.length - maxLiveProfiles);
  }
}

const store = new ProfileStore;

const profileProperty = {
  type: "string",
  description: `Profile id, as returned by ${profileJobToolName} or ${listProfilesToolName}`
};

export const profileTools: Tool[] = [
  {
    name: profileJobToolName,
    description: `Profile a running HareScript job for a while (function profile) to find out where it spends its time. `
      + `Returns a profile id and the functions with the most self time; use ${profileFunctionsToolName} and ${profileFunctionToolName} to dig in. `
      + `The job keeps running while it's profiled; it's only paused briefly at the start and end. Get the group id from wh_debug_list_jobs. `
      + `For short-lived scripts use stored profiles instead (see ${listProfilesToolName}).`,
    inputSchema: {
      type: "object",
      properties: {
        groupid: { type: "string", description: "Group id of the job" },
        duration: { type: "number", description: `How long to profile in milliseconds (default ${defaultProfileDuration}, max ${maxProfileDuration})` }
      },
      required: ["groupid"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: profileListenerToolName,
    description: `Start or stop collecting live HareScript profiles, like the profiler app's 'live' session. `
      + `While listening, profiles reported to the global '${profilesPortName}' port are kept (the last ${maxLiveProfiles}) and listed by ${listProfilesToolName}. `
      + `They're reported by eg tests run with profiling, managed tasks with profiling enabled, and requests and RPCs made with the 'apr' debug option. `
      + `Only one listener can be active, so this fails while the profiler app is showing live profiles.`,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "stop", "status"], description: "What to do" }
      },
      required: ["action"]
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  {
    name: listProfilesToolName,
    description: `List the available HareScript profiles: profiles captured with ${profileJobToolName}, live profiles (see ${profileListenerToolName}) `
      + `and profiles stored on disk, newest first. Stored profiles are written for every HareScript script that ends while the 'apr' debug tag is set `
      + `(\`wh harescript-debug setconfig apr\`; clear it again with \`wh harescript-debug setconfig\`), in a session folder ('default' unless configured otherwise).`,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session to list the stored profiles of (default 'default')" },
        filter: { type: "string", description: "Only list profiles whose description, script, file name or group id contains this text (case insensitive)" },
        limit: { type: "number", description: "Maximum number of profiles to list per source (default 20)" }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: profileFunctionsToolName,
    description: `Show the top functions of a HareScript function profile, sorted by self time, total time or call count. `
      + `Times are in milliseconds; total time includes callees (recursion counted once). Use the function id with ${profileFunctionToolName} to see its callers and callees.`,
    inputSchema: {
      type: "object",
      properties: {
        profile: profileProperty,
        sort: { type: "string", enum: ["self", "total", "calls"], description: "Sort order (default 'self')" },
        limit: { type: "number", description: "Number of functions to show (default 20, max 200)" },
        filter: { type: "string", description: "Only show functions whose name or library contains this text (case insensitive)" }
      },
      required: ["profile"]
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: profileFunctionToolName,
    description: `Show one function of a HareScript function profile with its callers (who called it, how often and how much time those calls took) `
      + `and callees (what it called and how much time that took), sorted by time. Follow callers or callees by calling this again with their function id.`,
    inputSchema: {
      type: "object",
      properties: {
        profile: profileProperty,
        function: { type: "string", description: "Function id (as shown in the profile tools) or the exact function name, eg 'MYOBJECT#DOWORK'" },
        limit: { type: "number", description: "Maximum number of callers and callees to show each (default 15)" }
      },
      required: ["profile", "function"]
    },
    annotations: { readOnlyHint: true }
  }
];

const ms = (value: number) => value.toFixed(3);

function describeFunction(func: ProfileFunction) {
  return `[${func.location}] ${func.name}${func.library ? ` (${func.library}${func.line ? `:${func.line}` : ""})` : ""}`;
}

function formatTop(profile: AnalysedProfile, sort: "self" | "total" | "calls", limit: number, filter: string): string {
  const needle = filter.toLowerCase();
  const funcs = [...profile.functions.values()]
    .filter(func => func.location !== 0 && (!needle || func.name.toLowerCase().includes(needle) || func.library.toLowerCase().includes(needle)))
    .sort((a, b) => b[sort] - a[sort]);

  const lines = [
    `Profile ${profile.id}: ${profile.description}${profile.when ? `, ${profile.when.toISOString()}` : ""}`,
    `Total self time ${ms(profile.totalSelf)}ms in ${profile.functions.size - (profile.functions.has(0) ? 1 : 0)} functions. Top ${Math.min(limit, funcs.length)} of ${funcs.length}${filter ? ` matching '${filter}'` : ""} by ${sort}:`,
    `  self ms (%)       | total ms   | calls    | function`
  ];
  for (const func of funcs.slice(0, limit)) {
    const pct = profile.totalSelf ? (func.self / profile.totalSelf * 100).toFixed(1) : "0.0";
    lines.push(`  ${ms(func.self).padStart(10)} (${pct.padStart(4)}%) | ${ms(func.total).padStart(10)} | ${String(func.calls).padStart(8)} | ${describeFunction(func)}`);
  }
  return lines.join("\n");
}

function findFunction(profile: AnalysedProfile, spec: string): ProfileFunction {
  const asNumber = Number(spec.replace(/^\[|\]$/g, ""));
  if (Number.isInteger(asNumber) && profile.functions.has(asNumber))
    return profile.functions.get(asNumber)!;

  const upper = spec.toUpperCase();
  const matches = [...profile.functions.values()].filter(func => func.name.toUpperCase() === upper);
  if (matches.length === 1)
    return matches[0];
  if (matches.length > 1)
    throw new Error(`Function name '${spec}' is ambiguous, use one of the ids: ${matches.map(describeFunction).join(", ")}`);
  throw new Error(`No function '${spec}' in profile ${profile.id}. Use ${profileFunctionsToolName} with a filter to find it`);
}

function formatFunction(profile: AnalysedProfile, spec: string, limit: number): string {
  const func = findFunction(profile, spec);
  const lines = [
    `${describeFunction(func)} in profile ${profile.id}`,
    `self ${ms(func.self)}ms, total ${ms(func.total)}ms, ${func.calls} call(s)`
  ];

  const formatRelations = (title: string, rels: ProfileRelation[], other: (rel: ProfileRelation) => number) => {
    rels.sort((a, b) => b.total - a.total);
    lines.push("", rels.length ? `${rels.length} ${title}:` : `${title.replace(/ \(.*/, "")}: none`);
    for (const rel of rels.slice(0, limit)) {
      const target = profile.functions.get(other(rel));
      lines.push(`  ${ms(rel.total).padStart(10)}ms total, ${ms(rel.self).padStart(10)}ms self, ${String(rel.calls).padStart(7)} call(s) | ${target ? describeFunction(target) : `[${other(rel)}]`}`);
    }
    if (rels.length > limit)
      lines.push(`  ... ${rels.length - limit} more`);
  };

  formatRelations("Callers (time of the calls to this function from each caller; self = time in this function itself)",
    profile.relations.filter(rel => rel.child === func.location && rel.parent !== func.location), rel => rel.parent);
  formatRelations("Callees (time of this function's calls to each callee; self = time in the callee itself)",
    profile.relations.filter(rel => rel.parent === func.location && rel.child !== func.location), rel => rel.child);
  const recursive = profile.relations.find(rel => rel.parent === func.location && rel.child === func.location);
  if (recursive)
    lines.push("", `Calls itself recursively: ${recursive.calls} call(s)`);
  return lines.join("\n");
}

async function listProfiles(session: string, filter: string, limit: number): Promise<string> {
  const needle = filter.toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const { captured, live } = store.listInMemory();
  const lines: string[] = [];

  const shownCaptured = captured.filter(profile => matches(profile.description)).reverse().slice(0, limit);
  if (shownCaptured.length) {
    lines.push("Captured with " + profileJobToolName + ":");
    for (const profile of shownCaptured)
      lines.push(`- ${profile.id}: ${profile.description}, ${profile.when?.toISOString()}, ${ms(profile.totalSelf)}ms`);
    lines.push("");
  }

  lines.push(store.status() + (live.length ? ":" : ""));
  const shownLive = live.filter(profile => matches(profile.description)).reverse().slice(0, limit);
  for (const profile of shownLive)
    lines.push(`- ${profile.id}: ${profile.description}, ${profile.when.toISOString()}${profile.type !== "functionprofile" ? ` (${profile.type})` : ""}`);

  lines.push("");
  const sessions = await callJobDebugger<string[]>("ListStoredProfileSessions");
  if (!sessions.includes(session)) {
    lines.push(`No stored profiles in session '${session}'${sessions.length ? `. Sessions: ${sessions.join(", ")}` : ""}`);
  } else {
    const stored = await callJobDebugger<Array<{ filename: string; type: string; script: string; groupid: string; profilingstart: string; size: bigint | number; totalcount: number }>>("ListStoredProfiles", session, filter, limit);
    lines.push(stored.length
      ? `Stored profiles in session '${session}' (${stored.length} of ${stored[0].totalcount}, newest first${sessions.length > 1 ? `; other sessions: ${sessions.filter(s => s !== session).join(", ")}` : ""}):`
      : `No stored profiles in session '${session}'${filter ? ` matching '${filter}'` : ""}`);
    for (const profile of stored)
      lines.push(`- stored:${session}/${profile.filename}: ${profile.script} (job ${profile.groupid}), ${profile.profilingstart}, ${Math.round(Number(profile.size) / 1024)}KB${profile.type !== "functionprofile" ? ` (${profile.type})` : ""}`);
  }
  return lines.join("\n");
}

function clamp(value: unknown, defaultValue: number, min: number, max: number): number {
  const num = Number(value);
  return value !== undefined && Number.isFinite(num) ? Math.min(Math.max(Math.round(num), min), max) : defaultValue;
}

/** Run a profile tool. Returns null if the tool isn't a profile tool */
export async function runProfileTool(name: string, args: Record<string, unknown> | undefined): Promise<string | null> {
  switch (name) {
    case profileJobToolName: {
      if (!args?.groupid)
        throw new Error("Missing groupid");
      const profile = await store.captureJob(String(args.groupid), clamp(args.duration, defaultProfileDuration, 100, maxProfileDuration));
      return formatTop(profile, "self", 10, "");
    }

    case profileListenerToolName:
      switch (args?.action) {
        case "start": return await store.startListening();
        case "stop": return store.stopListening();
        case "status": return store.status();
      }
      throw new Error("action must be 'start', 'stop' or 'status'");

    case listProfilesToolName:
      return await listProfiles(args?.session ? String(args.session) : "default", args?.filter ? String(args.filter) : "", clamp(args?.limit, 20, 1, 200));

    case profileFunctionsToolName: {
      if (!args?.profile)
        throw new Error("Missing profile");
      const sort = args.sort === "total" || args.sort === "calls" ? args.sort : "self";
      return formatTop(await store.get(String(args.profile)), sort, clamp(args.limit, 20, 1, 200), args.filter ? String(args.filter) : "");
    }

    case profileFunctionToolName: {
      if (!args?.profile || args.function === undefined)
        throw new Error("Missing profile or function");
      return formatFunction(await store.get(String(args.profile)), String(args.function), clamp(args.limit, 15, 1, 200));
    }
  }
  return null;
}
