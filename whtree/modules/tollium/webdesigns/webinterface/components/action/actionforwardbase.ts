import type { TolliumKeyboardShortcut } from '@mod-platform/js/tollium/types';
import { type ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';

export interface ActionForwardAttributes extends ComponentStandardAttributes {
  shortcut?: TolliumKeyboardShortcut;
}

export default abstract class ActionForwardBase<Attributes extends ActionForwardAttributes> extends ToddCompBase<Attributes> {
  shortcut?: TolliumKeyboardShortcut;

  constructor(parentcomp: ToddCompBase | null, data: Attributes) {
    super(parentcomp, data);
    this.shortcut = data.shortcut;
    this.setEnabled(data.enabled);
  }

  destroy() {
    super.destroy();
  }

  handleShortcut(evt: KeyboardEvent): boolean {
    if (this.shortcut && evt.altKey === this.shortcut.alt && evt.ctrlKey === this.shortcut.ctrl && evt.shiftKey === this.shortcut.shift && evt.key.toUpperCase() === this.shortcut.keystr.toUpperCase()) {
      this.onExecute();
      return true;
    }
    return false;
  }

  abstract onExecute(): void;
}
