var whintegration = require('@mod-system/js/wh/integration');
module.exports = require('dompack/src/events');

var error = "@mod-system/js/dom/events is unmaintained and should not be used for new projects.\n\nJust load 'dompack/src/events' instead";
console.error(error);
if(whintegration.config.dtapstage == "development" && !sessionStorage.alertedDomEvents)
{
  sessionStorage.alertedDomEvents = true;
  alert(error);
}
