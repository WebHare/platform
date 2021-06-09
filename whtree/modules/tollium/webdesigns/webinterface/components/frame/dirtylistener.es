var $todd = require('@mod-tollium/web/ui/js/support');
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  DIRTY LISTENER                                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class DirtyListener extends ComponentBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "dirtylistener";

    this.checkcomponents = new Map();
    this.setComponents(data.checkcomponents);
    this.owner.node.addEventListener("tollium:updatedcomponents", () => this.refreshComponents());
  }

/****************************************************************************************************************************
* Component management
*/

  setComponents(components)
  {
    let keepcomponents = [];
    for (let key of this.checkcomponents.keys())
    {
      if (!(components.includes(key)))
      {
        var comp = this.owner.getComponent(key);
        if (comp)
          comp.applyDirtyListener(null);
        this.checkcomponents.delete(key);
      }
      else
        keepcomponents.push(key);
    }
    for (let key of components)
    {
      if (!(keepcomponents.includes(key)))
      {
        var comp = this.owner.getComponent(key);
        if (comp)
          comp.applyDirtyListener(this);
        this.checkcomponents.set(key, false);
      }
    }
  }

  refreshComponents()
  {
    for (let key of this.checkcomponents.keys())
    {
      var comp = this.owner.getComponent(key);
      if (comp && comp.dirtylistener !== this)
        comp.applyDirtyListener(this);
    }
  }

  setDirtyComponent(comp)
  {
    if (this.checkcomponents.get(comp.name) !== true)
    {
      this.checkcomponents.set(comp.name, true);
      this.queueMessage("dirtycomponent", { component: comp.name });
    }
  }

/****************************************************************************************************************************
 * Property getters & setters
 */

/****************************************************************************************************************************
* Communications
*/

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "checkcomponents":
        this.setComponents(data.checkcomponents);
        return;
      case "dirtycomponents":
        for (let key of this.checkcomponents.keys())
          this.checkcomponents.set(key, data.dirtycomponents.includes(key));
        return;
    }
    super.applyUpdate(data);
  }
}
