import * as test from "@webhare/test-backend";
import { spawn, type ChildProcess } from "node:child_process";
import { backendConfig, importJSFunction } from "@webhare/services";
import { generateRandomId, Money } from "@webhare/std";
import { HSDebugConnection, durationToMsecs } from "@mod-platform/js/hsdebugger/client";
import { getJobStack } from "@mod-platform/js/hsdebugger/stack";
import { listStoredProfileSessions, listStoredProfiles, readStoredProfile } from "@mod-platform/js/hsdebugger/profiles";
import { encodeHSON } from "@webhare/hscompat";
import { HSDebugAgentClient } from "@mod-platform/js/hsdebugger/agentclient";
import { decodeWire, encodeWire } from "@mod-platform/js/hsdebugger/wire";
import { PauseReason, type DebugJobStatus } from "@mod-platform/js/hsdebugger/protocol";
import type { StackFrameWithVariables } from "@mod-platform/js/hsdebugger/stack";
import type { ResolvedLineBreakpoint } from "@mod-platform/js/hsdebugger/breakpoints";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { describeValue, getHareScriptTypeName } from "@mod-platform/js/hsdebugger/variables";

const targetScript = "mod::webhare_testsuite/tests/system/debugger/data/debugtarget.whscr";

let target: ChildProcess | undefined;
let marker = "";
let groupid = "";

async function startTarget() {
  marker = "hsdebugger-" + generateRandomId();
  process.on("exit", () => target?.kill()); // don't leave the target running if the test fails
  target = spawn(backendConfig.installationRoot + "bin/wh", ["run", targetScript, marker], { stdio: ["ignore", "pipe", "inherit"] });
  // Wait for the script to report it's waiting
  await new Promise<void>((resolve, reject) => {
    target!.stdout!.on("data", (data: Buffer) => { if (data.toString().includes("ready")) resolve(); });
    target!.on("exit", code => reject(new Error(`Debug target exited with code ${code}`)));
  });
}

function stopTarget() {
  target?.kill();
  target = undefined;
}

async function testListJobs() {
  await using conn = await HSDebugConnection.connect();
  const processes = await conn.listProcesses();
  test.assert(processes.length > 0, "No HareScript processes registered with the debug manager");
  test.eq("bigint", typeof processes[0].processcode);

  // The target registers with the debug manager when it starts, give it a moment
  // Take the newest target, in case one of an earlier failed run is still around
  const job = await test.wait(async () => (await conn.listAllJobs())
    .filter(entry => entry.script.endsWith("debugtarget.whscr"))
    .sort((a, b) => b.creationdate.getTime() - a.creationdate.getTime())[0]);
  test.eq(false, job.connected);
  // The job mostly sleeps, so it should have been running for far less than a minute
  test.assert(durationToMsecs(job.total_running) >= 0 && durationToMsecs(job.total_running) < 60_000, `Unexpected running time ${durationToMsecs(job.total_running)}`);
  groupid = job.groupid;

  await test.throws(/No job with group id/, conn.findJob("no-such-job"));
}

async function testStack() {
  await using conn = await HSDebugConnection.connect();
  const result = await conn.withPausedJob(groupid, async (job, status) => {
    test.eq("DebugStopped", status.realstatus);
    test.assert(job.paused);
    const stack = await getJobStack(job, status, { variableFrames: [0, 1, 2, 3], maxDepth: 3 });
    return { stack, libraries: await job.getLibraries() };
  });

  test.assert(result.libraries.some(lib => lib.liburi === targetScript));
  const frameIdx = result.stack.findIndex(frame => frame.func.startsWith("WAITINTARGET"));
  test.assert(frameIdx >= 0, `WaitInTarget not found in the stack: ${result.stack.map(f => f.func).join(", ")}`);
  const frame = result.stack[frameIdx];
  test.eq(targetScript, frame.filename);

  // The innermost frames are Sleep and its helpers (native) or WaitInTarget itself. Request variables of the frame if we didn't yet
  test.assert(frameIdx <= 3, "WaitInTarget should be one of the innermost frames");
  test.eq("", frame.variablesError);
  test.assert(frame.hasVariables);

  const vars = Object.fromEntries(frame.variables.map(v => [v.name, v]));
  test.eq(`"hello ${marker}"`, vars.LOCALTEXT?.value);
  test.eq(`"${marker}"`, vars.MARKER?.value);
  test.eq("INTEGER ARRAY (3 items)", vars.NUMBERS?.value);
  test.eq(["1", "2", "3"], vars.NUMBERS.members.map(m => m.value));
  test.eq("RECORD (3 cells)", vars.INFO?.value);
  const info = Object.fromEntries(vars.INFO.members.map(m => [m.name, m]));
  test.eq("42", info.A.value);
  test.eq(`"two"`, info.B.value);
  test.eq("TRUE", info.C.members[0].value);
}

async function testJobContinues() {
  await using conn = await HSDebugConnection.connect();
  const job = await conn.attach(groupid);
  test.eq(false, job.paused);
  await job.pause();
  test.assert(job.paused);
  job.continue();
  await job.waitForStatus(status => status.realstatus !== "DebugStopped");
  job.detach();

  // After detaching, someone else can attach again
  const job2 = await conn.attach(groupid);
  await test.throws(/Already attached/, conn.attach(groupid));
  job2.detach();

  // Two connections can't attach to the same job
  await using conn2 = await HSDebugConnection.connect();
  const job3 = await conn.attach(groupid);
  await test.throws(/already attached/, conn2.attach(groupid));
  job3.detach();
}

async function testErrors() {
  await using conn = await HSDebugConnection.connect();
  const job = await conn.attach(groupid);
  try {
    // Variables can only be requested from a paused job
    await test.throws(/notpaused|notstopped/, job.getVariables([{ id: 1 }]));
  } finally {
    job.detach();
  }
}

async function testHandles() {
  await using conn = await HSDebugConnection.connect();
  const handles = await conn.withPausedJob(groupid, job => job.getHandleList());
  test.assert(Array.isArray(handles));
}

async function testProfile() {
  await using conn = await HSDebugConnection.connect();
  const job = await conn.attach(groupid);
  try {
    await job.pause();
    await job.setProfiling("function", true, true);
    job.continue();
    await test.sleep(300);
    await job.pause();
    await job.setProfiling("all", false, false);
    const profile = await job.getFunctionProfile();
    job.continue();

    const compute = profile.locations.find(loc => loc.func.startsWith("COMPUTESOMETHING"));
    test.assert(compute, "ComputeSomething not in the profile");
    test.eq(targetScript, compute.library);
    const calls = profile.items.filter(item => item.location === compute.id).reduce((sum, item) => sum + item.callcount, 0);
    test.assert(calls > 0);
  } finally {
    job.detach();
  }
}

async function testDebugInfo() {
  await using conn = await HSDebugConnection.connect();
  await conn.withPausedJob(groupid, async job => {
    const info = await job.getDebugInfo(targetScript);
    test.eq(1, info.debuginfo.version);
    test.assert(info.debuginfo.variables.some(v => v.name === "LOCALTEXT"));
    test.assert(info.sourcemap.length > 0);

    // The "rounds := rounds + 1" line should have code
    test.assert(info.getLineStarts(22).length > 0, "No code for line 22");
    test.eq([], info.getLineStarts(2)); // comment line
    test.eq(22, info.getSourcePosition(info.getLineStarts(22)[0])?.line);

    await test.throws(/hasn't loaded/, job.getDebugInfo("mod::system/lib/not-loaded.whlib"));
  });
}

async function testStoredProfiles() {
  // Write a profile the way preload.whlib does: a JSON header line followed by the HSON encoded raw profile
  const session = "test-hsdebugger-" + generateRandomId();
  const dir = path.join(backendConfig.dataRoot, "caches/platform/hs-profiles", session);
  await mkdir(dir, { recursive: true });
  try {
    const rawdata = {
      items: [{ callcount: 3, location: 1, parentlocation: 0, selftime: 0.5, totaltime: 1.5, totaltime_callee_nr: 1.5 }],
      locations: [{ id: 1, library: "mod::x/y.whlib", func: "MYFUNC:::", line: 10, col: 1 }]
    };
    const header = { type: "functionprofile", script: "mod::x/y.whscr", groupid: "testgroup", profilingstart: "2026-01-01T00:00:00.000Z" };
    await writeFile(path.join(dir, "20260101T000000000-testgroup.prof"), JSON.stringify(header) + "\n" + encodeHSON(rawdata));
    await writeFile(path.join(dir, "20250101T000000000-other.prof"), JSON.stringify({ ...header, groupid: "other" }) + "\n" + encodeHSON(rawdata));

    test.assert((await listStoredProfileSessions()).includes(session));
    const all = await listStoredProfiles(session);
    test.eq(2, all.totalCount);
    test.eq(["20260101T000000000-testgroup.prof", "20250101T000000000-other.prof"], all.profiles.map(p => p.filename)); //newest first
    test.eqPartial({ type: "functionprofile", script: "mod::x/y.whscr", groupid: "testgroup" }, all.profiles[0]);

    const filtered = await listStoredProfiles(session, { filter: "OTHER", limit: 10 });
    test.eq(["20250101T000000000-other.prof"], filtered.profiles.map(p => p.filename));

    const profile = await readStoredProfile(session, "20260101T000000000-testgroup.prof");
    test.eq("testgroup", profile.header.groupid);
    test.eq("MYFUNC:::", profile.rawdata.locations[0].func);
    test.eq(3, profile.rawdata.items[0].callcount);

    await test.throws(/Invalid file name/, readStoredProfile(session, "../x.prof"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function testWire() {
  const value = { a: 1n, b: new Date("2026-01-01T00:00:00Z"), c: new Money("1.5"), d: [{ e: "x" }], f: null };
  const decoded = decodeWire(encodeWire(value)) as typeof value;
  test.eq(1n, decoded.a);
  test.eq(value.b.getTime(), decoded.b.getTime());
  test.eq("1.5", decoded.c.value);
  test.eq([{ e: "x" }], decoded.d);
}

/** Wait for a jobStatus notification matching a condition */
function waitForAgentStatus(agent: HSDebugAgentClient, condition: (status: DebugJobStatus) => boolean): Promise<DebugJobStatus> {
  return new Promise(resolve => {
    const cb = agent.on("jobStatus", ({ groupid: eventGroupid, status }) => {
      if (eventGroupid === groupid && condition(status)) {
        agent.off(cb);
        resolve(status);
      }
    });
  });
}

async function testAgent() {
  // Run the agent the way a remote debugger would, as a separate process talking over stdin/stdout
  using agent = HSDebugAgentClient.spawn([backendConfig.installationRoot + "bin/wh", "debug", "harescript-agent"]);
  const hello = await agent.call<{ version: number; dataRoot: string }>("hello");
  test.eq(1, hello.version);
  test.eq(backendConfig.dataRoot, hello.dataRoot);

  const jobs = await agent.call<Array<{ groupid: string }>>("listJobs", { filter: "debugtarget" });
  test.assert(jobs.some(job => job.groupid === groupid));

  await agent.call("attach", { groupid });
  try {
    const paused = await agent.call<DebugJobStatus>("pause", { groupid });
    test.eq("DebugStopped", paused.realstatus);

    const stack = await agent.call<StackFrameWithVariables[]>("getStack", { groupid, variableFrames: [3] });
    test.eq(`"${marker}"`, stack[3].variables.find(v => v.name === "MARKER")?.value);

    // Break on the 'rounds := rounds + 1' line
    const bps = await agent.call<ResolvedLineBreakpoint[]>("setBreakpoints", { groupid, liburi: targetScript, lines: [22] });
    test.eqPartial([{ verified: true, actualLine: 22 }], bps);

    // A breakpoint on a line without code moves to the next line with code
    const moved = await agent.call<ResolvedLineBreakpoint[]>("setBreakpoints", { groupid, liburi: targetScript, lines: [21] }); // the '{' after WHILE
    test.eqPartial([{ verified: true }], moved);
    test.assert(moved[0].actualLine > 21);
    await agent.call("setBreakpoints", { groupid, liburi: targetScript, lines: [22] });

    let stopped = waitForAgentStatus(agent, status => status.realstatus === "DebugStopped");
    await agent.call("continue", { groupid });
    let status = await stopped;
    test.assert(status.pausereason & (PauseReason.breakpoint | PauseReason.manualBreakpoint), `Expected a breakpoint stop, got pause reason ${status.pausereason}`);
    test.eq(22, status.stacktrace?.[0].line);

    // Step over to the next line
    stopped = waitForAgentStatus(agent, s => s.realstatus === "DebugStopped");
    await agent.call("step", { groupid, kind: "over" });
    status = await stopped;
    test.eq(23, status.stacktrace?.[0].line);
    test.eq("WAITINTARGET", status.stacktrace?.[0].func.split(":")[0]);

    // Step into ComputeSomething
    stopped = waitForAgentStatus(agent, s => s.realstatus === "DebugStopped");
    await agent.call("step", { groupid, kind: "in" });
    status = await stopped;
    test.eq("COMPUTESOMETHING", status.stacktrace?.[0].func.split(":")[0]);

    // And out again
    stopped = waitForAgentStatus(agent, s => s.realstatus === "DebugStopped");
    await agent.call("step", { groupid, kind: "out" });
    status = await stopped;
    test.eq("WAITINTARGET", status.stacktrace?.[0].func.split(":")[0]);

    // Clear the breakpoints, the job should keep running
    await agent.call("setBreakpoints", { groupid, liburi: targetScript, lines: [] });
    const source = await agent.call<{ source: string }>("readSource", { liburi: targetScript });
    test.assert(source.source.includes("MACRO WaitInTarget"));
  } finally {
    await agent.call("continue", { groupid });
    await agent.call("detach", { groupid });
  }

  // The job continues after detaching (which doesn't wait for a reply, so wait for the debug manager to see it)
  await using conn = await HSDebugConnection.connect();
  const processcode = (await conn.findJob(groupid)).processcode;
  await test.wait(async () => (await conn.listJobs(processcode)).find(j => j.groupid === groupid && !j.connected));
}

/** Minimal DAP client for testing the adapter */
class DAPTestClient {
  private seq = 0;
  private buffer = Buffer.alloc(0);
  private responses = new Map<number, PromiseWithResolvers<{ success: boolean; message?: string; body: Record<string, unknown> }>>();
  events: Array<{ event: string; body: Record<string, unknown> }> = [];
  private eventWaiters: Array<{ event: string; resolve: (body: Record<string, unknown>) => void }> = [];
  readonly proc: ChildProcess;

  constructor() {
    this.proc = spawn(backendConfig.installationRoot + "bin/wh", ["debug", "harescript-dap"], { stdio: ["pipe", "pipe", "inherit"] });
    this.proc.stdout!.on("data", (chunk: Buffer) => this.gotData(chunk));
  }

  private gotData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (; ;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0)
        return;
      const length = Number(this.buffer.subarray(0, headerEnd).toString().match(/Content-Length: (\d+)/)![1]);
      if (this.buffer.length < headerEnd + 4 + length)
        return;
      const msg = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      if (msg.type === "response")
        this.responses.get(msg.request_seq)?.resolve(msg);
      else if (msg.type === "event") {
        this.events.push(msg);
        const waiter = this.eventWaiters.find(w => w.event === msg.event);
        if (waiter) {
          this.eventWaiters.splice(this.eventWaiters.indexOf(waiter), 1);
          waiter.resolve(msg.body);
        }
      }
    }
  }

  async request(command: string, args: Record<string, unknown> = {}) {
    const seq = ++this.seq;
    const defer = Promise.withResolvers<{ success: boolean; message?: string; body: Record<string, unknown> }>();
    this.responses.set(seq, defer);
    const body = JSON.stringify({ seq, type: "request", command, arguments: args });
    this.proc.stdin!.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const response = await defer.promise;
    if (!response.success)
      throw new Error(`DAP request ${command} failed: ${response.message}`);
    return response.body;
  }

  waitForEvent(event: string): Promise<Record<string, unknown>> {
    return new Promise(resolve => this.eventWaiters.push({ event, resolve }));
  }
}

async function testDAP() {
  const dap = new DAPTestClient();
  try {
    const caps = await dap.request("initialize", { adapterID: "harescript" });
    test.eq(true, caps.supportsConfigurationDoneRequest);

    const initialized = dap.waitForEvent("initialized");
    await dap.request("attach", { script: "debugtarget.whscr" });
    await initialized;

    // Set a breakpoint on the 'rounds := rounds + 1' line by file path
    const targetPath = backendConfig.module.webhare_testsuite.root + "tests/system/debugger/data/debugtarget.whscr";
    const bps = await dap.request("setBreakpoints", { source: { path: targetPath }, breakpoints: [{ line: 22 }] });
    test.eqPartial([{ verified: true }], bps.breakpoints as unknown[]);

    let stopped = dap.waitForEvent("stopped");
    await dap.request("configurationDone");
    test.eqPartial({ reason: "breakpoint", threadId: 1 }, await stopped);

    const threads = await dap.request("threads");
    test.eqPartial([{ id: 1, name: targetScript }], threads.threads as unknown[]);

    const stack = await dap.request("stackTrace", { threadId: 1 });
    const frames = stack.stackFrames as Array<{ id: number; name: string; line: number; source: { path?: string } }>;
    test.eqPartial({ line: 22, source: { path: targetPath } }, frames[0]);

    const scopes = await dap.request("scopes", { frameId: frames[0].id });
    const locals = (scopes.scopes as Array<{ variablesReference: number }>)[0];
    const vars = (await dap.request("variables", { variablesReference: locals.variablesReference })).variables as Array<{ name: string; value: string; variablesReference: number }>;
    test.eq(`"${marker}"`, vars.find(v => v.name === "MARKER")?.value);
    const info = vars.find(v => v.name === "INFO")!;
    test.assert(info.variablesReference > 0, "INFO should be expandable");
    const infoMembers = (await dap.request("variables", { variablesReference: info.variablesReference })).variables as Array<{ name: string; value: string; variablesReference: number }>;
    test.eqPartial([{ name: "A", value: "42" }, { name: "B", value: `"two"` }, { name: "C" }], infoMembers);
    const nested = (await dap.request("variables", { variablesReference: infoMembers[2].variablesReference })).variables;
    test.eqPartial([{ name: "NESTED", value: "TRUE" }], nested as unknown[]);

    // Step over to the next line
    stopped = dap.waitForEvent("stopped");
    await dap.request("next", { threadId: 1 });
    test.eqPartial({ reason: "step" }, await stopped);
    test.eqPartial({ line: 23 }, ((await dap.request("stackTrace", { threadId: 1 })).stackFrames as unknown[])[0]);

    // Remove the breakpoint and continue
    await dap.request("setBreakpoints", { source: { path: targetPath }, breakpoints: [] });
    await dap.request("continue", { threadId: 1 });

    // Pause it again
    stopped = dap.waitForEvent("stopped");
    await dap.request("pause", { threadId: 1 });
    test.eqPartial({ reason: "pause" }, await stopped);

    // Every frame has a source, either a local file or one sent through the adapter
    const pausedFrames = (await dap.request("stackTrace", { threadId: 1 })).stackFrames as Array<{ name: string; source?: { path?: string; sourceReference?: number } }>;
    test.assert(pausedFrames.some(frame => frame.name.startsWith("WAITINTARGET")));
    for (const frame of pausedFrames)
      test.assert(frame.source?.path || frame.source?.sourceReference, `Frame ${frame.name} has no source`);
  } finally {
    await dap.request("disconnect").catch(() => { });
    dap.proc.kill();
  }

  // The job keeps running after disconnecting. Detaching doesn't wait for a reply, and this connection's list may be
  // handled before the adapter's detach reached the debug manager, so wait for it
  await using conn = await HSDebugConnection.connect();
  const processcode = (await conn.findJob(groupid)).processcode;
  const job = await test.wait(async () => (await conn.listJobs(processcode)).find(j => j.groupid === groupid && !j.connected));
  test.assert(job.status !== "DebugStopped");
}

async function testMCPTools() {
  // The devkit module isn't active in containers (eg CI) unless WEBHARE_ENABLE_DEVKIT is set
  if (!backendConfig.module.devkit) {
    console.log("Skipping the MCP debug tool tests, the devkit module isn't active");
    return;
  }

  // Not imported directly, as the devkit module may not be active
  type RunDebugTool = (name: string, args: Record<string, unknown> | undefined) => Promise<string | null>;
  const runDebugTool = await importJSFunction<RunDebugTool>("@mod-devkit/js/mcp-server/debugger#runDebugTool");
  const jobs = await runDebugTool("wh_debug_list_jobs", { filter: "debugtarget" });
  test.assert(jobs?.includes(groupid), jobs ?? "");

  const stack = await runDebugTool("wh_debug_get_job_stack", { groupid, variables: [3], depth: 2 });
  test.assert(stack?.includes("WAITINTARGET"), stack ?? "");
  test.assert(stack?.includes(`LOCALTEXT = "hello ${marker}"`), stack ?? "");

  const handles = await runDebugTool("wh_debug_get_job_handles", { groupid });
  test.assert(handles?.includes(groupid), handles ?? "");

  const locks = await runDebugTool("wh_debug_list_locks", {});
  test.assert(locks?.includes("Cluster mutexes"), locks ?? "");

  const profile = await runDebugTool("wh_debug_profile_job", { groupid, duration: 300 });
  test.assert(profile?.includes("COMPUTESOMETHING"), profile ?? "");
  const profileId = profile?.match(/job-\d+/)?.[0];
  test.assert(profileId, profile ?? "");
  const functions = await runDebugTool("wh_debug_profile_functions", { profile: profileId, sort: "calls" });
  test.assert(functions?.includes("COMPUTESOMETHING"), functions ?? "");

  const list = await runDebugTool("wh_debug_list_profiles", {});
  test.assert(list?.includes(profileId), list ?? "");
}

function testRendering() {
  test.eq("INTEGER ARRAY", getHareScriptTypeName(0x90));
  test.eq("RECORD ARRAY", getHareScriptTypeName(0xa1));
  test.eq("VARIANT ARRAY", getHareScriptTypeName(0x80));
  test.eq(`"a\\nb"`, describeValue({ type: 0x22, id: 0, value: "a\nb", length: 3n, min: 0n, max: 3n }));
  test.eq(`"abc..." (10 bytes)`, describeValue({ type: 0x22, id: 0, value: "abc", length: 10n, min: 0n, max: 3n }));
  test.eq("DEFAULT RECORD", describeValue({ type: 0x21, id: 0, exists: false }));
  test.eq("<optimized away>", describeValue({ type: 0, id: 0 }));
}

test.runTests([
  testRendering,
  startTarget,
  testListJobs,
  testStack,
  testJobContinues,
  testErrors,
  testHandles,
  testProfile,
  testDebugInfo,
  testStoredProfiles,
  testWire,
  testAgent,
  testDAP,
  testMCPTools,
  stopTarget,
]);
