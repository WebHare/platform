/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

"use strict";

const WaitableConditionBase = require("./waitableconditionbase");

/** This class implements waitable condition with manual signalledness control
*/
class ManualCondition extends WaitableConditionBase {
  setSignalled(signalled) {
    this._setSignalled(signalled);
  }
}

module.exports = ManualCondition;
