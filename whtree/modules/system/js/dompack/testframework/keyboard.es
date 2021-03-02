import { debugflags } from "../src/debug.es";
import { fireHTMLEvent } from "../src/events.es";
import { checkedDispatchEvent } from "./pointer.es";
import { getName as browserName } from "../extra/browser.es";
import * as domfocus from "../browserfix/focus.es";


export function getKeyboardEventProps(data)
{
  let keycode = 0;
  let presscode = 0;
  let ischar = false;
  let location = 0;

  //console.log("_getKeyboardEventProps", data.key, data.code);

  if (data.key.length === 1) // one printable character. Don't even bother with producing right key and char codes
  {
    let keycharcode = data.key.charCodeAt(0);
    if (keycharcode < 32 || keycharcode == 127)
      throw new Error(`No control characters, please use UI-Events name (used key ${encodeURIComponent(data.key)})`);
    let ukeycharcode = data.key.toUpperCase().charCodeAt(0);

    presscode = keycharcode;

    // Mapping for key=>keyCode an US-EN keyboard. Other keyboards may have other mappings
    // ADDME: for /*+-. see if shift is enabled, use numpad code if so?
    let key_to_keycode_mapping =
      { " ":    32
      , "!":    49
      , "@":    50
      , "#":    51
      , "$":    52
      , "%":    53
      , "^":    54
      , "&":    55
      , "*":    56
      , "(":    57
      , ")":    58
      , ";":    186
      , ":":    186
      , "+":    187
      , "=":    187
      , ",":    188
      , "<":    188
      , "-":    189
      , "_":    189
      , ".":    190
      , ">":    190
      , "/":    191
      , "?":    191
      , "~":    192
      , "`":    192
      , "§":    192 // mac keyboard
      , "[":    219
      , "{":    219
      , "\\":   220
      , "|":    220
      , "]":    221
      , "}":    221
      , "'":    222
      , "\"":   222 // etc
      };

    if ((ukeycharcode >= 48 && ukeycharcode <= 59) || // digits
        (ukeycharcode >= 65 && ukeycharcode <= 90)) // uppercase letters
      keycode = ukeycharcode;
    else if (!key_to_keycode_mapping[data.key])
      throw new Error(`No keycode mapping for character ${data.key} (${keycharcode}) defined, please add some`);
    else
      keycode = key_to_keycode_mapping[data.key];

    ischar = true;
  }
  else
  {
    let key_to_keycode_mapping =
      { "Backspace":    8
      , "Tab":          9
      , "Enter":        13
      , "Shift":        16
      , "Control":      17
      , "Alt":          18
      , "Pause":        19
      , "CapsLock":     20
      , "Escape":       27
      , "PageUp":       33
      , "PageDown":     34
      , "End":          35
      , "Home":         36
      , "ArrowLeft":    37
      , "ArrowUp":      38
      , "ArrowRight":   39
      , "ArrowDown":    40
      , "Print":        42 // 44 on windows
      , "Insert":       45
      , "Delete":       46
      , "Meta":         91
      , "ContextMenu":  93
      , "F1":           112
      , "F2":           113
      , "F3":           114
      , "F4":           115
      , "F5":           116
      , "F6":           117
      , "F7":           118
      , "F8":           119
      , "F9":           120
      , "F10":          121
      , "F11":          122
      , "F12":          123
      , "NumLock":      144
      , "ScrollLock":   145
      , "Dead":         222
      };

    keycode = key_to_keycode_mapping[data.key];
    if (!keycode)
      throw new Error(`No keycode mapping for special key ${data.key} defined, please add some`);

    presscode = keycode;//browserName() == "firefox" ? keycode : 0; // only keypress in firefox
    if (data.key == "Delete") // Delete has a presscode of 127
      presscode = 127;
  }

  if (!data.code)
  {
    // Rough key=>code mapping for an US-EN keyboard. Other keyboards may have other mappings
    if (data.key.length === 1)
    {
      let ukeycharcode = data.key.toUpperCase().charCodeAt(0);
      if (ukeycharcode >= 48 && ukeycharcode <= 57) // digits
        data.code = "Digit" + data.key;
      else if (ukeycharcode >= 65 && ukeycharcode <= 90) // uppercase letters
        data.code = "Key" + data.key.toUpperCase();
      else
      {
        // Code values, see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code#Code_values for existing values
        let key_to_code_mapping =
          { ",":            "Comma"
          , ".":            "Period"
          , "/":            "Slash"
          , " ":            "Space"
          // ... and more, add them when necessary
          };
        data.code = key_to_code_mapping[data.key] || "Unidentified";
      }

    }
    else
    {
      let key_to_code_mapping =
        { "F1":           "F1"
        , "F2":           "F2"
        , "F3":           "F3"
        , "F4":           "F4"
        , "F5":           "F5"
        , "F6":           "F6"
        , "F7":           "F7"
        , "F8":           "F8"
        , "F9":           "F9"
        , "F10":          "F10"
        , "F11":          "F11"
        , "F12":          "F12"
        , "Insert":       "Insert"
        , "Delete":       "Delete"
        , "Enter":        "Enter"
        , "Backspace":    "Backspace"
        , "Escape":       "Escape"
        , "ArrowLeft":    "ArrowLeft"
        , "ArrowRight":   "ArrowRight"
        , "ArrowUp":      "ArrowUp"
        , "ArrowDown":    "ArrowDown"
        };

      data.code = key_to_code_mapping[data.key] || "Unidentified";
    }
  }

  if (!data.code.startsWith("Arrow"))
  {
    if (data.code.endsWith("Left"))
      location = 1;
    else if (data.code.endsWith("Right"))
      location = 2;
  }

  let props =
      { key:        data.key
      , code:       data.code
      , keycode:    keycode
      , presscode:  presscode
      , ischar:     ischar
      , haspress:   ischar
      , ctrlKey:    data.ctrlKey || false
      , altKey:     data.altKey || false
      , location:   data.location || location || 0
      , shiftKey:   data.shiftKey || false
      , metaKey:    data.metaKey || false
      , repeat:     data.repeat || false
      };

//  console.log(`Props from key '${encodeURIComponent(data.key)}' and code ${data.code}:`, props);

  return props;
}

export function generateKeyboardEvent(target, eventname, data)
{
  if (!data.key)
    throw new Error("Empty key passed to generateKeyboardEvent");

  //var result = true;
  var doc = target.ownerDocument;

  let props = getKeyboardEventProps(data);

  let evt;
  if (browserName() === "chrome")
  {
    let ischar = props.ischar || [ "Enter", "Delete" ].includes(props.key);
    let vals =
      { charCode:      eventname === "keypress" && ischar ? props.presscode : 0
      , keyCode:       eventname === "keypress" ? props.presscode : props.keycode
      , which:         eventname === "keypress" ? props.presscode : props.keycode
      };

    evt = new KeyboardEvent(eventname, { view:        doc.defaultView
                                       , key:         props.key
                                       , code:        props.code
                                       , ctrlKey:     props.ctrlKey
                                       , altKey:      props.altKey
                                       , location:    props.location
                                       , shiftKey:    props.shiftKey
                                       , metaKey:     props.metaKey
                                       , repeat:      props.repeat
                                       , bubbles:     true
                                       , cancelable:  true

                                       });
    Object.defineProperty(evt, 'charCode', { get : function() { return vals.charCode; } });
    Object.defineProperty(evt, 'keyCode', { get : function() { return vals.keyCode; } });
    Object.defineProperty(evt, 'which', { get : function() { return vals.which; } });

    if(debugflags.testfw)
      console.log('[testfw] Constructed chrome keyboardevent', evt);
  }
  else if (browserName() === "firefox")
  {
    // edge has some diffent mappings for .key. ("-":"Subtract" and "/":"Divide" are only used for numeric pad)
    let keymapping =
        { "Meta": "OS"
        };
    props.key = keymapping[props.key] || props.key;


    // firefox zeroes the keycode for printable characters in keypress events
    evt = new KeyboardEvent(eventname, { view :         doc.defaultView
                                       , key:           props.key
                                       , code:          props.code
                                       , charCode:      eventname === "keypress" && props.ischar ? props.presscode : 0
                                       , keyCode:       eventname === "keypress" ? (props.ischar ? 0 : props.presscode) : props.keycode
                                       , which:         eventname === "keypress" ? (props.ischar ? props.presscode : 0) : props.keycode
                                       , ctrlKey:       props.ctrlKey
                                       , altKey:        props.altKey
                                       , location:      props.location
                                       , shiftKey:      props.shiftKey
                                       , metaKey:       props.metaKey
                                       , repeat:        props.repeat
                                       , bubbles:       true
                                       , cancelable:    true
                                       });
    if(debugflags.testfw)
      console.log('[testfw] Constructed firefox keyboardevent', evt);
  }
  else if (browserName() === "edge" || browserName() == "ie")
  {
    // edge has some diffent mappings for .key. ("-":"Subtract" and "/":"Divide" are only used for numeric pad)
    let keymapping =
        { "ArrowUp": "Up",  "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right", "Escape": "Esc", "Delete": "Del"
        , "*": "Multiply", ".": "Decimal", "Meta": "Win", "ScrollLock": "Scroll", "Print": "PrintScreen", "ContextMenu": "Apps"
        };
    props.key = keymapping[props.key] || props.key;

    // 'Tab' also has 'char' set. Enter has char set to String.fromCodePoint(10)
    // ADDME: ctrl-key has wrong char code (eg. ctrl-v is \u0016)
    let withchar = (props.ischar || [ 8, 9, 13, 27 ].includes(props.presscode)) && !props.ctrlKey && !props.altKey;
    let vals =
        { char:       withchar ? props.presscode === 13 ? "\n" : String.fromCodePoint(props.presscode) : ""
        , charCode:   eventname === "keypress" && withchar ? props.presscode : 0
        , keyCode:    eventname === "keypress" ? props.presscode : props.keycode
        , which:      eventname === "keypress" ? props.presscode : props.keycode
        };

    // firefox zeroes the keycode for printable characters in keypress events
    if (browserName() === "edge")
    {
      evt = new KeyboardEvent(eventname, { view:          doc.defaultView
                                         , key:           props.key
                                         , code:          props.code
                                         , ctrlKey:       props.ctrlKey
                                         , altKey:        props.altKey
                                         , location:      props.location
                                         , shiftKey:      props.shiftKey
                                         , metaKey:       props.metaKey
                                         , repeat:        props.repeat
                                         , bubbles:       true
                                         , cancelable:    true
                                         });
      Object.defineProperty(evt, 'locale', { get : function() { return "en-US"; } });
    }
    else
    {
      evt = doc.createEvent("KeyboardEvent");
      let modifiers = [];
      if (props.ctrlKey) modifiers.push("Control");
      if (props.altKey) modifiers.push("Alt");
      if (props.shiftKey) modifiers.push("Shift");
      if (props.metaKey) modifiers.push("Win");
      evt.initKeyboardEvent(eventname, true, true, doc.defaultView, props.key, props.location, modifiers, props.repeat, "en-US");
    }

    Object.defineProperty(evt, 'char', { get : function() { return vals.char; } });
    Object.defineProperty(evt, 'charCode', { get : function() { return vals.charCode; } });
    Object.defineProperty(evt, 'keyCode', { get : function() { return vals.keyCode; } });
    Object.defineProperty(evt, 'which', { get : function() { return vals.which; } });
  }
  else if (browserName() === "safari")
  {
    let keymapping = { "ArrowUp": "Up",  "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right" };
    props.key = keymapping[props.key] || props.key;

    let hasucode = props.ischar || [ "Escape", "Tab", "Backspace", "Delete" ].includes(props.key);
    let hascharcode = props.ischar || [ "Escape", "Enter", "Backspace" ].includes(props.key);
    let keyidentifier = hasucode
        ? "U+" + ("000" + String.fromCodePoint(props.presscode).toUpperCase().charCodeAt(0).toString(16)).substr(-4).toUpperCase()
        : props.key;
    let vals =
      { keyIdentifier: eventname === "keypress" ? "" : keyidentifier
      , charCode:      eventname === "keypress" && hascharcode ? props.presscode : 0
      , keyCode:       eventname === "keypress" ? props.presscode : props.keycode
      , which:         eventname === "keypress" ? props.presscode : props.keycode
      };

    evt = new KeyboardEvent(eventname, { view:          doc.defaultView
                                       , key:           props.key
                                       , code:          props.code
                                       , keyIdentifier: vals.keyIdentifier
                                       , ctrlKey:       props.ctrlKey
                                       , altKey:        props.altKey
                                       , location:      props.location
                                       , shiftKey:      props.shiftKey
                                       , metaKey:       props.metaKey
                                       , repeat:        props.repeat
                                       , bubbles:       true
                                       , cancelable:    true
                                       });

    Object.defineProperty(evt, 'charCode', { get : function() { return vals.charCode; } });
    Object.defineProperty(evt, 'keyCode', { get : function() { return vals.keyCode; } });
    Object.defineProperty(evt, 'which', { get : function() { return vals.which; } });
  }

  if(debugflags.testfw)
    console.log('[testfw] Constructed ' + browserName() + ' keyboardevent', evt);

  return evt;
}

function _fireKeyboardEvent(target, eventname, props)
{
  if (typeof props === "string")
    props = { key: props };

  if (debugflags.testfw)
    console.log(`[testfw] Send ${eventname} with key '${encodeURIComponent(props.key)}' and code ${props.code} to `, target);

  let evt = generateKeyboardEvent(target, eventname, props);
  if(debugflags.testfw)
    console.log('[testfw] Dispatching event ', evt);

  return checkedDispatchEvent(target, evt);
}

export function normalizeKeys(key, props)
{
  let keys = Array.isArray(key) ? key : [key];
  let shift = props && props.shiftKey;
  //match single-char keys (real keys) to upper or lowercase depending on shift state
  keys = keys.map(key => key.length > 1 ? key : shift ? key.toUpperCase() : key.toLowerCase());
  return keys;
}

export async function pressKey(keylist, props)
{
  //key must be one of the names documented at https://w3c.github.io/uievents/#events-keyboardevents
  let keys = normalizeKeys(keylist, props);

  for (let key of keys)
  {
    //ensure asynchronous invocation for each keypress
    await new Promise(resolve => setTimeout(resolve,1));

    props = { ...props, key: key };
    let eventprops = getKeyboardEventProps(props);

    //Figure out which element has focus
    var focused = domfocus.getCurrentlyFocusedElement();
    if(debugflags.testfw)
     console.log('[testfw] SendKeyPress "' + key + '" to focused element:',focused);

    let retval = _fireKeyboardEvent(focused, 'keydown', props);
    if (eventprops.presscode && retval) //only fire press if down not cancelled
      retval = _fireKeyboardEvent(focused, 'keypress', props);

    if (retval)
    {
      if(eventprops.key == 'Tab')
      {
        doTabKey(eventprops.shiftKey ? -1 : +1);
      }
      else if(focused.nodeName=='TEXTAREA' || (focused.nodeName=='INPUT' && !['radio','textarea'].includes(focused.type)))
      {
        if (eventprops.key == 'Backspace')
        {
          if(focused.selectionStart == focused.selectionEnd) //delete the character before the cursor
            focused.value = focused.value.substr(0, focused.selectionStart-1) + focused.value.substr(focused.selectionEnd);
          else //delete the character
            focused.value = focused.value.substr(0, focused.selectionStart) + focused.value.substr(focused.selectionEnd);

          fireHTMLEvent(focused, 'input');
        }
        else if (eventprops.key == 'ArrowUp' || eventprops.key == 'ArrowDown')
        {
          if(focused.nodeName=='INPUT' && focused.type == 'number')
          {
            let value = parseInt(focused.value);
            if(!isNaN(value))
            {
              let step = parseInt(focused.getAttribute("step")) || 1;
              value = value + (eventprops.key == 'ArrowUp' ? +step : -step);

              if(eventprops.key == 'ArrowUp' && focused.hasAttribute("max") && value > parseInt(focused.getAttribute("max")))
                value = parseInt(focused.getAttribute("max"));
              if(eventprops.key == 'ArrowDown' && focused.hasAttribute("min") && value < parseInt(focused.getAttribute("min")))
                value = parseInt(focused.getAttribute("min"));

              focused.value = value;
              fireHTMLEvent(focused, 'input');
            }
          }
        }
        else if (eventprops.haspress)
        {
          if(!(props.ctrlKey || props.metaKey || props.altKey)) //these don't trigger text input
          {
            // Insert single character into the input field
            focused.value = focused.value.substr(0, focused.selectionStart) + key + focused.value.substr(focused.selectionEnd);
            if(debugflags.testfw)
             console.log('[testfw] SendKeyPress manually added "' + key + '" value now "' + focused.value  + '"');

    //        if(focused.nodeName=='TEXTAREA' || (focused.nodeName=='INPUT' && !['radio','textarea'].includes(focused.type)))
            fireHTMLEvent(focused, 'input');
          }
        }
      }
      else
      {
        // FIXME: handle selection, delete, cursor and such
      }
    }
    _fireKeyboardEvent(focused, 'keyup', props);
  }
}

export function simulateTabKey(direction)
{
  console.warn("simulateTabKey calls should be replaced with calls to `await test.pressKey('Tab', { shiftKey: true | false })` (if all relevant testing WebHares are 4.27+)`");
  doTabKey(direction);
}

function doTabKey(direction)
{
  var curfocus = domfocus.getCurrentlyFocusedElement();
  if(!curfocus)
    throw new Error("Unable to determine currently focused element");

  // only non-negative tabIndex, sort on tabIndex (but index 0 must be last)
  // must be a stable sort, so if equal we need to take the index into account too.
  let allfocus = domfocus.getAllFocusableComponents()
    .filter(node => node.tabIndex >= 0)
    .map((node, index) => ({ node, index }))
    .sort((a,b) => (a.node.tabIndex||32768) - (b.node.tabIndex||32768) || (a.index - b.index))
    .map(pair => pair.node);

  var curpos = allfocus.indexOf(curfocus);
  if(curpos==-1 && curfocus != curfocus.ownerDocument.body)
  {
    console.log("currentfocus",curfocus);
    console.log("all",allfocus.length,allfocus);
    throw new Error("Unable to find currently focused element in the list of all focusable elements");
  }

  curpos += direction;
  while(curpos<0)
    curpos += allfocus.length;
  curpos %= allfocus.length;

  let tofocus = allfocus[curpos];
  try
  {
    tofocus.focus();
    if(tofocus.select)
      tofocus.select();
  }
  catch (e)
  {
    console.log("simulateTabKey: Focus failed: ", allfocus[curpos], e);
  }

  var nowfocused = domfocus.getCurrentlyFocusedElement();
  if(allfocus[curpos] != nowfocused) //if an element is actally unfocusable, the browser just tends to ignore us (except IE, which loves to throw)
  {
    console.log("Tried to focus",allfocus[curpos]);
    console.log("Actually focused", nowfocused);
    allfocus[curpos].style.backgroundColor = "#ff0000";
    nowfocused.style.backgroundColor = "#00ff00";
    throw new Error("Setting focus failed!");
  }
}
