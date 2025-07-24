import type EditorBase from "./editorbase";

/** Copies the current selection to the clipboard. The selection calculated synchronously with the call
 * to this function.
 */
export async function copySelectionToClipboard(editor: EditorBase) {
  const selection = window.getSelection();

  const clipboardItemData = {
    "text/html": "",
    "text/plain": "",
  };

  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    const clonedContent = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(clonedContent);

    clipboardItemData["text/html"] = div.innerHTML;
    clipboardItemData["text/plain"] = selection.toString();
  }

  await navigator.clipboard.write([new ClipboardItem(clipboardItemData)]);
}
