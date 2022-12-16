import { Properties } from "@mod-system/js/types";
import * as browser from "@mod-system/js/dompack/extra/browser";
import { DOMFilterCallback, ScreenshotData } from "./index";

const SCREENSHOTVERSION = 2;

/**
 Take a DOM snapshot
 *
 * @param domFilterCallback - Filter DOM node during clone
 * @param postFilterCallback - Post process the screenshot documentFragment
 */
export default function takeScreenshot(domFilterCallback?: DOMFilterCallback,
  postFilterCallback?: (node: DocumentFragment) => void): ScreenshotData {
  const bodyFragment = document.createDocumentFragment();
  cloneNodeContents(document.body, bodyFragment, domFilterCallback);
  if (postFilterCallback)
    postFilterCallback(bodyFragment);
  const bodyNode = document.createElement("div");
  bodyNode.append(bodyFragment);

  const htmlAttrs: Properties = Array.from(document.documentElement.attributes).map(attr => { return { name: attr.name, value: attr.value }; });
  const styleSheets = Array.from(document.styleSheets).map(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText).join(""));
  const bodyAttrs: Properties = Array.from(document.body.attributes).map(attr => { return { name: attr.name, value: attr.value }; });

  // Save the document's and body's scroll positions
  if (document.documentElement.scrollTop)
    htmlAttrs.push({ name: "data-wh-screenshot-scroll-top", value: document.documentElement.scrollTop.toString() });
  if (document.documentElement.scrollLeft)
    htmlAttrs.push({ name: "data-wh-screenshot-scroll-left", value: document.documentElement.scrollLeft.toString() });
  if (document.body.scrollTop)
    bodyAttrs.push({ name: "data-wh-screenshot-scroll-top", value: document.body.scrollTop.toString() });
  if (document.body.scrollLeft)
    bodyAttrs.push({ name: "data-wh-screenshot-scroll-left", value: document.body.scrollLeft.toString() });

  return (
    {
      version: SCREENSHOTVERSION,
      screenshot:
      {
        htmlAttrs,
        styleSheets,
        bodyAttrs,
        bodyContents: bodyNode.innerHTML
      },
      size: { width: window.innerWidth, height: window.innerHeight },
      browser: browser.getTriplet(),
      device: browser.getDevice(),
      userAgent: window.navigator.userAgent,
      url: location.href
    }
  );
}

function filterNode(node: Node, domFilterCallback?: DOMFilterCallback): boolean {
  if (node instanceof HTMLElement && node.dataset.whScreenshotSkip || node.nodeName == "WH-AUTHORBAR")
    return false;
  return !domFilterCallback || !(node instanceof Element) || domFilterCallback(node) != null;
}

function cloneNodeContents(source: Node, target: DocumentFragment | Element, domFilterCallback?: DOMFilterCallback): void {
  if (!source.childNodes.length)
    return;

  target.append(...[...source.childNodes].filter(_ => filterNode(_, domFilterCallback)).map(childNode => {
    const childClone = childNode.cloneNode(false);
    if (childClone instanceof Element) {
      if (childClone.nodeName === "IFRAME") {
        childClone.removeAttribute("src");
        childClone.setAttribute("sandbox", "");
      }
      if (childNode instanceof Element && childClone instanceof HTMLElement) {
        if (childNode.scrollTop)
          childClone.dataset.whScreenshotScrollTop = childNode.scrollTop.toString();
        if (childNode.scrollLeft)
          childClone.dataset.whScreenshotScrollLeft = childNode.scrollLeft.toString();
      }

      cloneNodeContents(childNode, childClone, domFilterCallback);
    }
    return childClone;
  }));
}
