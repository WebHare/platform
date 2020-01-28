import * as dompack from "dompack";
import * as browser from "dompack/extra/browser";

const screenshotVersion = 1;

/** Take a DOM snapshot
*/
export default function takeScreenshot(domFilterCallback)
{
  let bodyNode = document.createElement("div");
  cloneNodeContents(document.body, bodyNode, domFilterCallback);

  const styleSheets = [ ...document.styleSheets ].map(sheet => [ ...sheet.cssRules ].map(rule =>
  {
    // In IE11, the cssText of a keyframe(s) rule cannot be accessed
    if (rule.type != CSSRule.KEYFRAME_RULE && rule.type != CSSRule.KEYFRAMES_RULE)
      return rule.cssText;
    return "";
  }).join(''));
  const htmlAttrs = [ ...document.documentElement.attributes ].map(attr => { return { name: attr.name, value: attr.value }; });
  const bodyAttrs = [ ...document.body.attributes ].map(attr => { return { name: attr.name, value: attr.value }; });
  const size = document.body.getBoundingClientRect();

  return (
    { version: screenshotVersion
    , screenshot:
      { htmlAttrs
      , styleSheets
      , bodyAttrs
      , bodyContents: bodyNode.innerHTML
      }
    , size: { width: size.width, height: size.height }
    , browser: browser.getTriplet()
    , device: browser.getDevice()
    , userAgent: window.navigator.userAgent
    }
  );
}

function cloneNodeContents(source, target, domFilterCallback)
{
  for (const childNode of Array.from(source.childNodes))
  {
    if (isNodeVisible(childNode))
    {
      if (!domFilterCallback || domFilterCallback(childNode))
      {
        let childClone = childNode.cloneNode(false);
        if (childClone.nodeType === Node.ELEMENT_NODE && childClone.nodeName === "IFRAME")
        {
          childClone.removeAttribute("src");
          childClone.setAttribute("sandbox", "");
        }
        if (childNode.scrollTop)
          childClone.dataset.whScreenshotScrollTop = childNode.scrollTop;
        if (childNode.scrollLeft)
          childClone.dataset.whScreenshotScrollLeft = childNode.scrollLeft;

        cloneNodeContents(childNode, childClone);
        dompack.append(target, childClone);
      }
    }
  }
}

function isNodeVisible(node)
{
  if (!node.getBoundingClientRect)
    return true;
  const rect = node.getBoundingClientRect();
  return rect.width && rect.height
      && rect.right >= 0 && rect.bottom >= 0
      && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
}
