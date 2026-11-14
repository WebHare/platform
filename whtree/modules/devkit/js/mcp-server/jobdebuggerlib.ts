/**
 * Calls into mod::devkit/lib/internal/jobdebugger.whlib for the MCP debugging tools.
 *
 * We use our own HareScript VMs rather than the code context VM behind loadlib(): a HareScript error can shut a VM down,
 * after which every later call would fail with "already shut down" until the MCP server restarts.
 */
import { createVM, type HSVMWrapper } from "@webhare/harescript";

const jobDebuggerLib = "mod::devkit/lib/internal/jobdebugger.whlib";

let sharedVM: Promise<HSVMWrapper> | null = null;

function discardSharedVM(vm: Promise<HSVMWrapper>) {
  if (sharedVM === vm)
    sharedVM = null;
  vm.then(wrapper => wrapper.dispose(), () => { });
}

/** Call a function in jobdebugger.whlib on a shared VM. The VM is replaced after an error, as it may have been shut down */
export async function callJobDebugger<T>(func: string, ...args: unknown[]): Promise<T> {
  const vm = sharedVM ??= createVM({ implicitLifetime: true });
  try {
    return await (await vm).loadlib(jobDebuggerLib)[func](...args) as T;
  } catch (e) {
    discardSharedVM(vm);
    throw e;
  }
}

/** Call a function in jobdebugger.whlib on a VM of its own, for long-running calls (eg profiling) that shouldn't block the other tools */
export async function callJobDebuggerIsolated<T>(func: string, ...args: unknown[]): Promise<T> {
  await using vm = await createVM({ implicitLifetime: true });
  return await vm.loadlib(jobDebuggerLib)[func](...args) as T;
}
