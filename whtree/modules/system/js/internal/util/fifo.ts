import { WaitableConditionBase } from "./waitableconditionbase";

/// This class implements a FIFO with a wait function that is resolved when an element is present
export class FIFO<T> extends WaitableConditionBase {
  _elts: T[];

  constructor() {
    super();
    this._elts = [];
  }

  push(elt: T) {
    this._elts.push(elt);
    this._setSignalled(true);
  }

  shift(): T | undefined {
    const result = this._elts.shift();
    this._setSignalled(this._elts.length !== 0);
    return result;
  }
}
