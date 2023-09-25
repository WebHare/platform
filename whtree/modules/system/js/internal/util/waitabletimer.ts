import { WaitableConditionBase } from "./waitableconditionbase";

/** This class implements a timer that can be waited on (and be reset)
*/
export class WaitableTimer extends WaitableConditionBase {
  _cb: NodeJS.Timeout | null;

  constructor(timeout?: number) {
    super();
    /// Callback for the timer
    this._cb = null;

    this.reset(timeout);
  }

  reset(timeout?: number) {
    this._setSignalled(false);
    if (this._cb) {
      clearTimeout(this._cb);
      this._cb = null;
    }
    if (typeof timeout !== "undefined")
      this._cb = setTimeout(() => this._gotTimeOut(), timeout);
    return this;
  }

  _gotTimeOut() {
    this._cb = null;
    this._setSignalled(true);
  }
}
