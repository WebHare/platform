import * as dompack from 'dompack';
import ActionForwardBase from './actionforwardbase';

export default class ObjForward extends ActionForwardBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "forward";
    this.action = data.action;
    this.setInterestingActions([this.action]);
  }
  _getForwardTo()
  {
    return this.owner.getComponent(this.action);
  }
  isEnabled()
  {
    let forwardto = this._getForwardTo();
    return forwardto && forwardto.isEnabled();
  }
  onActionUpdated()
  {
    this.owner.broadcastActionUpdated(this);
  }
  onExecute(options)
  {
    let forwardto = this._getForwardTo();
    return forwardto ? forwardto.onExecute(options) : false;
  }
}
