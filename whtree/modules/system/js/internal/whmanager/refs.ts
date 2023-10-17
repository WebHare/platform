import { Socket } from "net";
import EventSource from "../eventsource";
import { StackTraceItem, callStackToText, getCallStack } from "@mod-system/js/internal/util/stacktrace";
import { debugFlags } from "@webhare/env";
import { rootstorage } from "@webhare/services/src/codecontexts";

const reftrackersymbol = Symbol("refTracker");

export class RefLock {
  tracker: RefTracker;
  title: string;
  stack: StackTraceItem[];

  constructor(tracker: RefTracker, title = "") {
    this.tracker = tracker;
    this.title = title;
    this.stack = debugFlags.async ? getCallStack(1) : [];
  }

  release() {
    this.tracker._remove(this);
  }

  [Symbol.dispose]() {
    this.release();
  }
}

type Referencable = {
  ref(): void;
  unref(): void;
  [reftrackersymbol]?: RefTracker;
};

type RefTrackerEvents = {
  ref: void;
  unref: void;
};

export class RefTracker extends EventSource<RefTrackerEvents>{
  private locks = new Set<RefLock>();
  private initialref?: RefLock;
  private hasref: boolean;
  private objhasref: boolean;
  ///The object that was passed to us to track
  private readonly trackedObject: Referencable | null;
  ///The object that we are actually referencing if the original object cannot be safely used
  private readonly referencedObject: Referencable;

  /** @param obj - Object that kan keep NodeJS running (or null to allocate one)
   *  @param initialref - Assume we already have an active reference (use dropInitialReference) */
  constructor(obj: Referencable | null, { initialref }: { initialref?: boolean } = {}) {
    super();
    this.trackedObject = obj;
    if (obj)
      obj[reftrackersymbol] = this;
    this.hasref = initialref ?? false;
    this.objhasref = this.hasref;
    if (initialref) {
      this.initialref = new RefLock(this, "initial reference");
      this.locks.add(this.initialref);
    }
    if (!obj || "allowHalfOpen" in obj) {
      /* object is a Socket. re-referencing a socket sometimes doesn't work in node 19
         we use an Interval object simply to have something that supports references
         we must create the interval in the root context to not interfere with CodeContext cleanup
      */
      if (obj) {
        (obj as Socket).on("close", () => clearInterval(timer)); // close when the socket closes
        (obj as Socket).on("error", () => clearInterval(timer)); // or has an error
      }
      // use an interval for references instead, one with few callbacks
      const timer = rootstorage.run(() => setInterval(function () { return false; }, 86400000));
      this.referencedObject = timer;
      if (initialref) //trackedObject is still referenced
        this.trackedObject?.unref();
      else
        this.referencedObject.unref();

      //post: trackedObject is unreferenced, referencedObject is referenced iff initialRef is set
    } else
      this.referencedObject = obj;
  }

  getLock(title?: string): RefLock {
    const retval = new RefLock(this, title);
    this._add(retval);
    return retval;
  }

  dropInitialReference() {
    this.initialref?.release();
    this.initialref = undefined;
  }

  private updateRef() {
    const newhasref = this.locks.size !== 0;
    if (newhasref && !this.hasref) {
      this.hasref = true;
      this.emit("ref", void (0));
    }
    setImmediate(() => this.asyncUpdateRef());
  }

  private asyncUpdateRef() {
    const newhasref = this.locks.size !== 0;
    if (this.hasref && !newhasref) {
      this.hasref = true;
      this.emit("unref", void (0));
    }
    if (this.objhasref !== newhasref) {
      this.objhasref = newhasref;
      if (newhasref)
        this.referencedObject.ref();
      else
        this.referencedObject.unref();
    }
  }

  private _add(lock: RefLock) {
    this.locks.add(lock);
    if (this.locks.size === 1) {
      this.updateRef();
    }
  }

  _remove(lock: RefLock) {
    this.locks.delete(lock);
    this.updateRef();
  }

  _getLocks() {
    return this.locks;
  }
}

export function dumpRefs(obj: Referencable) {
  const tracker = obj[reftrackersymbol];
  if (tracker) {
    for (const ref of tracker._getLocks())
      console.log(`Ref: ${ref.title}\n${callStackToText(ref.stack)}`);
  }
}

export function checkIsRefCounted<T extends object>(t: T): T & NodeJS.RefCounted {
  if (!("ref" in t) || !("unref" in t))
    throw new Error(`Oject does not have ref() or unref() functions`);
  return t as T & NodeJS.RefCounted;
}
