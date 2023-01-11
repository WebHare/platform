/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import { RTE } from "./editor.es";
import "./styling.es";

export function createRTE(parentnode, options) {
  if (dompack.debugflags.nextrte && window.__NextRTE)
    return window.__NextRTE(parentnode, options);
  return new RTE(parentnode, options);
}

export function preloadCSS(urls) {
  if (dompack.debugflags.nextrte && window.__NextRTEPreloadCSS)
    return window.__NextRTEPreloadCSS(urls);
  return new RTE.preloadCSS(urls);
}
