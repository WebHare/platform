export class RefLock {
  tracker: RefTracker;
  title: string;
  trace: string;

  constructor(tracker: RefTracker, title = "") {
    this.tracker = tracker;
    this.title = title;
    this.trace = new Error().stack || "";
  }

  release() {
    this.tracker._remove(this);
  }
}

export class RefTracker {
  private locks = new Set<RefLock>();
  private initialref?: RefLock;
  private hasref: boolean;
  private _onrefed: () => void;
  private _onunrefed: () => void;

  constructor(onrefed: () => void, onunrefed: () => void, { initialref }: { initialref?: boolean } = {}) {
    this._onrefed = onrefed;
    this._onunrefed = onunrefed;
    this.hasref = initialref ?? false;
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
    if (this.hasref !== newhasref) {
      this.hasref = newhasref;
      if (newhasref)
        this._onrefed();
      else
        this._onunrefed();
    }
  }

  private _add(lock: RefLock) {
    this.locks.add(lock);
    if (this.locks.size === 1) {
      setImmediate(() => this.updateRef());
    }
  }

  _remove(lock: RefLock) {
    this.locks.delete(lock);
    setImmediate(() => this.updateRef());
  }
}
