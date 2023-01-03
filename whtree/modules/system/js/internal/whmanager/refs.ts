

class RefLock {
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
  private _onrefed?: () => void;
  private _onunrefed?: () => void;

  constructor(onrefed: () => void, onunrefed: () => void, { initialref }: { initialref?: boolean } = {}) {
    this._onrefed = onrefed;
    this._onunrefed = onunrefed;
    if (initialref) {
      this.initialref = new RefLock(this, "initial reference");
      this.locks.add(this.initialref);
      this.getLock("initial reference");
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

  private _add(lock: RefLock) {
    this.locks.add(lock);
    if (this.locks.size === 1) {
      if (!this._onrefed)
        throw new Error(`RefTracker not initialized yet`);
      this._onrefed();
    }
  }

  _remove(lock: RefLock) {
    const isrefed = this.locks.size;
    this.locks.delete(lock);
    if (isrefed && !this.locks.size) {
      if (!this._onunrefed)
        throw new Error(`RefTracker not initialized yet`);
      this._onunrefed();
    }
  }
}
