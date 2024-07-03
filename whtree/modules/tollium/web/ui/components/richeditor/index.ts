//@ts-ignore migrating
import StructuredEditor from './internal/structurededitor';
//@ts-ignore migrating
import FreeEditor from './internal/free-editor';
import "./styling";
import './richeditor.scss';
import './internal/buttons.scss';
import './internal/widgets.scss';
import type { EditorBaseOptions } from './internal/editorbase';

export { preloadCSS } from "./internal/styleloader";
export { getTargetInfo } from "./internal/support";

export function createRTE(parentnode: HTMLElement, options: Partial<EditorBaseOptions>) {
  if (!options.structure)
    return new FreeEditor(parentnode, options);
  else
    return new StructuredEditor(parentnode, options);
}
