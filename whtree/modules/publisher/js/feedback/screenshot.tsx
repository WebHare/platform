import * as dompack from '@webhare/dompack';
import type * as html2canvas from "html2canvas";
import { pointAtDOM } from '@mod-publisher/js/feedback/dompointer';
import type { FeedbackOptions, PointResult, PreparedFeedback } from "./index";

function filterElements(node: Element, feedbackOptions?: FeedbackOptions): boolean {
  if (node instanceof HTMLElement && (node.dataset.whScreenshot === "skip" || "whScreenshotSkip" in node.dataset || node.nodeName == "WH-AUTHORBAR")) {
    return false;
  }
  return feedbackOptions?.domFilterCallback === undefined || !(node instanceof Element) || feedbackOptions.domFilterCallback(node);
}

async function onclone(element: HTMLElement, feedbackOptions?: FeedbackOptions) {
  if (feedbackOptions?.postFilterCallback)
    feedbackOptions.postFilterCallback(element);
  await postFilterElementRecursive(element, feedbackOptions);
}

async function postFilterElementRecursive(element: HTMLElement, feedbackOptions?: FeedbackOptions) {
  // Mask the value of elements with data-wh-screenshot set to "maskvalue
  if (element.dataset.whScreenshot === "maskvalue" && element instanceof HTMLInputElement)
    element.type = "password";

  // Rewrite svg background images (which taint the canvas) to png data urls, if the element has at least one SVG background image
  const backgroundImage = getComputedStyle(element).backgroundImage;
  if (backgroundImage.match(/url\(.*\.svg['"]?\)/g)) {
    const images = backgroundImage.split(",").map(_ => _.trim());
    for await (const [idx, image] of images.entries()) {
      // If this is an SVG image, rewrite it to a PNG data url
      if (image.match(/url\(".*svg"\)/)) {
        let pngurl = "";
        try {
          const result = await fetch(`/.publisher/fbresource/convert?token=${feedbackOptions?.token || ""}`, {
            method: "POST",
            body: JSON.stringify({ url: image.substring(5, image.length - 2) })
          });
          if (result.ok) {
            pngurl = await result.text();
          }
        } catch (e) {
          console.error(e);
        }
        images[idx] = pngurl ? `url("${pngurl}")` : "none"; // Clear the image on error
      }
    }
    element.style.backgroundImage = images.join(" ");
  }

  for (const childElement of element.children)
    if (childElement instanceof HTMLElement)
      await postFilterElementRecursive(childElement, feedbackOptions);
}

let html2canvasPromise: Promise<typeof html2canvas> | undefined;

async function getCanvasWithScreenshot(feedbackOptions?: FeedbackOptions): Promise<HTMLCanvasElement> {

  /* html-to-image - also expiremnted with..
  import { toPng } from "html-to-image";

  image = await toPng(document.body, {
    preferredFontFormat: "woff2"
    filter: (element: Element) => filterElements(element, feedbackOptions?.domFilterCallback)
  });
  */

  const rect = document.body.getBoundingClientRect();
  const options: Partial<html2canvas.Options> = {
    width: window.innerWidth,
    height: window.innerHeight,
    x: -rect.x,
    y: -rect.y,
    ignoreElements: element => !filterElements(element, feedbackOptions),
    onclone: async (_document, element) => await onclone(element, feedbackOptions)
  };

  if (!html2canvasPromise)
    html2canvasPromise = import("html2canvas") as Promise<typeof html2canvas>;

  return await (await html2canvasPromise).default(document.body, options);
}

export async function prepareFeedback(feedbackOptions?: FeedbackOptions): Promise<PreparedFeedback> {
  let pointresult: PointResult | null = null;
  if (feedbackOptions?.addElement)
    pointresult = await pointAtDOM(feedbackOptions?.initialMouseEvent);

  const screenshot = await getCanvasWithScreenshot({
    token: feedbackOptions?.token
  }); //TODO get dom filtering options from setAuthorMode ?

  return {
    browser: dompack.browser.triplet,
    device: dompack.browser.device,
    userAgent: window.navigator.userAgent,
    url: location.href,
    token: feedbackOptions?.token,
    image: screenshot.toDataURL(),
    element: pointresult,
  };
}
