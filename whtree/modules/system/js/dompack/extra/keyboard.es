/** @import: import KeyboardHandler from "dompack/extra/keyboard";

*/

/* All keynames should be mixed-cased, as done here: http://www.w3.org/TR/DOM-Level-3-Events-key/

   Modifiers should be in the ordering Alt+Control+Meta+Shift+key (ie alphabetical)

   To simply prevent keys from propagating up (ie to keep Enter inside its textarea)
   new KeyboardHandler(this.textarea, {}, { dontpropagate: ['Enter']});
*/

import { normalizeKeyboardEventData } from '../src/events.es';
import { debugflags } from '../src/debug.es';

var propnames = { "shiftKey":   "Shift"
                , "ctrlKey":    navigator.platform == "MacIntel" ? "Control" : [ "Accel", "Control" ]
                , "metaKey":    navigator.platform == "MacIntel" ? [ "Accel", "Meta" ] : "Meta"
                , "altKey":     "Alt"
                };

function getFinalKey(event) //get the naem for the 'final' key, eg the 'D' in 'alt+control+d'
{
  if(event.code.startsWith('Key') && event.code.length==4)
    return event.code.substr(3,1).toUpperCase();
  if(event.code.startsWith('Digit') && event.code.length==6)
    return event.code.substr(5,1).toUpperCase();
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function getKeyNames(event)
{
  let names = [[]];

/*
  // Firefix under selenium on linux always says 'Unidentified' as key. Backup for some keys.
  if (basekey == "Unidentified")
    basekey = selenium_backup[event.keyCode];
*/
  // Create the modifiers in the names array (omit the basekey, so we can sort on modifier first)
  Object.keys(propnames).forEach(function(propname)
  {
    if (event[propname])
    {
      // The key is pressed. Add the modifier name to all current names.
      var modifier = propnames[propname];
      if (!Array.isArray(modifier))
        names.forEach(function(arr) { arr.push(modifier); });
      else
      {
        // Multiple modifiers map to this key, duplicate all result sequences for every modifier
        var newkeys = [];
        modifier.forEach(function(singlemodifier)
        {
          names.forEach(function(arr)
          {
            newkeys.push(arr.concat([ singlemodifier ]));
          });
        });
        names = newkeys;
      }
    }
  });

  names = names.map(function(arr)
  {
    // Sort the modifier names
    arr = arr.sort();
    arr.push(getFinalKey(event));
    return arr.join("+");
  });

  return names;
}

function validateKeyName(key)
{
  var modifiers = key.split("+");
  modifiers.pop();

  // Check for allowed modifiers
  modifiers.forEach(function(mod)
  {
    if (![ "Accel", "Alt", "Control", "Meta", "Shift"].includes(mod))
      throw new Error("Illegal modifier name '" + mod + "' in key '" + key + "'");
  });

  var original_order = modifiers.join('+');
  modifiers.sort();
  if (modifiers.join('+') != original_order)
    throw new Error("Illegal key name " + key + ", modifiers must be sorted alphabetically");
}

/** node: The node to attach to
    keymap: Keymap
    options.stopmapped - preventDefault and stopPropagation on any key we have in our map
    options.dontpropagate - string array of keys not to propagate out of this object
    options.onkeypress - when set, call for all keypresses. signature: function(event, key). Should always return true and preventDefault (and/or stop) the event to cancel its handling
*/
export default class KeyboardHandler
{
  constructor(node, keymap, options)
  {
    this.node = node;
    this.keymap = {};
    this.stopmapped = options&&options.stopmapped;
    this.dontpropagate = options && options.dontpropagate ? [...options.dontpropagate].map(name => name.toUpperCase()) : [];
    this.onkeypress = options&&options.onkeypress;
    this.captureunsafekeys = options&&options.captureunsafekeys;
    this._listenoptions = (options && options.listenoptions) || {};

    Object.keys(keymap).forEach(keyname =>
    {
      if (debugflags.key)
        validateKeyName(keyname);
      this.keymap[keyname.toUpperCase()] = keymap[keyname];
    });

    this._onkeydown = (event) => this._onKeyDown(event);
    this._onkeypress = (event) => this._onKeyPress(event);
    node.addEventListener('keydown',  this._onkeydown, this._listenoptions);
    node.addEventListener('keypress', this._onkeypress, this._listenoptions);
  }

  destroy()
  {
    this.node.removeEventListener('keydown',  this._onkeydown, this._listenoptions);
    this.node.removeEventListener('keypress', this._onkeypress, this._listenoptions);
  }

  /** Returns thether the current pressed special key should be ignored for the current target node
      Used to detect input/textarea/rte's
      @param target Current target node for keyboard event
      @param key Parsed key (as returned by GetKeyNames)
      @return Whether the key must be ignored by KeyboardHandler, default browser behaviour should be triggered.
  */
  _mustIgnoreKey(target, key, keynames)
  {
    var tag = target.nodeName.toLowerCase();
    if (tag == "select")
    {
      if (["ArrowUp", "ArrowDown",  "Home", "End", "PageUp", "PageDown"].indexOf(key) != -1)
        return true;
    }
    else if (tag == "input" || tag == "textarea" || target.isContentEditable)
    {
      // These keys we ignore, regardless of the modifier
      if ([ "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"
          , "PageUp", "PageDown"
          , "Home", "End"
          , "Insert", "Delete", "Backspace"
          ].indexOf(key) != -1)
        return true;

      var is_special_combo = false;

      // only input doesn't want exact combo 'Enter', the rest does
      if (tag != "input" && keynames.indexOf("Enter") != -1)
        is_special_combo = true;

      // Only contenteditable wants "Shift+Enter"
      if (target.isContentEditable && keynames.indexOf("Shift+Enter") != -1)
        is_special_combo = true;

      // These exact combo's are wanted by all inputs
      [ "Accel+A", "Accel+V", "Accel+C", "Accel+X" ].forEach(function(name)
      {
        is_special_combo = is_special_combo || keynames.indexOf(name) != -1;
      });
      return is_special_combo;
    }
    return false;
  }

  addKey(keybinding, handler)
  {
    if(debugflags.key)
    {
      validateKeyName(keybinding);
      console.log("[key] KeyDown handler registered for " + keybinding);
    }
    this.keymap[keybinding.toUpperCase()] = handler;
  }
  removeKey(keybinding)
  {
    delete this.keymap[keybinding.toUpperCase()];
  }
  _onKeyDown(event)
  {
    let keydata = normalizeKeyboardEventData(event);

    // Get all possible names for this key
    let keynames = getKeyNames(keydata);
    if (!keydata.key || !keynames.length)
    {
      if(debugflags.key)
        console.log("[key] KeyDown handler for ", this.node, " did not recognize key from event",event);
      return true;
    }

    if(debugflags.key)
      console.log("[key] KeyDown handler for ", this.node, " got key ", keydata.key, " with target ", event.target, " keynames:",keynames);

    /* Some keys we ignore, unless we're explicitly bound to a node, so we don't inadvertly break eg a <input> node inside
       a listview we're handling or otherwise break a user's expectation. Set the option 'captureunsafekeys' if you explicitly
       want to be able to capture any key */

    if (!this.captureunsafekeys && this._mustIgnoreKey(event.target, keydata.key, keynames))
    {
      if(debugflags.key)
        console.log("[key] KeyDown event will not be intercepted, it's an unsafe key to intercept");
      return true;
    }

    if (this.dontpropagate)
    {
      keynames.forEach(keyname =>
      {
        if (this.dontpropagate.includes(keyname))
        {
          if(debugflags.key)
            console.log("[key] KeyDown event will not bubbleup because of our dontpropagate option (but may still trigger a default action)");
          event.stopPropagation();
        }
      });
    }

    for (var i = 0; i < keynames.length; ++i)
    {
      let mapping = this.keymap[keynames[i].toUpperCase()];
      if(!mapping)
        continue;

      if (this.stopmapped)
      {
        if(debugflags.key)
          console.log("[key] KeyDown event will not bubbleup or trigger default, because we're configured to block any mapped key");
        event.stopPropagation();
        event.preventDefault();
      }

      let ishandled = mapping.apply(this.node,[event]);
      if(ishandled && !event.defaultPrevented)
      {
        console.warn(`The key handler for '${keynames[i]}' should preventDefault (or dompack.stop) the event to block fruther propagation`);
        event.stopPropagation();
        event.preventDefault();
        if(debugflags.key)
          console.log("[key] KeyDown event will not bubbleup or trigger default, because the keyhandler indicated the key was handled");
      }

      if(!event.defaultPrevented && debugflags.key)
        console.log("[key] KeyDown event was not blocked by its explicitly configured handler");
    }
    return true;
  }
  _onKeyPress(event)
  {
    let keydata = normalizeKeyboardEventData(event);

    if (this.onkeypress)
    {
      if (!this.onkeypress.apply(this.node, [ event, keydata.key ]))
      {
        if(!event.defaultPrevented)
          console.warn("The onkeypress handler should preventDefault (or dompack.stop) the event to block fruther propagation");
        event.stopPropagation();
        event.preventDefault();
      }
    }
  }
}

export function getEventKeyNames(event)
{
  let keydata = normalizeKeyboardEventData(event);
  return getKeyNames(keydata);
}

KeyboardHandler.getEventKeyNames = function(event)
{
  let keydata = normalizeKeyboardEventData(event);
  return getKeyNames(keydata);
};

/** Is the native 'copy' modifier for this platform pressed? */
KeyboardHandler.hasNativeEventCopyKey = function(event)
{
  return event && (navigator.platform == "MacIntel" ? event.altKey : event.ctrlKey);
};

/** Is the native 'multiselect' modifier for this platform pressed? */
KeyboardHandler.hasNativeEventMultiSelectKey = function(event)
{
  return event && (navigator.platform == "MacIntel" ? event.metaKey : event.ctrlKey);
};

KeyboardHandler.getDragModeOverride = function(event)
{
  const modifiers =
      (event.altKey?"Alt+":"") +
      (event.ctrlKey?"Control+":"") +
      (event.metaKey?"Meta+":"") +
      (event.shiftKey?"Shift+":"") +
      (navigator.platform === "MacIntel" ? "Mac" : "Other");

  let override = "";
  switch (modifiers)
  {
    case "Shift+Other":
    case "Meta+Other":    override = "move"; break;
    case "Control+Other":
    case "Alt+Mac":       override = "copy"; break;
    case "Control+Shift+Other":
    case "Alt+Other":
    case "Control+Mac":   override = "link"; break;
  }

  return override;
};
