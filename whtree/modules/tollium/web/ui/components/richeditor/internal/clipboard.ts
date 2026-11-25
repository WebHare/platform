import { testType } from "./domlevel";
import type EditorBase from "./editorbase";

/** Copies the current selection to the clipboard. The selection calculated synchronously with the call
 * to this function.
 */
export async function copySelectionToClipboard(editor: EditorBase, evt?: ClipboardEvent): Promise<void> {
  const selection = window.getSelection();

  const clipboardItemData = {
    "text/html": "",
    "text/plain": "",
  };

  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    let clonedContent: DocumentFragment | Node = range.cloneContents();

    // Also clone all style parents
    for (let node: Node | null = range.commonAncestorContainer; node && node !== editor.getBody(); node = node.parentNode) {
      if (testType(node, Node.TEXT_NODE) || testType(node, Node.CDATA_SECTION_NODE))
        continue;
      if (!testType(node, Node.ELEMENT_NODE) || !["a", "b", "i", "u", "strike", "sub", "sup"].includes(node.nodeName.toLowerCase()))
        break;
      const newNode = node.cloneNode(false);
      newNode.appendChild(clonedContent);
      clonedContent = newNode;
    }

    const div = document.createElement('div');
    div.appendChild(clonedContent);

    clipboardItemData["text/html"] = div.innerHTML;
    clipboardItemData["text/plain"] = selection.toString();
  }

  if (evt) {
    evt.clipboardData?.setData("text/html", clipboardItemData["text/html"]);
    evt.clipboardData?.setData("text/plain", clipboardItemData["text/plain"]);
  } else {
    await navigator.clipboard.write([new ClipboardItem(clipboardItemData)]);
  }
}
