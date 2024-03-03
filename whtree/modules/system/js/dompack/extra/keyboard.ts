/* All keynames should be mixed-cased, as done here: http://www.w3.org/TR/DOM-Level-3-Events-key/

   Modifiers should be in the ordering Alt+Control+Meta+Shift+key (ie alphabetical)

   To simply prevent keys from propagating up (ie to keep Enter inside its textarea)
   new KeyboardHandler(this.textarea, {}, { dontpropagate: ['Enter']});
*/

import { NormalizedKeyboardEvent, normalizeKeyboardEventData } from '../src/events';
import { debugflags } from '../src/debug';
import { getPlatform } from './browser';
const IS_MAC_PLATFORM = getPlatform() === "mac";

const propnames = {
  shiftKey: "Shift",
  ctrlKey: IS_MAC_PLATFORM ? "Control" : ["Accel", "Control"],
  metaKey: IS_MAC_PLATFORM ? ["Accel", "Meta"] : "Meta",
  altKey: "Alt"
};

function getFinalKey(event: NormalizedKeyboardEvent) { //get the name for the 'final' key, eg the 'D' in 'alt+control+d'
  if (event.code.startsWith('Key') && event.code.length === 4)
    return event.code.substring(3, 4).toUpperCase();
  if (event.code.startsWith('Digit') && event.code.length === 6)
    return event.code.substring(5, 6).toUpperCase();
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function getKeyNames(event: NormalizedKeyboardEvent) {
  let names: string[][] = [[]];

  /*
    // Firefix under selenium on linux always says 'Unidentified' as key. Backup for some keys.
    if (basekey === "Unidentified")
      basekey = selenium_backup[event.keyCode];
  */
  // Create the modifiers in the names array (omit the basekey, so we can sort on modifier first)
  (Object.keys(propnames) as Array<keyof typeof propnames>).forEach(propname => {
    if (event[propname]) {
      // The key is pressed. Add the modifier name to all current names.
      const modifier: string | string[] = propnames[propname];
      if (!Array.isArray(modifier))
        names.forEach(function (arr) { arr.push(modifier); });
      else {
        // Multiple modifiers map to this key, duplicate all result sequences for every modifier
        const newkeys: string[][] = [];
        modifier.forEach(function (singlemodifier) {
          names.forEach(function (arr) {
            newkeys.push(arr.concat([singlemodifier]));
          });
        });
        names = newkeys;
      }
    }
  });

  return names.map(function (arr) {
    // Sort the modifier names
    arr = arr.sort();
    arr.push(getFinalKey(event));
    return arr.join("+");
  });
}

function validateKeyName(key: string) {
  const modifiers = key.split("+");
  modifiers.pop();

  // Check for allowed modifiers
  modifiers.forEach(function (mod) {
    if (!["Accel", "Alt", "Control", "Meta", "Shift"].includes(mod))
      throw new Error("Illegal modifier name '" + mod + "' in key '" + key + "'");
  });

  const original_order = modifiers.join('+');
  modifiers.sort();
  if (modifiers.join('+') !== original_order)
    throw new Error("Illegal key name " + key + ", modifiers must be sorted alphabetically");
}

type KeyboardMappingHandler = (event: KeyboardEvent) => boolean | void;
type KeyboardMapping = { [key: string]: KeyboardMappingHandler };
type KeyPressHandler = (event: KeyboardEvent, key: string) => boolean | void;
type KeyboardEventHandler = (event: Event) => void;
type KeyboardHandlerOptions =
  {
    stopmapped?: boolean;
    dontpropagate?: string[];
    onkeypress?: KeyPressHandler;
    captureunsafekeys?: boolean;
    listenoptions?: AddEventListenerOptions;
  };

/**
     node: The node to attach to
    keymap: Keymap
    options.stopmapped - preventDefault and stopPropagation on any key we have in our map
    options.dontpropagate - string array of keys not to propagate out of this object
    options.onkeypress - when set, call for all keypresses. signature: function (event, key). Should always return true and preventDefault (and/or stop) the event to cancel its handling
    options.listenoptions - addEventListener options (eg \{capture:true\})
 */
export default class KeyboardHandler {
  node: EventTarget;
  keymap: KeyboardMapping;
  stopmapped: boolean;
  dontpropagate: string[];
  onkeypress?: KeyPressHandler;
  captureunsafekeys: boolean;
  private _listenoptions?: AddEventListenerOptions;
  private _onkeydown: KeyboardEventHandler;
  private _onkeypress: KeyboardEventHandler;

  constructor(node: EventTarget, keymap: KeyboardMapping, options?: KeyboardHandlerOptions) {
    this.node = node;
    this.keymap = {};
    this.stopmapped = options?.stopmapped ?? false;
    this.dontpropagate = options?.dontpropagate ? [...options.dontpropagate].map(name => name.toUpperCase()) : [];
    this.onkeypress = options?.onkeypress;
    this.captureunsafekeys = options?.captureunsafekeys ?? false;
    this._listenoptions = options?.listenoptions;

    Object.keys(keymap).forEach(keyname => {
      if (debugflags.key)
        validateKeyName(keyname);
      this.keymap[keyname.toUpperCase()] = keymap[keyname];
    });

    this._onkeydown = (event) => this._onKeyDown(event);
    this._onkeypress = (event) => this._onKeyPress(event);
    node.addEventListener('keydown', this._onkeydown, this._listenoptions);
    node.addEventListener('keypress', this._onkeypress, this._listenoptions);
  }

  destroy() {
    this.node.removeEventListener('keydown', this._onkeydown, this._listenoptions);
    this.node.removeEventListener('keypress', this._onkeypress, this._listenoptions);
  }

  /**
       Returns thether the current pressed special key should be ignored for the current target node
      Used to detect input/textarea/rte's
   *
      @param target - Current target node for keyboard event
      @param key - Parsed key
      @param keynames - Potential names for the keys (as returned by GetKeyNames)
      @returns Whether the key must be ignored by KeyboardHandler, default browser behaviour should be triggered.
   */
  private _mustIgnoreKey(target: EventTarget | null, key: string, keynames: string[]) {
    if (!(target instanceof Node))
      return false;
    const tag = target.nodeName.toLowerCase();
    if (tag === "select") {
      if (["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].indexOf(key) !== -1)
        return true;
    } else if (tag === "input" || tag === "textarea" || (target instanceof HTMLElement && target.isContentEditable)) {
      // These keys we ignore, regardless of the modifier
      if ([
        "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
        "PageUp", "PageDown",
        "Home", "End",
        "Insert", "Delete", "Backspace"
      ].indexOf(key) !== -1)
        return true;

      let is_special_combo = false;

      // only input doesn't want exact combo 'Enter', the rest does
      if (tag !== "input" && keynames.indexOf("Enter") !== -1)
        is_special_combo = true;

      // Only contenteditable wants "Shift+Enter"
      if (target instanceof HTMLElement && target.isContentEditable && keynames.indexOf("Shift+Enter") !== -1)
        is_special_combo = true;

      // These exact combo's are wanted by all inputs
      ["Accel+A", "Accel+V", "Accel+C", "Accel+X"].forEach(function (name) {
        is_special_combo = is_special_combo || keynames.indexOf(name) !== -1;
      });
      return is_special_combo;
    }
    return false;
  }

  addKey(keybinding: string, handler: KeyboardMappingHandler) {
    if (debugflags.key) {
      validateKeyName(keybinding);
      console.log("[key] KeyDown handler registered for " + keybinding);
    }
    this.keymap[keybinding.toUpperCase()] = handler;
  }
  removeKey(keybinding: string) {
    delete this.keymap[keybinding.toUpperCase()];
  }
  _onKeyDown(event: Event) { // We're a key event handler, so we know the event is a KeyboardEvent
    const keydata = normalizeKeyboardEventData(event as KeyboardEvent);

    // Get all possible names for this key
    const keynames = getKeyNames(keydata);
    if (!keydata.key || !keynames.length) {
      if (debugflags.key)
        console.log("[key] KeyDown handler for ", this.node, " did not recognize key from event", event);
      return true;
    }

    if (debugflags.key)
      console.log("[key] KeyDown handler for ", this.node, " got key ", keydata.key, " with target ", event.target, " keynames:", keynames);

    /* Some keys we ignore, unless we're explicitly bound to a node, so we don't inadvertly break eg a <input> node inside
       a listview we're handling or otherwise break a user's expectation. Set the option 'captureunsafekeys' if you explicitly
       want to be able to capture any key */

    if (!this.captureunsafekeys && this._mustIgnoreKey(event.target, keydata.key, keynames)) {
      if (debugflags.key)
        console.log("[key] KeyDown event will not be intercepted, it's an unsafe key to intercept");
      return true;
    }

    if (this.dontpropagate) {
      keynames.forEach(keyname => {
        if (this.dontpropagate.includes(keyname)) {
          if (debugflags.key)
            console.log("[key] KeyDown event will not bubbleup because of our dontpropagate option (but may still trigger a default action)");
          event.stopPropagation();
        }
      });
    }

    for (let i = 0; i < keynames.length; ++i) {
      const mapping = this.keymap[keynames[i].toUpperCase()];
      if (!mapping)
        continue;

      if (this.stopmapped) {
        if (debugflags.key)
          console.log("[key] KeyDown event will not bubbleup or trigger default, because we're configured to block any mapped key");
        event.stopPropagation();
        event.preventDefault();
      }

      const ishandled = mapping.apply(this.node, [event as KeyboardEvent]);
      if (ishandled && !event.defaultPrevented) {
        console.warn(`The key handler for '${keynames[i]}' should preventDefault (or dompack.stop) the event to block fruther propagation`);
        event.stopPropagation();
        event.preventDefault();
        if (debugflags.key)
          console.log("[key] KeyDown event will not bubbleup or trigger default, because the keyhandler indicated the key was handled");
      }

      if (!event.defaultPrevented && debugflags.key)
        console.log("[key] KeyDown event was not blocked by its explicitly configured handler");
    }
    return true;
  }
  _onKeyPress(event: Event) { // We're a key event handler, so we know the event is a KeyboardEvent
    const keydata = normalizeKeyboardEventData(event as KeyboardEvent);

    if (this.onkeypress) {
      if (!this.onkeypress.apply(this.node, [event as KeyboardEvent, keydata.key])) {
        if (!event.defaultPrevented)
          console.warn("The onkeypress handler should preventDefault (or dompack.stop) the event to block fruther propagation");
        event.stopPropagation();
        event.preventDefault();
      }
    }
  }
}

export function getEventKeyNames(event: KeyboardEvent) {
  const keydata = normalizeKeyboardEventData(event);
  return getKeyNames(keydata);
}

/**
 * Is the native 'copy' modifier for this platform pressed?
 *
 * @param event - Event to check
 */
export function hasNativeEventCopyKey(event: KeyboardEvent) {
  return event && (IS_MAC_PLATFORM ? event.altKey : event.ctrlKey);
}

/**
 * Is the native 'multiselect' modifier for this platform pressed?
 *
 * @param event - Event to check
 */
export function hasNativeEventMultiSelectKey(event: KeyboardEvent) {
  return event && (IS_MAC_PLATFORM ? event.metaKey : event.ctrlKey);
}

export function getDragModeOverride(event: KeyboardEvent) {
  const modifiers =
    (event.altKey ? "Alt+" : "") +
    (event.ctrlKey ? "Control+" : "") +
    (event.metaKey ? "Meta+" : "") +
    (event.shiftKey ? "Shift+" : "") +
    (IS_MAC_PLATFORM ? "Mac" : "Other");

  let override = "";
  switch (modifiers) {
    case "Shift+Other":
    case "Meta+Other": override = "move"; break;
    case "Control+Other":
    case "Alt+Mac": override = "copy"; break;
    case "Control+Shift+Other":
    case "Alt+Other":
    case "Control+Mac": override = "link"; break;
  }

  return override;
}
