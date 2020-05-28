/** @require: var domcomponent = require('@mod-system/js/dom/component')

    We implement the api you need to build components. This is mostly a remix
    of existing code for now, but we may eventually eliminate parts of the original libraries
*/
import * as whintegration from '@mod-system/js/wh/integration';

const events = require('@mod-system/js/dom/events');
const domtools = require('@mod-system/js/dom/tools');

module.exports = { CustomEvent: events.CustomEvent
                 , dispatchCustomEvent: domtools.dispatchCustomEvent
                 };

const error = "@mod-system/js/dom/component is unmaintained and should not be used for new projects.\n\nJust use dompack.dispatchCustomEvent";
console.error(error);
if(whintegration.config.dtapstage == "development" && !sessionStorage.alertedDomComponent)
{
  sessionStorage.alertedDomComponent = true;
  alert(error);
}
