import { FormControlElement } from "@webhare/dompack/dompack";

export const CustomEvent = globalThis.CustomEvent;
/** Wrap an event to ensure it's target is a HTMLElement
 * @typeParam EventType - The expected event type
 * @typeParam CurrentTargetType - The type of the elemnt you're binding the event to. Optional, defaults to HTMLElement
*/
export type DocEvent<EventType extends Event, CurrentTargetType extends HTMLElement = HTMLElement> = EventType & {
  target: HTMLElement;
  currentTarget: CurrentTargetType;
};

export interface AddDocEventListenerOptions extends AddEventListenerOptions {
  /** Add to listenerset to allow easy deregistration */
  listenerSet?: EventListenerSet;
}

export type DomEventOptions =
  {
    bubbles?: boolean;
    cancelable?: boolean;
    relatedTarget?: EventTarget;
    detail?: object;
  };

export function dispatchDomEvent(element: EventTarget, eventtype: string, options?: DomEventOptions) {
  //see here https://developer.mozilla.org/en-US/docs/Web/Events whether an event is bubbles/cancelabel
  options = {
    bubbles: [
      "input", "change", "click", "contextmenu", "dblclick",
      "reset", "submit"
    ].includes(eventtype),
    cancelable: [
      "animationstart", "animationcancel", "animationend", "animationiteration",
      "beforeunload",
      "click", "contextmenu", "dblclick",
      "reset", "submit",
      "transitionstart", "transitioncancel", "transitionend", "transitionrun"
    ].includes(eventtype),
    ...options
  };

  if (!element || !(element as Node).ownerDocument)
    return true; //the element has left the dom... so there's no more bubbling. just drop it

  //FIXME the load/scroll is buggy and we should be probably be using new Event (but an earlier attempt at that triggered quite a few test failures)
  const createtype = /*["load","scroll"].includes(eventtype) === "load" ? "UIEvents" :*/["focus", "blur", "focusin", "focusout"].includes(eventtype) ? "FocusEvent" : eventtype === "click" ? "MouseEvents" : "HTMLEvents";
  //we verified its non-null ness above but TS doesn't really understand that
  const evt = (element as Node).ownerDocument!.createEvent(createtype);
  evt.initEvent(eventtype, options.bubbles, options.cancelable);
  if (options.detail)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we should just rewrite to new Event
    (evt as any).detail = options.detail;
  if (options.relatedTarget) //its a readonly prop, so redefine it
    Object.defineProperty(evt, 'relatedTarget', { value: options.relatedTarget, writable: false });

  //TODO: Should we keep this code?
  // @ts-ignore IScroll is a custom Window property set by IScroll
  if (eventtype === 'click' && window.IScroll)
    // @ts-ignore _constructed is a custom Event property used by IScroll
    evt._constructed = true; //ensure IScroll doesn't blindly cancel our synthetic clicks

  return element.dispatchEvent(evt);
}

/** Fire the proper modified events (input and/or change) on the element after changing its value
 * @param element - Element to receive event
 * @param options - Event options
 * @deprecated Use changeValue so we can figure out the proper events to fire
 */
export function fireModifiedEvents(element: FormControlElement, options?: DomEventOptions) {
  dispatchDomEvent(element, 'input', options);
  dispatchDomEvent(element, 'change', options);
}

//manually fire 'onchange' events. needed for event simulation - DEPRECATED
/**
 * @param element - Element to receive event
 * @param type - Event type
 * @param options - Event options
 * @deprecated Use dispatchDomEvent instead
 */
export function fireHTMLEvent(element: EventTarget, type: string, options?: DomEventOptions) {
  return dispatchDomEvent(element, type, options);
}

type CustomEventParams =
  {
    /** Whether this event should bubble up in the DOM */
    bubbles: boolean;
    /** Whether this event can be cancelled */
    cancelable: boolean;
    /** Custom event information */
    detail?: unknown;
    /** Handler to execute if the default isn't prevented by a event listener */
    defaulthandler?: (evt: CustomEvent) => void;
  };

/** Fire a custom event
    @param node - node to fire the event on
    @param event - event type. You should add this event to the GlobalEventHandlersEventMap for validation in dispatchCustomEvent calls and addEventListener callbacks.
    @param params - Event options
    @returns true if the default wasn't prevented
 */

export function dispatchCustomEvent<K extends string>(
  node: EventTarget,
  event: K,
  params: CustomEventParams & (K extends keyof GlobalEventHandlersEventMap ?
    GlobalEventHandlersEventMap[K] extends CustomEvent ?
    { detail: GlobalEventHandlersEventMap[K]["detail"] } : unknown : unknown)) {

  if (!params)
    throw new Error(`Missing dispatchCustomEvent params`);
  ['bubbles', 'cancelable'].forEach(prop => {
    if (!(prop in params))
      throw new Error(`Missing '${prop}' in dispatchCustomEvent params`);
  });

  const evt = new CustomEvent(event, {
    bubbles: params.bubbles,
    cancelable: params.cancelable,
    detail: params.detail
  });
  let defaultaction = true;
  try {
    if (!node.dispatchEvent(evt))
      defaultaction = false; //defaultPrevented is unreliable on IE11, so double check
  } finally {
    if (!evt.defaultPrevented && params.defaulthandler && defaultaction) {
      params.defaulthandler(evt);
    }
  }
  return defaultaction && !evt.defaultPrevented;
}

/**
     Change the value of a form element, and fire the correct events as if it were a user change
 *
    @param element - Element to change
    @param newvalue - New value
 */
export function changeValue(element: FormControlElement, newvalue: string | number | boolean) {
  if (element.matches(`input[type=radio], input[type=checkbox]`)) {
    if (Boolean((element as HTMLInputElement).checked) === Boolean(newvalue))
      return;
    (element as HTMLInputElement).checked = Boolean(newvalue);
  } else {
    //FIXME it's not really clean to assume that this element is changeable - throw for non input/select..
    const asString = String(newvalue);
    if ((element as HTMLInputElement).value === asString)
      return;

    (element as HTMLInputElement).value = String(newvalue);
  }
  dispatchDomEvent(element as EventTarget, 'input');
  dispatchDomEvent(element as EventTarget, 'change');
}

let keydata: { mapping: { [key: string]: string } };

function initKeyMapping() {
  keydata =
  {
    // Mapping from keyIdentifier/key to key. If not found, translate U+XXXX to the unicode char and return that.

    // List of all current key mappings (and current inconsistencies
    // at https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
    mapping:
    {
      "Del": "Delete", // IE/edge use 'Del' instead of 'Delete'
      "Esc": "Escape", // IE/edge use 'Esc' instead of 'Escape'
      "OS": "Meta", // Meta key is called OS on IE 9 and Firefox (tested v50)
      "Win": "Meta", // Meta key is called Win on IE/Edge
      "Scroll": "ScrollLock", // More IE/Edge, from tests
      "PrintScreen": "Print", // More IE/Edge, from tests
      "MozHomeScreen": "GoHome", // Prior to Firefox 37, the Home button generated a key code of "Exit". Starting in Firefox 37, the button generates the key code "MozHomeScreen".

      // Internet Explorer 9 and Firefox 36 and earlier return "Left", "Right", "Up", and "Down" for the arrow keys, instead of "ArrowLeft", "ArrowRight", "ArrowUp", and "ArrowDown".
      "Left": "ArrowLeft",
      "Right": "ArrowRight",
      "Up": "ArrowUp",
      "Down": "ArrowDown",
      // More IE and old Firefox stuff
      "Crsel": "CrSel",
      "Exsel": "ExSel",
      "Nonconvert": "NonConvert",
      // Internet Explorer 9 and Firefox 36 and earlier report "Apps" instead of "ContextMenu" for the context menu key.
      "Apps": "ContextMenu",
      // Internet Explorer 9 and Firefox 36 and earlier use "MediaNextTrack" and "MediaPreviousTrack" instead of "MediaTrackNext" and "MediaTrackPrevious".
      "MediaNextTrack": "MediaTrackNext",
      "MediaPreviousTrack": "MediaTrackPrevious",
      // In Internet Explorer 9, and prior to Firefox 49, "AudioVolumeUp", "AudioVolumeDown", and "AudioVolumeMute" were "VolumeUp", "VolumeDown", and "VolumeMute".
      // In Firefox 49 they were updated to match the latest specification. The old names are still used on Boot to Gecko.
      "VolumeUp": "AudioVolumeUp",
      "VolumeDown": "AudioVolumeDown",
      "VolumeMute": "AudioVolumeMute",
      // Firefox added proper support for the "TV" key in Firefox 37; before that, this key generated the key code "Live".
      "Live": "TV",
      // Internet Explorer 9 and Firefox 36 and earlier identify the zoom toggle button as "Zoom". Firefox 37 corrects this to "ZoomToggle".
      "Zoom": "ZoomToggle",
      // Internet Explorer 9 and Firefox 36 and earlier use "SelectMedia" instead of "LaunchMediaPlayer". Firefox 37 through Firefox 48 use "MediaSelect". Firefox 49 has been updated to match the latest specification, and to return "LaunchMediaPlayer".
      "SelectMedia": "LaunchMediaPlayer",
      "MediaSelect": "LaunchMediaPlayer",
      // Google Chrome returns "LaunchCalculator" instead of "LaunchApplication1". See Chromium bug 612743 for more information.
      // Google Chrome returns "LaunchMyComputer" instead of "LaunchApplication2". See Chromium bug 612743 for more information.
      // (LaunchCalculator and LaunchMyComputer are valid too, so no translation)

      // While older browsers used words like "Add", "Decimal", "Multiply", and so forth modern browsers identify these using the actual character ("+", ".", "*", and so forth).
      "Multiply": "*",
      "Add": "+",
      "Divide": "/",
      "Subtract": "-",
      "Decimal": ".", // (mozilla Key_Values doc says depends on region)
      "Separator": ".", // (mozilla Key_Values doc says depends on region)

      // keyIdenfier spec mapping of non-printable keys: https://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#keyset-keyidentifiers
      // Used in safari
      "U+0008": "Backspace",
      "U+0009": "Tab",
      "U+000D": "Enter",
      "U+0018": "Cancel",
      "U+001B": "Escape",
      "U+007F": "Delete",
      "U+0300": "DeadGrave",
      "U+0301": "DeadEacute",
      "U+0302": "DeadCircumflex",
      "U+0303": "DeadTilde",
      "U+0304": "DeadMacron",
      "U+0306": "DeadBreve",
      "U+0307": "DeadAboveDot",
      "U+0308": "DeadUmlaut",
      "U+030A": "DeadAboveRing",
      "U+030B": "DeadDoubleacute",
      "U+030C": "DeadCaron",
      "U+0327": "DeadCedilla",
      "U+0328": "DeadOgonek",
      "U+0345": "DeadIota",
      "U+3099": "DeadVoicedSound",
      "U+309A": "DeadSemivoicedSound",

      // keyIdenfier spec mapping to characters: https://www.w3.org/TR/2009/WD-DOM-Level-3-Events-20090908/#keyset-keyidentifiers
      "Exclamation": "!",
      "DoubleQuote": "\"",
      "Hash": "#",
      "Dollar": "$",
      "Ampersand": "&",
      "LeftParen": "(",
      "RightParen": ")",
      "Asterisk": "*",
      "Plus": "+",
      "Percent": "%",
      "Comma": ",",
      "HyphenMinus": "-",
      "Period": ".",
      "Solidus": "/",
      "Colon": ":",
      "Semicolon": ";",
      "LessThan": "<",
      "Equals": "=",
      "GreaterThan": ">",
      "QuestionMark": "?",
      "At": "@",
      "LeftSquareBracket": "[",
      "Backslash": "\\",
      "RightSquareBracket": "]",
      "Circumflex": "^",
      "Underscore": "_",
      "Grave": "`",
      "LeftCurlyBracket": "{",
      "Pipe": "|",
      "RightCurlyBracket": "}",
      "Euro": "€",
      "InvertedExclamation": "¡",

      // Safari fixes: viewed in local tests
      "U+0010": "ContextMenu"
    }
  };
}

export type NormalizedKeyboardEvent =
  {
    type: string;
    target: EventTarget | null;
    key: string;
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    location: number;
    shiftKey: boolean;
    metaKey: boolean;
    repeat: boolean;
    isComposing: boolean;
  };

/**
     Returns normalized keyboard event properties, following the current W3C UI Events spec
 *
    @param evt - Keyboard event
    @returns Normalized keyboard event data
 */
export function normalizeKeyboardEventData(evt: KeyboardEvent): NormalizedKeyboardEvent {
  // event.key is supported from chrome:51, edge, ff: 29, ie: 9, not in safari
  // event.keyIdentifier in chrome 26-54, opera 15-41, safara: 5.1
  // safari doesn't provide either in keypress events, use U+evt.keyCode (uppercase 4-byte hex)

  let key = evt.key;
  if (!keydata)
    initKeyMapping();
  if (keydata.mapping[key])
    key = keydata.mapping[key];
  else if (key.startsWith("U+")) // U+xxxx code
    key = String.fromCodePoint(parseInt(key.substring(2), 16));

  // Seen in chrome 56.0.2924.76 on linux, numpad '.' without numlock returns key "\u0000"
  if (evt.key === "\u0000" && evt.code === "NumpadDecimal")
    key = ".";

  return (
    {
      type: evt.type,
      target: evt.target,
      key: key,
      code: evt.code || "Unidentified",
      ctrlKey: evt.ctrlKey,
      altKey: evt.altKey,
      location: evt.location,
      shiftKey: evt.shiftKey,
      metaKey: evt.metaKey,
      repeat: evt.repeat,
      isComposing: evt.isComposing
    });
}

/**
 * Stop, fully, an event
 *
 * @param event - Event to stop
 */
export function stop(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export class EventListenerSet {
  listeners = new Array<{
    node: HTMLElement;
    type: string;
    listener: EventListener;
    options?: AddEventListenerOptions;
  }>();

  removeAll() {
    for (const listener of this.listeners)
      listener.node.removeEventListener(listener.type, listener.listener, listener.options);

    this.listeners.splice(0); //clear array
  }
  [Symbol.dispose]() {
    this.removeAll();
  }
}

/** Add an event listener to HTMLElements inside a document (which allows us to ensure that 'target' is a HTMLElement for easier typings) */
export function addDocEventListener<CurrentTargetType extends HTMLElement, Type extends keyof HTMLElementEventMap>(node: CurrentTargetType, type: Type, listener: (this: CurrentTargetType, ev: DocEvent<HTMLElementEventMap[Type], CurrentTargetType>) => void, options?: AddDocEventListenerOptions): void;
export function addDocEventListener<CurrentTargetType extends HTMLElement>(node: CurrentTargetType, type: string, listener: (this: CurrentTargetType, evt: DocEvent<Event, CurrentTargetType>) => void, options?: AddDocEventListenerOptions): void;

export function addDocEventListener<CurrentTargetType extends HTMLElement>(node: CurrentTargetType, type: string, listener: (this: CurrentTargetType, evt: DocEvent<Event, CurrentTargetType>) => void, options?: AddDocEventListenerOptions): void {
  node.addEventListener(type, listener as EventListener, options);
  if (options?.listenerSet)
    options.listenerSet.listeners.push({ node, type, listener: listener as EventListener, options });
}
