var $todd = require('@mod-tollium/web/ui/js/support');
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  PROXY                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class Proxy extends ComponentBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "proxy";

    this.checkcomponents = [];
    this.passthrough = "";
    this.usecheckcomponents = true;
    this.rows = [];

    this.checkcomponents = data.checkcomponents;
    this.passthrough = data.passthrough;
    this.rows = data.rows;
    this.usecheckcomponents = data.usecheckcomponents;
  }

/****************************************************************************************************************************
* Component management
*/

  hasfocus()
  {
    if (!this.passthrough)
      return false;

    var comp = this.owner.getComponent(this.passthrough);
    if(!comp)
      return false;

    return comp.hasfocus();
  }

/****************************************************************************************************************************
 * Property getters & setters
 */


/****************************************************************************************************************************
* Communications
*/

  // Check enableon rules
  enabledOn(checkflags, min, max, selectionmatch)
  {
    if (this.passthrough)
    {
      var comp = this.owner.getComponent(this.passthrough);
      $todd.DebugTypedLog("actionenabler", "- proxy passthrough to " + this.passthrough + ": " + (comp?comp.componenttype:"n/a"));
      return comp && comp.enabledOn(checkflags, min, max, selectionmatch);
    }

    var flags = [];

    if (this.usecheckcomponents)
    {
      this.checkcomponents.forEach(name =>
      {
        var comp = this.owner.getComponent(name);
        if (comp && comp.flags)
        {
          let val = comp.getValue();
          /* We USED to check whether the value is truthy. That broke with checkbox getValue() returning an object
             Now we check for explicitly true (will work for radio) or for .value === true (will work with new checkbox)
             This should be cleaner but then we need to add a isTrueForEnableOn() or something to all components? this needs
             to be through through more and i wonder if, rather than going that way, we shouldn't just eliminate the Proxy
             all together and move this problem back to Tollium <select> (have it rewrite visibleons/enableons) */
          if(val === true || (val.value && val.value === true))
            flags.push(comp.flags);
        }
      });
    }
    else
      flags = this.rows;

    $todd.DebugTypedLog("actionenabler","flags = " + JSON.stringify(flags));

    if ($todd.checkEnabledFlags(flags, checkflags, min, max, selectionmatch))
    {
      $todd.DebugTypedLog("actionenabler","- accepted");
      return true;
    }
    return false;
  }

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "config":
        this.checkcomponents = data.checkcomponents;
        this.passthrough = data.passthrough;
        this.rows = data.rows;
        return;
    }
    super.applyUpdate(data);
  }
}

