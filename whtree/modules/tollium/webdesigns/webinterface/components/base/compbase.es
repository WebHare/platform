import * as component from '@mod-tollium/web/ui/js/componentbase.es';
var $todd = require("@mod-tollium/web/ui/js/support");

let ComponentBase = component.ToddCompBase;
ComponentBase.checkEnabledFlags = function(selectionflags,checkflags, min, max, selectionmatch)
{
  return $todd.Screen.checkEnabledFlags(selectionflags,checkflags, min, max, selectionmatch);
};

export default ComponentBase;
