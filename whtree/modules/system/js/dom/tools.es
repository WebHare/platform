//ADDME starting from 4.07 or so, warn about uses of domtools
const dompack = require ('dompack');
import * as whintegration from '@mod-system/js/wh/integration';
module.exports = { ...dompack
                 , registerComponent:dompack.register //backwards compat
                 , onready:dompack.onDomReady
                 };

//////////////////////////////////////////////////////////////////////////////////
//
// REMOVE EVERYTHING BELOW THIS LINE IF YOU CLONE TIHS FILE TO YOUR OWN PROJECT
//
const error = "@mod-system/js/dom/tools is unmaintained and should not be used for new projects.\n\nJust use dompack.register and dompack.onDomReady";
console.error(error);
if(whintegration.config.dtapstage == "development" && !sessionStorage.alertedDomTools)
{
  sessionStorage.alertedDomTools = true;
  alert(error);
}
