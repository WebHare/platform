import * as browser from 'dompack/extra/browser';
import * as domfocus from "dompack/browserfix/focus";

/* IE FOCUS FIX - IE allows <divs> and some other elements to receive focus, if directly clicked.
   Debugged it using:

  ( function() { if(document.activeElement) ($$('.wh-menubar')[0] || $$('#demo h1')[0]).set('text', (document.activeElement.outerHTML || document.activeElement.innerHTML).substr(0,100));}).periodical(100);

*/
if(browser.getName() == "ie")
{
  window.addEventListener("focus", function(event)
  {
    for(var settarget = event.target; settarget && !domfocus.canFocusTo(settarget); settarget=settarget.parentNode)
      ; //iterate until we find a target

    if(settarget && settarget != event.target && !settarget.isContentEditable)
      settarget.focus();
  },true);
}
