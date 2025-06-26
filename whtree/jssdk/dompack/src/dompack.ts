// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/dompack" {
}

/* This is our public api */
export { flagUIBusy, setupBusyModal } from './busy';
export type { UIBusyLock, BusyModalEvent } from './busy';
export { dispatchCustomEvent, dispatchDomEvent, fireModifiedEvents, changeValue, stop, addDocEventListener } from '../../../modules/system/js/dompack/src/events';
export type { DocEvent, DomEventOptions } from '../../../modules/system/js/dompack/src/events';
export { qS, qR, qSA, isFormControl, isElement, isHTMLElement, getRelativeBounds } from './tree';
export type { FormControlElement, Rect } from './tree';
export { isDomReady, onDomReady } from '../../../modules/system/js/dompack/src/tree';
export { create, jsxcreate, jsxfragment } from '../../../modules/system/js/dompack/src/create';
export { focus, register, registerMissed } from '../../../modules/system/js/dompack/src/components';
export type { TakeFocusEvent } from '../../../modules/system/js/dompack/src/components';
export { getLocal, setLocal, getSession, setSession, listCookies, getCookie, setCookie, deleteCookie } from './storage';
export { loadImage, loadScript, loadCSS } from "./preload";
export { browser, getBrowser, isMultiSelectKey, isCopyKey } from './browser';
export type { KeyAttributeValue, UserAgentInfo, Platform, Device } from './browser';

/** @deprecated As 'Lock' conflicts, in WH5.4+ you can safely switch to UIBusyLock */
import type { UIBusyLock } from './busy';
export type Lock = UIBusyLock;
