/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import ActionForwardBase from './actionforwardbase';

export default class ObjForward extends ActionForwardBase {
  constructor(parentcomp, data) {
    super(parentcomp, data);
    this.componenttype = "forward";
    this.action = data.action;
    this.setInterestingActions([this.action]);
  }
  _getForwardTo() {
    return this.owner.getComponent(this.action);
  }
  isEnabled() {
    const forwardto = this._getForwardTo();
    return forwardto && forwardto.isEnabled();
  }
  onActionUpdated() {
    this.owner.broadcastActionUpdated(this);
  }
  onExecute(options) {
    const forwardto = this._getForwardTo();
    return forwardto ? forwardto.onExecute(options) : false;
  }
}
