"use strict";

const WaitableConditionBase = require("./waitableconditionbase.es");

/** This class implements waitable condition with manual signalledness control
*/
class ManualCondition extends WaitableConditionBase
{
  setSignalled(signalled)
  {
    this._setSignalled(signalled);
  }
}

module.exports = ManualCondition;
