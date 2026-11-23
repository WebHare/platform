import { testType } from "./domlevel";
import type EditorBase from "./editorbase";

/** Attribute recording the original href of a fragment-only link (eg `#section`) in copied HTML */
const fragmentHrefAttr = "data-wh-href";

/* Chromium resolves relative hrefs in pasted HTML against the URL of the document it was copied from before our paste
   handler sees it, turning a `#section` link into `https://<backend>/#section`. Record the original href when
   copying so we can restore it on paste */
function markFragmentLinks(container: Element) {
  for (const link of container.querySelectorAll("a[href^='#']"))
    link.setAttribute(fragmentHrefAttr, link.getAttribute("href")!);
}

/** Restore fragment-only links marked by markFragmentLinks in pasted HTML, and remove the markers */
export function restoreFragmentLinks(container: Element) {
  for (const link of container.querySelectorAll(`a[${fragmentHrefAttr}]`)) {
    const fragment = link.getAttribute(fragmentHrefAttr)!;
    link.removeAttribute(fragmentHrefAttr);
    if (!fragment.startsWith("#"))
      continue;

    //only undo the resolving of the href, don't let the marker change where a link points to. resolving may have percent-encoded the fragment
    const href = link.getAttribute("href") ?? "";
    if (href.endsWith(fragment) || href.endsWith(new URL(fragment, "https://example.invalid/").hash))
      link.setAttribute("href", fragment);
  }
}

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
    markFragmentLinks(div);

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
