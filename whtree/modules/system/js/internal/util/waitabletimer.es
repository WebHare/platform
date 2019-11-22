
const WaitableConditionBase = require("./waitableconditionbase.es");

/** This class implements a timer that can be waited on (and be reset)
*/
class WaitableTimer extends WaitableConditionBase
{
  constructor(timeout)
  {
    super();
    /// Callback for the timer
    this._cb = null;

    this.reset(timeout);
  }

  reset(timeout)
  {
    this._setSignalled(false);
    if (this._cb)
    {
      clearTimeout(this._cb);
      this._cb = null;
    }
    if (typeof timeout !== "undefined")
      this._cb = setTimeout(() => this._gotTimeOut(), timeout);
    return this;
  }

  _gotTimeOut()
  {
    this._cb = null;
    this._setSignalled(true);
  }
}

module.exports = WaitableTimer;
