import * as test from "@webhare/test-backend";
import { spawn, type ChildProcess } from "node:child_process";
import { backendConfig } from "@webhare/services";
import { generateRandomId } from "@webhare/std";
import { HSDebugConnection, durationToMsecs } from "@mod-platform/js/hsdebugger/client";
import { getJobStack } from "@mod-platform/js/hsdebugger/stack";
import { describeValue, getHareScriptTypeName } from "@mod-platform/js/hsdebugger/variables";

const targetScript = "mod::webhare_testsuite/tests/system/debugger/data/debugtarget.whscr";

let target: ChildProcess | undefined;
let marker = "";
let groupid = "";

async function startTarget() {
  marker = "hsdebugger-" + generateRandomId();
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
  const job = await test.wait(async () => (await conn.listAllJobs()).find(entry => entry.script.endsWith("debugtarget.whscr")));
  test.eq(false, job.connected);
  test.assert(durationToMsecs(job.total_running) >= 0);
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
  stopTarget,
]);
