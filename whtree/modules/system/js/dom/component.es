/** @require: var domcomponent = require('@mod-system/js/dom/component')

    We implement the api you need to build components. This is mostly a remix
    of existing code for now, but we may eventually eliminate parts of the original libraries
*/

console.warn("dom/component is deprecated. use dom/tools");

const events = require('@mod-system/js/dom/events');
const domtools = require('@mod-system/js/dom/tools');

module.exports = { CustomEvent: events.CustomEvent
                 , dispatchCustomEvent: domtools.dispatchCustomEvent
                 };
