import { Socket } from "net";
import EventSource from "../eventsource";
import { StackTraceItem, callStackToText, getCallStack } from "@mod-system/js/internal/util/stacktrace";
import { flags } from "@webhare/env";

const reftrackersymbol = Symbol("refTracker");

export class RefLock {
  tracker: RefTracker;
  title: string;
  stack: StackTraceItem[];

  constructor(tracker: RefTracker, title = "") {
    this.tracker = tracker;
    this.title = title;
    this.stack = flags.async ? getCallStack(1) : [];
  }

  release() {
    this.tracker._remove(this);
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
  private obj: Referencable;
  private refobj: Referencable;

  constructor(obj: Referencable, { initialref }: { initialref?: boolean } = {}) {
    super();
    this.obj = obj;
    obj[reftrackersymbol] = this;
    this.hasref = initialref ?? false;
    this.objhasref = this.hasref;
    if (initialref) {
      this.initialref = new RefLock(this, "initial reference");
      this.locks.add(this.initialref);
    }
    this.refobj = obj;

    if ("allowHalfOpen" in obj) {
      /* object is a Socket. re-referencing a socket sometimes doesn't work in node 19 */
      const timer = setInterval(() => false, 86400000); // use an interval for references instead, one with few callbacks
      (obj as Socket).on("close", () => clearInterval(timer)); // close when the socket closes
      (obj as Socket).on("error", () => clearInterval(timer)); // or has an error
      this.refobj = timer;
      if (initialref)
        this.obj.unref();
      else
        this.refobj.unref();
    }
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
        this.refobj.ref();
      else
        this.refobj.unref();
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
