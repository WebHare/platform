/** @requires: var domresizelistener = require('@mod-system/js/dom/resizelistener')
*/

//http://www.backalleycoder.com/2013/03/18/cross-browser-event-based-element-resize-detection/
import * as whintegration from '@mod-system/js/wh/integration';
var attachEvent = document.attachEvent;
import * as browser from 'dompack/extra/browser';

var isIE = navigator.userAgent.match(/Trident/);

function resizeListener(e)
{
  var win = e.target || e.srcElement; //this is the window of the object that served as resize trigger
  if (win.__resizeRAF__) window.cancelAnimationFrame(win.__resizeRAF__);
  win.__resizeRAF__ = window.requestAnimationFrame(function()
  {
    var trigger = win.__resizeTrigger__;
    trigger.dispatchEvent(new CustomEvent("wh:resized", { bubbles:true, cancelable: true}));
  });
}

function objectLoad(e){
  this.contentWindow.__resizeTrigger__ = this.__resizeElement__;
  this.contentWindow.addEventListener('resize', resizeListener);
}

function enableResizeEvents(element)
{
  if(element.__resizeTrigger__)
    return; //already set up

  if (attachEvent)
  {
    element.__resizeTrigger__ = element;
    element.attachEvent('onresize', resizeListener);
  }
  else {
    if (getComputedStyle(element).position == 'static') element.style.position = 'relative';
    var obj = element.__resizeTrigger__ = document.createElement('object');
    //IE11 & friends break without visibility:hidden, RTE and pulldowns using this compontent will break
    //Firefox breaks with visibility:hidden
    obj.setAttribute('style', 'display: block; position: absolute; top: 0; left: 0; height: 100%; width: 100%; overflow: hidden; pointer-events: none; z-index: -1;');
    if(browser.getName()=="ie")
      obj.style.visibility = 'hidden';
    obj.__resizeElement__ = element;
    obj.onload = objectLoad;
    obj.type = 'text/html';
    if (isIE) element.appendChild(obj);
    obj.data = 'about:blank';
    if (!isIE) element.appendChild(obj);
  }
}

function disableResizeEvents(element)
{
  if(!element.__resizeTrigger__)
    return; //already removed

  if (attachEvent) element.detachEvent('onresize', resizeListener);
  else {
    if(element.__resizeTrigger__.contentWindow)
      element.__resizeTrigger__.contentWindow.removeEventListener('resize', resizeListener);
    element.removeChild(element.__resizeTrigger__);
  }
  element.__resizeTrigger__ = null;
}

module.exports = { enableEvents: enableResizeEvents
                 , disableEvents: disableResizeEvents
                 };

//////////////////////////////////////////////////////////////////////////////////
//
// REMOVE EVERYTHING BELOW THIS LINE IF YOU CLONE TIHS FILE TO YOUR OWN PROJECT
//
const error = "@mod-system/js/dom/resizelistener is unmaintained and should not be used for new projects.\n\nWe recommend looking for alternatives that are mobile-friendly, as our approach heavily polled the browser\n\nIf you wish to keep using this library, that's... really not recommended... but please move it to your own module and then you can remove this message";
console.error(error);
if(whintegration.config.dtapstage == "development" && !sessionStorage.alertedDomResizeListener)
{
  sessionStorage.alertedDomResizeListener = true;
  alert(error);
}
