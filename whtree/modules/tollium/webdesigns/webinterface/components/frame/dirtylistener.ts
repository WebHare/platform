import type { ToddCompBase } from '@mod-tollium/js/internal/debuginterface';
import type { ComponentBaseUpdate, ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  DIRTY LISTENER                                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/

interface DirtyListenerAttributes extends ComponentStandardAttributes {
  checkcomponents: string[];
  dirtycomponents: string[];
  manualdirty: boolean;
  makeappdirty: boolean;
}

type DirtyListenerUpdate = {
  type: "checkcomponents";
  checkcomponents: string[];
} | {
  type: "dirtycomponents";
  dirtycomponents: string[];
  manualdirty: boolean;
} | {
  type: "makeappdirty";
  makeappdirty: boolean;
} | ComponentBaseUpdate;

export default class DirtyListener extends ComponentBase {
  manualdirty: boolean;
  checkcomponents = new Map<string, boolean>;

  // The dirty listener is dirty if it's enabled and  manually set to dirty or any of its components is dirty
  get dirty() {
    return this.enabled && (this.manualdirty || [...this.checkcomponents.values()].some(_ => _));
  }

  /****************************************************************************************************************************
   * Initialization
   */

  constructor(parentcomp: ToddCompBase, data: DirtyListenerAttributes) {
    super(parentcomp, data);

    this.componenttype = "dirtylistener";

    this.checkcomponents = new Map();
    this.setComponents(data.checkcomponents);
    this.owner.node.addEventListener("tollium:updatedcomponents", () => this.refreshComponents());
    this.manualdirty = data.manualdirty;

    // Register the dirty listener with the application if it can make the application dirty
    if (data.makeappdirty)
      this.owner.hostapp.registerDirtyListener(this);
    this.setEnabled(data.enabled ?? true);
  }

  /****************************************************************************************************************************
  * Component management
  */

  destroy() {
    this.owner.hostapp.unregisterDirtyListener(this);
    super.destroy();
  }

  setComponents(components: string[]) {
    const keepcomponents = [];
    for (const key of this.checkcomponents.keys()) {
      if (!(components.includes(key))) {
        const comp = this.owner.getComponent(key);
        if (comp)
          comp.applyDirtyListener(null);
        this.checkcomponents.delete(key);
      } else
        keepcomponents.push(key);
    }
    for (const key of components) {
      if (!(keepcomponents.includes(key))) {
        const comp = this.owner.getComponent(key);
        if (comp)
          comp.applyDirtyListener(this);
        this.checkcomponents.set(key, false);
      }
    }
  }

  refreshComponents() {
    for (const key of this.checkcomponents.keys()) {
      const comp = this.owner.getComponent(key);
      if (comp && comp.dirtylistener !== this)
        comp.applyDirtyListener(this);
    }
  }

  /** @returns True if this call made the component transition from clean to dirty */
  setDirtyComponent(comp: ToddCompBase) {
    if (this.checkcomponents.get(comp.name) === true)
      return false; //already dirty

    this.checkcomponents.set(comp.name, true);
    this.queueMessage("dirtycomponent", { component: comp.name });
    // Maybe update the dirty state of the application
    this.owner.hostapp.checkDirtyState();
    return true;
  }

  /****************************************************************************************************************************
   * Property getters & setters
   */

  setEnabled(enabled: boolean) {
    super.setEnabled(enabled);

    // Maybe update the dirty state of the application (if the dirty listener is disabled, it's no longer dirty)
    this.owner.hostapp.checkDirtyState();
  }

  /****************************************************************************************************************************
  * Communications
  */

  applyUpdate(data: DirtyListenerUpdate) {
    switch (data.type) {
      case "checkcomponents":
        this.setComponents(data.checkcomponents);
        return;
      case "dirtycomponents":
        for (const key of this.checkcomponents.keys())
          this.checkcomponents.set(key, data.dirtycomponents.includes(key));
        this.manualdirty = data.manualdirty;
        // Maybe update the dirty state of the application
        this.owner.hostapp.checkDirtyState();
        return;
      case "makeappdirty":
        // Register or unregister the dirty listener with the application
        if (data.makeappdirty)
          this.owner.hostapp.registerDirtyListener(this);
        else
          this.owner.hostapp.unregisterDirtyListener(this);
        return;
    }
    super.applyUpdate(data);
  }
}
