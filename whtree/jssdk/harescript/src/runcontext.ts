/** Running the single-threaded WASM code together with javascript code is a problem with repect to
 * async execution in JavaScript. This is solved by using a run permission that code running the
 * WASM VM needs to obtain have before it can run. The current run permission is stored in a async local storage
 */

import { debugFlags } from "@webhare/env";
import type { HareScriptVM } from "./wasm-hsvm";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`Assertion error: ${message}`);
    throw new Error(message);
  }
}

/** Class for administrating run permissions */
export class HSVMRunPermissionSystem {
  vm: HareScriptVM;
  /// Lists of contexts waiting for permission
  waitingForPermission: HSVMRunContext[] = [];
  /// Current context that has permission to run (.havePermission === true)
  currentRunContext: HSVMRunContext | null = null;
  /// List of contexts that have been suspended
  suspended: HSVMRunContext[] = [];
  /// Callbacks that are called when a new permission request is added
  onPermissionRequestCallback: (() => void) | null = null;

  constructor(vm: HareScriptVM) {
    this.vm = vm;
  }

  /** Release the run permission that a context has, auto selects the next
   * context to get run permission
   * @param runctxt - The context that is releasing its permission
   */
  releasePermission(runctxt: HSVMRunContext) {
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.vm.currentgroup}:${runctxt.id} releasePermission`);
    assert(runctxt.havePermission, "releasePermission called without having permission");
    runctxt.havePermission = false;
    this.currentRunContext = null;
    this.distributePermission();
  }

  /** Gives permission to the next waiting context */
  distributePermission() {
    if (this.currentRunContext)
      return;
    let ctxt = this.waitingForPermission.shift();
    if (ctxt) {
      assert(ctxt.waitingForPermission, "run context waiting for permission without promise");
      ctxt.waitingForPermission.resolve();
      ctxt.waitingForPermission = null;
      ctxt.havePermission = true;
      this.currentRunContext = ctxt;
      return;
    }
    // nothing waiting for permission to run, reactivate suspended contexts
    if (!this.suspended[this.suspended.length - 1]?.resumeBlocked) {
      ctxt = this.suspended.pop();
      if (ctxt) {
        assert(ctxt, "suspended context not found");
        assert(ctxt.waitingForResume, "suspended context without waitingForResume");
        ctxt.waitingForResume.resolve();
        ctxt.waitingForResume = null;
        ctxt.havePermission = true;
        this.currentRunContext = ctxt;
      }
    }
  }

  /** Temporarily suspend a context and let all pending requests run. Returns
   * when no more requests are pending.
   * @returns - Whether any pending requests were present
   */
  async runPendingRequests(runctxt: HSVMRunContext): Promise<boolean> {
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.vm.currentgroup}:${runctxt.id} runPendingRequests, pending requests: ${this.waitingForPermission.length}${this.waitingForPermission.length === 0 ? "  - returning" : ""}`);
    assert(runctxt.havePermission, "runPendingRequests called without having permission");
    if (this.waitingForPermission.length === 0)
      return false;

    runctxt.waitingForResume = Promise.withResolvers<void>();
    this.suspended.push(runctxt);
    const promise = runctxt.waitingForResume.promise;
    runctxt.havePermission = false;
    this.currentRunContext = null;
    this.distributePermission();
    await promise;
    assert(runctxt.havePermission, "runPendingRequests resumed without having permission");
    if (debugFlags.runpermission) {
      console.log(`[runpermission] ${this.vm.currentgroup}:${runctxt.id} resume after runPendingRequests`);
    }
    return true;
  }

  async runFunction<T>(runctxt: HSVMRunContext, cb: () => Promise<T> | T): Promise<T> {
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.vm.currentgroup}:${runctxt.id} runFunction`);
    assert(runctxt.havePermission, "runFunction called without having permission");

    runctxt.resumeBlocked = true;
    runctxt.waitingForResume = Promise.withResolvers<void>();
    this.suspended.push(runctxt);
    runctxt.havePermission = false;
    this.currentRunContext = null;
    const promise = runctxt.waitingForResume.promise;
    this.distributePermission();

    try {
      return await cb();
    } finally {
      runctxt.resumeBlocked = false;
      this.distributePermission();
      await promise;
      assert(runctxt.havePermission, "runFunction resumed without having permission");
      if (debugFlags.runpermission) {
        console.log(`[runpermission] ${this.vm.currentgroup}:${runctxt.id} resume after runFunction`);
      }
    }
  }

  /** Allocates the root context */
  allocRootContext() {
    assert(!this.currentRunContext, "allocRootContext called while having a current run context");
    const ctxt = new HSVMRunContext(this, null);
    ctxt.havePermission = true;
    this.currentRunContext = ctxt;
    // Autoclear permission when the root context is disposed
    ctxt.autoPermission = {
      [Symbol.dispose]: () => {
        assert(ctxt.havePermission, "run permission released while not having permission");
        this.releasePermission(ctxt);
      }
    };
    return ctxt;
  }

  anyRequestsInFlight() {
    // When the current running context has a parent, it needs to finish, also when there are pending requests
    return Boolean(this.waitingForPermission.length > 0 || this.currentRunContext?.parent);
  }
}

let ctr = 0;

export class HSVMRunContext {
  /// The permission system
  system: HSVMRunPermissionSystem;
  /// The parent context
  parent: HSVMRunContext | null = null;
  /// The unique id of this context
  id = ++ctr;
  /// Whether this context now has run permission
  havePermission = false;
  /// Whether pipewaiters should be aborted when any pending run requests are present
  shortTimerOnRequest = false;
  /// Promise that is resolved when this context gets run permission
  waitingForPermission: PromiseWithResolvers<void> | null = null;
  /// Promise that is resolved when this context is resumed
  waitingForResume: PromiseWithResolvers<void> | null = null;
  /// Automatically released run permission lock, used for root context
  autoPermission?: { [Symbol.dispose]: () => void };
  /// Resumption is blocked while still calling the function from runFunction
  resumeBlocked = false;

  constructor(system: HSVMRunPermissionSystem, parent: HSVMRunContext | null) {
    this.system = system;
    this.parent = parent;
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} create runctxt parent ${parent?.id ?? "none"}`);
  }

  /** Waits for run permission, returns a lock that releases run permission when disposed */
  async ensureRunPermission() {
    // FIXME: keep a stack of permissions in the context?
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} ensureRunPermission want permission: havePermission:${this.havePermission}`);
    if (this.havePermission) {
      return {
        [Symbol.dispose]: () => {
          assert(this.havePermission, "nested run permission released after outer run permission released");
        }
      };
    }
    this.waitingForPermission = Promise.withResolvers<void>();
    this.system.waitingForPermission.push(this);
    this.system.onPermissionRequestCallback?.();

    const promise = this.waitingForPermission.promise;
    this.system.distributePermission();

    await promise; // system sets havePermission to true
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} ensureRunPermission got permission`);
    assert(this.havePermission, "run permission not granted after promise resolved");
    assert(!this.waitingForPermission, "waitingForPermission not cleared after run permission grant");

    return {
      [Symbol.dispose]: () => {
        if (debugFlags.runpermission)
          console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} ensureRunPermission done`);
        assert(this.havePermission, "run permission released while not having permission");
        this.system.releasePermission(this);
      }
    };
  }

  /** Temporarily suspends run permission and let all other pending requests run
   * first. Returns when the requests have been handled. */
  async runPendingRequests() {
    return await this.system.runPendingRequests(this);
  }

  /** Temporary suspends run permission, run a function and then resume permission */
  async runFunction<T>(cb: () => Promise<T> | T): Promise<T> {
    return await this.system.runFunction(this, cb);
  }

  /** Auto-break pipewaiters when pending run requests are present. Returns
   * a lock that clears the auto-break when disposed.
   */
  breakPipeWaiterOnRequest() {
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} breakPipeWaiterOnRequest begin`);
    assert(!this.shortTimerOnRequest, "nested call to breakPipeWaiterOnRequest");
    assert(this.havePermission, "breakPipeWaiterOnRequest called without having permission");
    this.shortTimerOnRequest = true;
    return {
      [Symbol.dispose]: async () => {
        if (debugFlags.runpermission)
          console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} breakPipeWaiterOnRequest end`);
        this.shortTimerOnRequest = false;
      }
    };
  }

  /** Register a callback that is called when run permissions requests are added, or
   * are present at the time of registration.
   * @returns A lock that removes the callback when disposed
   */
  onPermissionRequest(cb: () => void) {
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} onPermissionRequest register`);
    const prevCb = this.system.onPermissionRequestCallback;
    assert(!prevCb, "onPermissionRequest called within __pipewaiterWait");
    this.system.onPermissionRequestCallback = cb;
    if (this.system.waitingForPermission.length)
      cb();
    return {
      [Symbol.dispose]: () => {
        if (debugFlags.runpermission)
          console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} onPermissionRequest clear`);
        this.system.onPermissionRequestCallback = prevCb;
      }
    };
  }

  /** Returns whether any pending permission requests exist */
  havePermissionRequests(): boolean {
    return this.system.waitingForPermission.length > 0;
  }

  [Symbol.dispose]() {
    if (debugFlags.runpermission)
      console.log(`[runpermission] ${this.system.vm.currentgroup}:${this.id} dispose runctxt`);
    this.autoPermission?.[Symbol.dispose]();
    assert(!this.havePermission, "disposing a run context while having permission");
    assert(!this.waitingForPermission, "disposing a run context that is waiting for permission");
  }
}
