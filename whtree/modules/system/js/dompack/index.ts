/* This is our public api. Any direct inclusions from src/.... not mentioned here are not a stable API
*/

export { createDeferred } from '@webhare/std';
export { flagUIBusy } from '@webhare/dompack';
export {
  dispatchCustomEvent, dispatchDomEvent, fireModifiedEvents, changeValue, normalizeKeyboardEventData,
  stop
} from './src/events';
export {
  qS, qSA, contains, closest, matches,
  empty, isDomReady, onDomReady, getJSONAttribute,
  before, after, replaceWith, remove, prepend, append,
  toggleClass, toggleClasses,
  setStyles,
  getBaseURI, getRelativeBounds,
  isElement, isHTMLElement
} from './src/tree';
export type { Rect } from './src/tree';
export { create, jsxcreate, jsxfragment } from './src/create';
export { focus, register, registerMissed, scrollIntoView } from './src/components';
export type { TakeFocusEvent } from './src/components';

import { debugFlags } from "@webhare/env";

/** @deprecated You should use debugFlags from \@webhare/env */
export const debugflags = debugFlags;
