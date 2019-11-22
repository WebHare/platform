import * as dompack from "dompack";
import KeyboardHandler from "dompack/extra/keyboard";
import { qS } from "dompack";
import "@mod-system/js/wh/testframework";
import * as keyboard from 'dompack/testframework/keyboard';

function convertToHex(str) {
    var hex = '';
    for(var i=0;i<str.length;i++) {
        hex += ''+str.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
}

dompack.onDomReady( () =>
{
  qS('#testfield').addEventListener("keypress", onkeyevent);
  qS('#testfield').addEventListener("keydown", onkeyevent);
  qS('#testfield').addEventListener("keyup", onkeyevent);

  new KeyboardHandler(qS('#keyboardbunny'),
    { "Control+a":       () => { qS('#lastkey').value='^a'; return true; }
    , "Control+Shift+b": () => { qS('#lastkey').value='^B'; return true; }
    }, { captureunsafekeys: true });
});

function ignoreExceptions(code)
{
  try { return code(); } catch(e) { return undefined; }
}

function onkeyevent(e)
{
  let orge = e;
  var node = document.createElement("div");
  node.style.whiteSpace = "pre";
  let utf8_key = unescape(encodeURIComponent(e.key || e.keyIdentifier));
  let norm = dompack.normalizeKeyboardEventData(e);

  //console.log("onkeyevent", e, convertToHex(utf8_key), norm.key);

  //exception safe updates of JSON data, so callers can easily clear 'm'
  if(e.type =='keydown' || e.type == 'keyup')
  {
    let currentdownkeys = [];
    ignoreExceptions( () => currentdownkeys = JSON.parse(qS('#keysdown').value));
    if(e.type=='keydown')
    {
      if (!~currentdownkeys.indexOf(e.key))
        currentdownkeys.push(e.key);
    }
    else
    {
      let keyindex = currentdownkeys.indexOf(e.key);
      if(keyindex >= 0)
        currentdownkeys.splice(keyindex,1);
    }
    qS('#keysdown').value = JSON.stringify(currentdownkeys);
  }
  else if(e.type=='keypress')
  {
    let currentpressed = [];
    ignoreExceptions( () => currentpressed = JSON.parse(qS('#keyspressed').value));
    currentpressed.push(e.key);
    qS('#keyspressed').value = JSON.stringify(currentpressed);
  }

  //console.warn("Norm", norm);
  qS('#keylog').appendChild(node);

  let text =
    'type: ' + e.type + ' mykey: ' + norm.key + '\n' +
    'normal: key: ' + e.key + ' (' + convertToHex(utf8_key) + '), code: ' + e.code + ', location: ' + e.location + ', iscomposing: ' + e.isComposing + ', locale: ' + e.locale + '\n' +
    `state: ctrlKey: ${e.ctrlKey}, altKey: ${e.altKey}, location: ${e.location}, shiftKey: ${e.shiftKey}, metaKey: ${e.metaKey}, repeat: ${e.repeat}\n` +
    'deprecated: char: ' + encodeURIComponent(e.char) + ', charCode: ' + e.charCode + ', keyCode: ' + e.keyCode + ', keyIdentifier: ' + e.keyIdentifier + ', keyLocation: ' + e.keyLocation + ', which: ' + e.which;
  node.textContent = text;

  let simultext;
  node = document.createElement("div");
  node.style.whiteSpace = "pre";
  qS('#keylog').appendChild(node);

  let eventlist = [];
  ignoreExceptions( () => eventlist = JSON.parse(qS('#eventlist').value));
  try
  {
    e = window.generateKeyboardEvent(norm.target, norm.type, norm);

    //console.log("simulated event", e, "from key", encodeURIComponent(norm.key));
    //console.log("views", orge.view, e.view, orge.view === e.view);
    if (orge.view !== e.view)
      qS('#keylog').appendChild(dompack.create("div", { style: { color: "#FF0000" }, textContent: "view differs" } ));

    utf8_key = unescape(encodeURIComponent(e.key || e.keyIdentifier));
    norm = dompack.normalizeKeyboardEventData(e);

    simultext =
      'type: ' + e.type + ' mykey: ' + norm.key + '\n' +
      'normal: key: ' + e.key + ' (' + convertToHex(utf8_key) + '), code: ' + e.code + ', location: ' + e.location + ', iscomposing: ' + e.isComposing + ', locale: ' + e.locale + '\n' +
      `state: ctrlKey: ${e.ctrlKey}, altKey: ${e.altKey}, location: ${e.location}, shiftKey: ${e.shiftKey}, metaKey: ${e.metaKey}, repeat: ${e.repeat}\n` +
      'deprecated: char: ' + encodeURIComponent(e.char) + ', charCode: ' + e.charCode + ', keyCode: ' + e.keyCode + ', keyIdentifier: ' + e.keyIdentifier + ', keyLocation: ' + e.keyLocation + ', which: ' + e.which;

    qS('#keylog').appendChild(dompack.create("div", { style: { fontStyle: "italic" }, textContent: "props: " + JSON.stringify(keyboard.getKeyboardEventProps(norm)) } ));
    eventlist.push({"keydown": "+", "keypress": "=", "keyup": "-"}[e.type] + norm.key);
  }
  catch (e)
  {
    simultext = "Exception: " + e;
    console.error(e);
    eventlist.push("#error");
  }
  qS('#eventlist').value = JSON.stringify(eventlist);

  node.textContent = 'simulated ' + simultext;
  if (text != simultext)
    node.style.color = "#FF0000";

  qS('#keylog').appendChild(dompack.create("br"));

  if (e.type === "keyup" && e.keyCode === 82) // small r
  {
    dompack.empty(qS("#keylog"));
    qS("#eventlist").value = "";
    qS("#keysdown").value = "";
    qS("#keyspressed").value = "";
    qS("#testfield").value = "";
    document.querySelector("input").value = "";
    return;
  }
}
