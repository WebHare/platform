let eventconstructor = null;
let got_unload_event = false;

if(typeof window !== 'undefined')
{
  try  //IE11 does not ship with CustomEvent
  {
    new window.CustomEvent("test");
    eventconstructor = window.CustomEvent;
  }
  catch(e)
  {
    eventconstructor = function(event, params)
    {
      var evt;
      params = params || {
          bubbles: false,
          cancelable: false,
          detail: undefined
      };

      evt = document.createEvent("CustomEvent");
      evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
      return evt;
    };
    eventconstructor.prototype = window.Event.prototype;
  }
}

export let CustomEvent = eventconstructor;

export function dispatchDomEvent(element, eventtype, options)
{
  //see here https://developer.mozilla.org/en-US/docs/Web/Events whether an event is bubbles/cancelabel
  options = { bubbles: ["input","change","click","contextmenu","dblclick",
                       "reset","submit"].includes(eventtype)
            , cancelable: ["animationstart","animationcancel","animationend","animationiteration"
                          ,"beforeunload"
                          ,"click","contextmenu","dblclick"
                          ,"reset","submit"
                          ,"transitionstart","transitioncancel","transitionend","transitionrun"].includes(eventtype)
            , ...options
            };

  if(!element.ownerDocument)
    return true; //the element has left the dom... so there's no more bubbling. just drop it

  let createtype = ["load","scroll"].includes(eventtype) == "load" ? "UIEvents" : ["focus","blur","focusin","focusout"].includes(eventtype) ? "FocusEvent" : eventtype == "click" ? "MouseEvents" : "HTMLEvents";

  var evt = element.ownerDocument.createEvent(createtype);
  evt.initEvent(eventtype, options.bubbles, options.cancelable);
  if(options.detail)
    evt.detail = options.detail;
  if(options.relatedTarget) //its a readonly prop, so redefine it
    Object.defineProperty(evt, 'relatedTarget', { value:options.relatedTarget, writable: false });

  if(eventtype == 'click' && window.IScroll)
    evt._constructed = true; //ensure IScroll doesn't blindly cancel our synthetic clicks

  return element.dispatchEvent(evt);
}

//fire the proper modified events (input and/or change) on the element after changing its value - DEPRECATED, you should fire the proper input and change events according to the situation
export function fireModifiedEvents(element, options)
{
  fireHTMLEvent(element, 'input', options);
  fireHTMLEvent(element, 'change', options);
}

//manually fire 'onchange' events. needed for event simulation - DEPRECATED
export function fireHTMLEvent(element, type, options)
{
  return dispatchDomEvent(element, type, options);
}

/** Fire a custom event
    @param node node to fire the event on
    @param event event type
    @param params
    @cell params.bubbles
    @cell params.cancelable
    @cell params.detail
    @cell params.defaulthandler Handler to execute if the default isn't prevented by a event listener
    @return true if the default wasn't prevented
*/
export function dispatchCustomEvent(node, event, params)
{
  if(!params)
    params={};
  ['bubbles','cancelable'].forEach(prop =>
  {
    if(!(prop in params))
      throw new Error(`Missing '${prop}' in dispatchCustomEvent parameter`);
  });

  let evt = new CustomEvent(event, { bubbles: params.bubbles
                                   , cancelable: params.cancelable
                                   , detail: params.detail
                                   });
  let defaultaction = true;
  try
  {
    if(!node.dispatchEvent(evt))
      defaultaction = false; //defaultPrevented is unreliable on IE11, so double check
  }
  finally
  {
    if(!evt.defaultPrevented && params.defaulthandler && defaultaction)
    {
      params.defaulthandler(evt);
    }
  }
  return defaultaction && !evt.defaultPrevented;
}

/** Change the value of a form element, and fire the correct events as if it were a user change
    @param element Element to change
    @param newvalue New value */
export function changeValue(element, newvalue)
{
  if(element instanceof Array || element instanceof NodeList)
  {
    Array.from(element).forEach(node => changeValue(node, newvalue));
    return;
  }

  if(element.nodeName=='INPUT' && ['radio','checkbox'].includes(element.type))
  {
    if(!!element.checked == !!newvalue)
      return;
    element.checked=!!newvalue;
  }
  else
  {
    if(element.value == newvalue)
      return;

    element.value = newvalue;
  }
  dispatchDomEvent(element, 'input');
  dispatchDomEvent(element, 'change');
}

let keydata;
function initKeyMapping()
{
  keydata =
    {
      // Mapping from keyIdentifier/key to key. If not found, translate U+XXXX to the unicode char and return that.

      // List of all current key mappings (and current inconsistencies
      // at https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
      mapping:
        { "Del":                  "Delete" // IE/edge use 'Del' instead of 'Delete'
        , "Esc":                  "Escape" // IE/edge use 'Esc' instead of 'Escape'
        , "OS":                   "Meta" // Meta key is called OS on IE 9 and Firefox (tested v50)
        , "Win":                  "Meta" // Meta key is called Win on IE/Edge
        , "Scroll":               "ScrollLock" // More IE/Edge, from tests
        , "PrintScreen":          "Print" // More IE/Edge, from tests
        , "MozHomeScreen":        "GoHome" // Prior to Firefox 37, the Home button generated a key code of "Exit". Starting in Firefox 37, the button generates the key code "MozHomeScreen".

        // Internet Explorer 9 and Firefox 36 and earlier return "Left", "Right", "Up", and "Down" for the arrow keys, instead of "ArrowLeft", "ArrowRight", "ArrowUp", and "ArrowDown".
        , "Left":                 "ArrowLeft"
        , "Right":                "ArrowRight"
        , "Up":                   "ArrowUp"
        , "Down":                 "ArrowDown"
        // More IE and old Firefox stuff
        , "Crsel":                "CrSel"
        , "Exsel":                "ExSel"
        , "Nonconvert":           "NonConvert"
        // Internet Explorer 9 and Firefox 36 and earlier report "Apps" instead of "ContextMenu" for the context menu key.
        , "Apps":                 "ContextMenu"
        // Internet Explorer 9 and Firefox 36 and earlier use "MediaNextTrack" and "MediaPreviousTrack" instead of "MediaTrackNext" and "MediaTrackPrevious".
        , "MediaNextTrack":       "MediaTrackNext"
        , "MediaPreviousTrack":   "MediaTrackPrevious"
        // In Internet Explorer 9, and prior to Firefox 49, "AudioVolumeUp", "AudioVolumeDown", and "AudioVolumeMute" were "VolumeUp", "VolumeDown", and "VolumeMute".
        // In Firefox 49 they were updated to match the latest specification. The old names are still used on Boot to Gecko.
        , "VolumeUp":             "AudioVolumeUp"
        , "VolumeDown":           "AudioVolumeDown"
        , "VolumeMute":           "AudioVolumeMute"
        // Firefox added proper support for the "TV" key in Firefox 37; before that, this key generated the key code "Live".
        , "Live":                 "TV"
        // Internet Explorer 9 and Firefox 36 and earlier identify the zoom toggle button as "Zoom". Firefox 37 corrects this to "ZoomToggle".
        , "Zoom":                 "ZoomToggle"
        // Internet Explorer 9 and Firefox 36 and earlier use "SelectMedia" instead of "LaunchMediaPlayer". Firefox 37 through Firefox 48 use "MediaSelect". Firefox 49 has been updated to match the latest specification, and to return "LaunchMediaPlayer".
        , "SelectMedia":          "LaunchMediaPlayer"
        , "MediaSelect":          "LaunchMediaPlayer"
        // Google Chrome returns "LaunchCalculator" instead of "LaunchApplication1". See Chromium bug 612743 for more information.
        // Google Chrome returns "LaunchMyComputer" instead of "LaunchApplication2". See Chromium bug 612743 for more information.
        // (LaunchCalculator and LaunchMyComputer are valid too, so no translation)

          // While older browsers used words like "Add", "Decimal", "Multiply", and so forth modern browsers identify these using the actual character ("+", ".", "*", and so forth).
        , "Multiply":             "*"
        , "Add":                  "+"
        , "Divide":               "/"
        , "Subtract":             "-"
        , "Decimal":              "." // (mozilla Key_Values doc says depends on region)
        , "Separator":            "." // (mozilla Key_Values doc says depends on region)

          // keyIdenfier spec mapping of non-printable keys: https://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#keyset-keyidentifiers
          // Used in safari
        , "U+0008":               "Backspace"
        , "U+0009":               "Tab"
        , "U+000D":               "Enter"
        , "U+0018":               "Cancel"
        , "U+001B":               "Escape"
        , "U+007F":               "Delete"
        , "U+0300":               "DeadGrave"
        , "U+0301":               "DeadEacute"
        , "U+0302":               "DeadCircumflex"
        , "U+0303":               "DeadTilde"
        , "U+0304":               "DeadMacron"
        , "U+0306":               "DeadBreve"
        , "U+0307":               "DeadAboveDot"
        , "U+0308":               "DeadUmlaut"
        , "U+030A":               "DeadAboveRing"
        , "U+030B":               "DeadDoubleacute"
        , "U+030C":               "DeadCaron"
        , "U+0327":               "DeadCedilla"
        , "U+0328":               "DeadOgonek"
        , "U+0345":               "DeadIota"
        , "U+3099":               "DeadVoicedSound"
        , "U+309A":               "DeadSemivoicedSound"

          // keyIdenfier spec mapping to characters: https://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#keyset-keyidentifiers
        , "Exclamation":          "!"
        , "DoubleQuote":          "\""
        , "Hash":                 "#"
        , "Dollar":               "$"
        , "Ampersand":            "&"
        , "LeftParen":            "("
        , "RightParen":           ")"
        , "Asterisk":             "*"
        , "Plus":                 "+"
        , "Percent":              "%"
        , "Comma":                ","
        , "HyphenMinus":          "-"
        , "Period":               "."
        , "Solidus":              "/"
        , "Colon":                ":"
        , "Semicolon":            ";"
        , "LessThan":             "<"
        , "Equals":               "="
        , "GreaterThan":          ">"
        , "QuestionMark":         "?"
        , "At":                   "@"
        , "LeftSquareBracket":    "["
        , "Backslash":            "\\"
        , "RightSquareBracket":   "]"
        , "Circumflex":           "^"
        , "Underscore":           "_"
        , "Grave":                "`"
        , "LeftCurlyBracket":     "{"
        , "Pipe":                 "|"
        , "RightCurlyBracket":    "}"
        , "Euro":                 "€"
        , "InvertedExclamation":  "¡"

        // Safari fixes: viewed in local tests
        , "U+0010":               "ContextMenu"
        }
    };
}

/** Returns normalized keyboard event properties, following the current W3C UI Events spec
    @param evt Keyboard event
    @return Normalized keyboard event data
*/
export function normalizeKeyboardEventData(evt)
{
  // event.key is supported from chrome:51, edge, ff: 29, ie: 9, not in safari
  // event.keyIdentifier in chrome 26-54, opera 15-41, safara: 5.1
  // safari doesn't provide either in keypress events, use U+evt.keyCode (uppercase 4-byte hex)

  let key = evt.key;
  if (key && key.charCodeAt(0) < 32) // IE11 under selenium gives back control chars at keypress
    key = "";

  key = key || evt.keyIdentifier || (evt.keyCode ? "U+" + ("000" + evt.keyCode.toString(16)).substr(-4).toUpperCase() : "");
  if (!key)
    key = "Unidentified";
  if (!keydata)
    initKeyMapping();
  if (keydata.mapping.hasOwnProperty(key))
    key = keydata.mapping[key];
  else if (key.startsWith("U+")) // U+xxxx code
    key = String.fromCodePoint(parseInt(key.substr(2), 16));

  // IE11/edge numpad '.' with numlock returns 'Del' in .key in keypress event.
  if (evt.type === "keypress" && evt.char === ".")
    key = ".";
  else if (evt.key == "\u0000" && evt.code == "NumpadDecimal") // seen in chrome 56.0.2924.76 on linux, numpad '.' without numlock returns key "\u0000"
    key = ".";

  return (
      { type:         evt.type
      , target:       evt.target
      , key:          key
      , code:         evt.code || "Unidentified"
      , ctrlKey:      evt.ctrlKey
      , altKey:       evt.altKey
      , location:     evt.location
      , shiftKey:     evt.shiftKey
      , metaKey:      evt.metaKey
      , repeat:       evt.repeat
      , isComposing:  evt.isComposing
      });
}

/** Returns whether normal event processing is allowed (in IE11, it is dangerous to process events after
    the unload event, the javascript context may have been partially destroyed)
*/
export function allowEventProcessing()
{
  return !got_unload_event;
}

/** Stop, fully, an event */
export function stop(event)
{
  event.preventDefault();
  event.stopImmediatePropagation();
}

// Might also be executed in nodejs context
if (typeof window !== "undefined")
  window.addEventListener("unload", () => got_unload_event = true);
