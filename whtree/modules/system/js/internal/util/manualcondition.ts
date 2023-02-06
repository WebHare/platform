import { WaitableConditionBase } from "./waitableconditionbase";

/** This class implements waitable condition with manual signalledness control
*/
export class ManualCondition extends WaitableConditionBase {
  setSignalled(signalled: boolean) {
    this._setSignalled(signalled);
  }
}
