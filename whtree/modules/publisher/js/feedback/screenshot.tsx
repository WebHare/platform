import * as browser from "dompack/extra/browser";
import { ScreenshotData } from "./index";

const SCREENSHOTVERSION = 2;

/** Take a DOM snapshot
*/
export default function takeScreenshot(domFilterCallback: (node: Node) => boolean,
                                       postFilterCallback: (node: DocumentFragment) => void): ScreenshotData
{
  const bodyFragment = document.createDocumentFragment();
  cloneNodeContents(document.body, bodyFragment, domFilterCallback);
  if (postFilterCallback)
    postFilterCallback(bodyFragment);
  const bodyNode = document.createElement("div");
  bodyNode.append(bodyFragment);

  const styleSheets = [ ...document.styleSheets ].map(sheet => [ ...sheet.cssRules ].map(rule => rule.cssText).join(""));
  const htmlAttrs = [ ...document.documentElement.attributes ].map(attr => { return { name: attr.name, value: attr.value }; });
  const bodyAttrs = [ ...document.body.attributes ].map(attr => { return { name: attr.name, value: attr.value }; });

  return (
    { version: SCREENSHOTVERSION
    , screenshot:
      { htmlAttrs
      , styleSheets
      , bodyAttrs
      , bodyContents: bodyNode.innerHTML
      }
    , size: { width: window.innerWidth, height: window.innerHeight }
    , browser: browser.getTriplet()
    , device: browser.getDevice()
    , userAgent: window.navigator.userAgent
    , url: location.href
    }
  );
}

function cloneNodeContents(source: Node, target: DocumentFragment | Element, domFilterCallback: (node: Node) => boolean): void
{
  if (!source.childNodes.length)
    return;
  target.append(...[ ...source.childNodes ].map(childNode =>
  {
    if (!domFilterCallback || domFilterCallback(childNode))
    {
      const childClone = childNode.cloneNode(false);
      if (childClone instanceof Element)
      {
        if (childClone.nodeName === "IFRAME")
        {
          childClone.removeAttribute("src");
          childClone.setAttribute("sandbox", "");
        }
        if (childNode instanceof Element && childClone instanceof HTMLElement)
        {
          if (childNode.scrollTop)
            childClone.dataset.whScreenshotScrollTop = childNode.scrollTop.toString();
          if (childNode.scrollLeft)
            childClone.dataset.whScreenshotScrollLeft = childNode.scrollLeft.toString();
        }

        cloneNodeContents(childNode, childClone, domFilterCallback);
      }
      return childClone;
    }
  }).filter(_ => !!_));
}
