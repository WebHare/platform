/* global focusZones */
import * as dompack from 'dompack';
var domfocus = require('@mod-system/js/dom/focus');
window.focusZones = require('@mod-tollium/web/ui/components/focuszones');

function onZoneFocus(event)
{
  console.log('focus event',event);
  if(event.target == document.getElementById('focuszone2'))
    document.getElementById('log').append(<div>{"Focused focuszone2"}</div>);
}

function onZoneBlur(event)
{
  document.getElementById('log').append(<div>{"Zone " + (event.target.id || event.target.get('tag')) + " lost focus"}</div>);
}

function pageinit()
{
  window.addEventListener("wh:focuszone-blur", onZoneBlur);
  dompack.qSA(".tozone1").forEach(node => node.addEventListener("click", function() { focusZones.focusZone(document.getElementById('focuszone1')); }));
  dompack.qSA(".tozone2").forEach(node => node.addEventListener("click", function() { focusZones.focusZone(document.getElementById('focuszone2')); }));
  dompack.qSA(".tozone3").forEach(node => node.addEventListener("click", function() { focusZones.focusZone(document.getElementById('focuszone3')); }));
  dompack.qSA(".steal_input1_1").forEach(node => node.addEventListener("click", function() { console.log("click 1-1"); dompack.focus(document.getElementById('input1_1')); }));
  dompack.qSA(".steal_input2_3").forEach(node => node.addEventListener("click", function() { console.log("click 2-3"); dompack.focus(document.getElementById('input2_3')); }));
  //make sure these buttons don't steal focus themselves

  dompack.qSA("button").forEach(node => node.addEventListener("mousedown", function(event) { event.preventDefault(); console.log("prevent"); }));
}

window.addEventListener("wh:focuszone-focus", onZoneFocus);
window.addEventListener("dompack:takefocus", evt => console.log("prefocus event", evt));
document.addEventListener("DOMContentLoaded", pageinit);
