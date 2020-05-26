/** @require: var domfocus = require('@mod-system/js/dom/focus');
*/

import * as whintegration from '@mod-system/js/wh/integration';
import * as dompack from "dompack";
import * as domfocus from "dompack/browserfix/focus";

function getFocusableElement(element) //get the focusable element for an input field. understands replacement
{
  if(element.retrieve)
  {
    const replacedby = element.retrieve("wh-ui-replacedby");
    if(replacedby)
      return replacedby;
  }
  return element;
}

/// Returns whether the element or a subnode is focused
function hasFocus(element)
{
  if(!element.ownerDocument)
    return false;
  if(element && element.retrieve)
  {
    var replacedby = element.retrieve("wh-ui-replacedby");
    if(replacedby)
      element = replacedby;
  }
  return element == domfocus.getActiveElement(element.ownerDocument);
}

/// Returns whether an element contains (or its replacement) the current focused element
function containsFocus(element)
{
  if(!element.ownerDocument)
    return false;
  if(element && element.retrieve)
  {
    var replacedby = element.retrieve("wh-ui-replacedby");
    if(replacedby)
      element = replacedby;
  }

  // Test if focused element is element itself or a subnode (contains also return true on when the nodes equal each other)
  return element.contains(domfocus.getActiveElement(element.ownerDocument));
}

module.exports = { getFocusableElement: getFocusableElement
                 , canFocus: domfocus.canFocusTo
                 , containsFocus: containsFocus
                 , hasFocus: hasFocus
                 , focus: dompack.focusElement
                 , getCurrentlyFocusedElement: domfocus.getCurrentlyFocusedElement
                 , getAllFocusableComponents: domfocus.getAllFocusableComponents
                 , getFocusableComponents: domfocus.getFocusableComponents
                 };

const error = "@mod-system/js/dom/focus is unmaintained and should not be used for new projects.\n\nThis library was mostly used for the mootools-based wh.component framework. You can find cleaner alternatives in dompack and dompack/browserfix/focus";
console.error(error);
if(whintegration.config.dtapstage == "development" && !sessionStorage.alertedDomFocus)
{
  sessionStorage.alertedDomFocus = true;
  alert(error);
}
