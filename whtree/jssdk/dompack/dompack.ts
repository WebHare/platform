/* This is our public api */
export { flagUIBusy, setupBusyModal } from './impl/busy';
export type { UIBusyLock, BusyModalEvent } from './impl/busy';
export { dispatchCustomEvent, dispatchDomEvent, fireModifiedEvents, changeValue, stop, addDocEventListener, EventListenerSet } from '../../modules/system/js/dompack/src/events';
export type { AddDocEventListenerOptions, DocEvent, DomEventOptions } from '../../modules/system/js/dompack/src/events';
export { qS, qR, qSA, isFormControl } from './impl/tree';
export type { FormControlElement } from './impl/tree';
export { isDomReady, onDomReady } from '../../modules/system/js/dompack/src/tree';
export { create, jsxcreate, jsxfragment } from '../../modules/system/js/dompack/src/create';
export { focus, register, registerMissed } from '../../modules/system/js/dompack/src/components';
export type { TakeFocusEvent } from '../../modules/system/js/dompack/src/components';
export { getLocal, setLocal, getSession, setSession, isIsolated as isStorageIsolated, isStorageAvailable } from '../../modules/system/js/dompack/extra/storage';
export { list as listCookies, read as getCookie, write as setCookie, remove as deleteCookie } from '../../modules/system/js/dompack/extra/cookie';
export { loadImage, loadScript, loadCSS, loadAssetPack } from "./impl/preload";
export { browser } from './impl/browser';

/** @deprecated As 'Lock' conflicts, in WH5.4+ you can safely switch to UIBusyLock */
import { type UIBusyLock } from './impl/busy';
export type Lock = UIBusyLock;
