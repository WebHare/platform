import EventSource from "../eventsource";

const reftrackersymbol = Symbol("refTracker");

export class RefLock {
  tracker: RefTracker;
  title: string;
  trace: string;

  constructor(tracker: RefTracker, title = "") {
    this.tracker = tracker;
    this.title = title;
    const stack = (new Error().stack || "");
    this.trace = stack.substring(stack.indexOf("\n") + 1);
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
        this.obj.ref();
      else
        this.obj.unref();
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
      console.log(`Ref: ${ref.title}\n${ref.trace}`);
  }
}

export function checkIsRefCounted<T extends object>(t: T): T & NodeJS.RefCounted {
  if (!("ref" in t) || !("unref" in t))
    throw new Error(`Oject does not have ref() or unref() functions`);
  return t as T & NodeJS.RefCounted;
}
