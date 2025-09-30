import ActionForwardBase, { type ActionForwardAttributes } from './actionforwardbase';
import type { ToddCompBase } from '@mod-tollium/js/internal/debuginterface';
import type ObjAction from './action';

interface ForwardAttributes extends ActionForwardAttributes {
  action: string;
}

export default class ObjForward extends ActionForwardBase<ForwardAttributes> {
  constructor(parentcomp: ToddCompBase | null, data: ForwardAttributes) {
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
    return forwardto && (forwardto as unknown as ObjAction).isEnabled();
  }
  onActionUpdated() {
    this.owner.broadcastActionUpdated(this);
  }
  onExecute({ ignorebusy = false } = {}) {
    const forwardto = this._getForwardTo();
    return forwardto ? forwardto.onExecute({ ignorebusy }) : false;
  }
}
