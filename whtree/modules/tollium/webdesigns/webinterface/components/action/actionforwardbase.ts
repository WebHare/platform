/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

export default class ActionForwardBase extends ComponentBase {
  constructor(parentcomp, data) {
    super(parentcomp, data);
    this.shortcut = data.shortcut;

    this.setEnabled(data.enabled);
    this.owner.registerComponentShortcut(this);
  }

  destroy() {
    this.owner.unregisterComponentShortcut(this);
    super.destroy();
  }

  onShortcut(event) {
    this.onExecute();
  }
}
