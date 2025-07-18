import * as dompack from "@webhare/dompack";
import type EditorBase from "./editorbase";

export function handleCopyEvent(editor: EditorBase, evt: ClipboardEvent) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !evt.clipboardData)
    return; //we'll have to let the browser try to handle it

  dompack.stop(evt);

  const range = selection.getRangeAt(0);
  const clonedContent = range.cloneContents();
  const div = document.createElement('div');
  div.appendChild(clonedContent);

  const html = div.innerHTML;

  // Optional: override clipboard content
  evt.clipboardData!.setData('text/html', html);
  evt.clipboardData!.setData('text/plain', selection.toString());
}
