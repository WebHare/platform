import * as whintegration from '@mod-system/js/wh/integration';
import * as domscroll from 'dompack/browserfix/scroll';
module.exports = { scrollToElement: domscroll.scrollToElement};

const error = "@mod-system/js/dom/scroll is unmaintained and should not be used for new projects.\n\nJust load 'dompack/browserfix/scroll' instead";
console.error(error);
if(whintegration.config.dtapstage == "development" && !sessionStorage.alertedDomScroll)
{
  sessionStorage.alertedDomScroll = true;
  alert(error);
}
