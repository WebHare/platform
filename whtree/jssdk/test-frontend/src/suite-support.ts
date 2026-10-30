import type { TestFramework, TestStep, TestWaitItem } from '@mod-system/web/systemroot/jstests/testsuite';
import { attempt, throwError } from '@webhare/std';
import { onDomReady } from '@webhare/dompack';
import { setupLogging } from '@webhare/test/src/checks';
import { TestMonitor } from '@webhare/test/src/monitor';

export const testFramework: TestFramework | undefined = typeof window !== 'undefined' ? attempt(() => window.top?.__testframework) : undefined;

if (typeof window !== 'undefined') {
  setupLogging({
    onLog: (...args) => {
      console.log(...args);
      testFramework!.log(...args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg)));
    }
  });
}

export type RegisteredTestStep = TestStep | string | NonNullable<TestStep["test"]>;
export type RegisteredTestSteps = RegisteredTestStep[];

export function runTests(steps: RegisteredTestSteps) {
  if (typeof window === "undefined" && typeof process !== "undefined") {
    console.error("This script should be run in a browser test environment");
    process.exit(1);
  }
  onDomReady(() => runActualTests(steps));
}

function runActualTests(steps: RegisteredTestSteps) {
  if (!testFramework)
    throw new Error("This page is not being invoked by the test framework");

  const monitor = new TestMonitor;
  let lasttestname;
  const finalsteps: TestStep[] = [];
  for (let step of steps) {
    if (!step)
      continue;

    if (typeof step === "string") {
      lasttestname = step;
      continue;
    }

    if (typeof step === "function")
      step = { test: step as () => void };

    if (lasttestname && !step.name) {
      step.name = lasttestname;
      lasttestname = null;
    }
    finalsteps.push(step);
  }

  testFramework.runTestSteps(finalsteps, __setTestSuiteCallbacks, () => monitor.abort());
}

export function getWin(): WindowProxy {
  return testFramework?.getFrameRecord().win || throwError("Not running in a test page");
}

export function getDoc(): Document {
  return testFramework?.getFrameRecord().doc || throwError("Not running in a test page");
}

export type TestFrameWorkCallbacks = {
  executeWait: (item: TestWaitItem) => Promise<unknown>;
  subtest: (name: string) => void;
  setFrame: (name: string, type: "add" | "update" | "delete" | "select", options?: { width: number }) => Promise<void>;
};

let callbacks: TestFrameWorkCallbacks | null = null;

export function __setTestSuiteCallbacks(cb: TestFrameWorkCallbacks) {
  callbacks = cb;
}

export function __getTestSuiteCallbacks(): TestFrameWorkCallbacks {
  if (!callbacks)
    throw new Error("Test framework callbacks not set");
  return callbacks;
}

/** Wait for the current UIBusyLock (flagUIBusy) to clear if any
 *
 * @throws If that the UI has never been busy since the last wait and the 'optional' flag was not set (and inside the current test step) */
export async function waitForUI({ optional = false } = {}): Promise<void> {
  await __getTestSuiteCallbacks().executeWait(optional ? "ui-nocheck" : "ui");
}

export async function addFrame(name: string, { width }: { width: number }) {
  return callbacks!.setFrame(name, "add", { width });
}

export async function updateFrame(name: string, { width }: { width: number }) {
  return callbacks!.setFrame(name, "update", { width });
}

export async function removeFrame(name: string) {
  return callbacks!.setFrame(name, "delete");
}

export async function selectFrame(name: string) {
  return callbacks!.setFrame(name, "select");
}