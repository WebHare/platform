//@ts-ignore migrating
import StructuredEditor from './internal/structurededitor';
//@ts-ignore migrating
import FreeEditor from './internal/free-editor';
import { RTESettings } from "./internal/types";
import "./styling";
import './richeditor.scss';
import './internal/buttons.scss';
import './internal/widgets.scss';

export { preloadCSS } from "./internal/styleloader";
export { getTargetInfo } from "./internal/support";

export function createRTE(parentnode: HTMLElement, options: RTESettings) {
  if (!options.structure)
    return new FreeEditor(parentnode, options);
  else
    return new StructuredEditor(parentnode, options);
}
