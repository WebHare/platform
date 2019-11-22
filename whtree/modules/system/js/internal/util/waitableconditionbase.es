"use strict";

/** This class implements the base class for a waitable condition
*/
class WaitableConditionBase
{
  constructor()
  {
    /// Whether this condition is currently signalled
    this._signalled = false;
    /** Promise and resolve function for waiting for signalled status change
        @cell promise Promise
        @cell resolve Resolve function for the promise
    */
    this._wait = null;
    /// Name for debugging purposes
    this.name = "";
  }

  _waitSignalledInternal(negate)
  {
    // Is the signalled state already what the user wants?
    if (this._signalled !== negate)
      return Promise.resolve(this);

    // Create a promise to wait for if there isn't one yet for the next signalled status change
    if (!this._wait)
    {
      this._wait = { promise: null, resolve: null };
      this._wait.promise = new Promise(resolve => this._wait.resolve = resolve);
    }

    return this._wait.promise;
  }

  /// Updates the current signalled status (internal function, for use by derived objects
  _setSignalled(signalled)
  {
    signalled = !!signalled;
    if (this._signalled === signalled)
      return;

    this._signalled = signalled;
    if (this._wait)
    {
      this._wait.resolve(this);
      this._wait = null;
    }
  }

  // Returns a promise that be resolved when the status is or becomes signalled
  waitSignalled()
  {
    return this._waitSignalledInternal(false);
  }

  // Returns a promise that be resolved when the status is or becomes not signalled
  waitNotSignalled()
  {
    return this._waitSignalledInternal(true);
  }
}

module.exports = WaitableConditionBase;
