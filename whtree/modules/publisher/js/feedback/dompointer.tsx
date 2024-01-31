import * as dompack from "@webhare/dompack";
import { createDeferred, DeferredPromise } from "@webhare/std";
import type { PointOptions, PointResult, HighlightCallback } from "./index";

let deferred: DeferredPromise<PointResult | null> | null, highlighter: HTMLElement, highlightCallback: HighlightCallback | null;

export function pointAtDOM(event?: MouseEvent, options?: PointOptions): Promise<PointResult | null> {
  if (deferred)
    return Promise.reject(new Error("Already pointing at DOM"));

  highlightCallback = options?.highlightCallback || null;

  deferred = createDeferred();
  if (!highlighter)
    highlighter = <div class="wh-feedback__dompointer"></div>;

  activateDOMPointer();

  if (event)
    highlightDOM(event);

  return deferred.promise;
}

function activateDOMPointer() {
  window.addEventListener("mousemove", highlightDOM, true);
  window.addEventListener("click", captureDOMNode, true);
  window.addEventListener("keydown", maybeCancelDOMPointer, true);
  document.documentElement.classList.add("wh-feedback--dompointer");
}

function deactivateDOMPointer() {
  window.removeEventListener("mousemove", highlightDOM, true);
  window.removeEventListener("click", captureDOMNode, true);
  window.removeEventListener("keydown", maybeCancelDOMPointer, true);
  document.documentElement.classList.remove("wh-feedback--dompointer");
}

function resolveWithResult(result: PointResult | null) {
  if (!deferred)
    return;
  deactivateDOMPointer();
  const resolve = deferred.resolve;
  deferred = null;
  document.body.removeChild(highlighter);
  resolve(result);
}

function maybeCancelDOMPointer(event: KeyboardEvent) {
  dompack.stop(event);

  if (event.code === "Escape" && deferred)
    resolveWithResult(null);
}

function highlightDOM(event: MouseEvent) {
  const hoverNode = getHoveredDOMNode(event);
  if (hoverNode) {
    const rect = hoverNode.getBoundingClientRect();
    highlighter.style.top = rect.top + "px";
    highlighter.style.left = rect.left + "px";
    highlighter.style.width = rect.width + "px";
    highlighter.style.height = rect.height + "px";
    document.body.appendChild(highlighter);
  } else {
    highlighter.remove();
  }
}

function captureDOMNode(event: MouseEvent) {
  dompack.stop(event);

  if (deferred) {
    const hoverNode = getHoveredDOMNode(event);
    if (!hoverNode)
      resolveWithResult(null);
    else {
      const rect = hoverNode.getBoundingClientRect();
      resolveWithResult({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, scale: window.devicePixelRatio });
    }
  }
}

function getHoveredDOMNode(event: MouseEvent) {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  return el && highlightCallback ? highlightCallback(el) : el;
}
