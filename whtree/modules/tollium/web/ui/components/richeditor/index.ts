/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import { RTE } from "./editor";
import { RTESettings } from "./internal/types";
import "./styling";
import './richeditor.scss';
import './internal/buttons.scss';
import './internal/widgets.scss';

export { preloadCSS } from "./internal/styleloader";
export { getTargetInfo } from "./internal/support";

export function createRTE(parentnode: HTMLElement, options: RTESettings) {
  return new RTE(parentnode, options);
}
