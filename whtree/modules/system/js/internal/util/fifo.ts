/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation


import { WaitableConditionBase } from "./waitableconditionbase";


/// This class implements a FIFO with a wait function that is resolved when an element is present
class FIFO extends WaitableConditionBase {
  constructor() {
    super();
    this._elts = [];
  }

  push(elt) {
    this._elts.push(elt);
    this._setSignalled(true);
  }

  shift() {
    let result = this._elts.shift();
    this._setSignalled(this._elts.length !== 0);
    return result;
  }
}

module.exports = FIFO;
