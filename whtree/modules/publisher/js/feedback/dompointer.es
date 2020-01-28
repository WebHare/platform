import * as dompack from "dompack";

let deferred, highlighter, highlightCallback;

export default function pointAtDOM(event, options)
{
  if (deferred)
    return Promise.reject(new Error("Already pointing at DOM"));

  highlightCallback = options.highlightCallback;

  deferred = dompack.createDeferred();
  if (!highlighter)
    highlighter = <div class="feedback__dompointer"></div>;

  activateDOMPointer();

  if (event)
    highlightDOM(event);

  return deferred.promise;
}

function activateDOMPointer()
{
  window.addEventListener("mousemove", highlightDOM, true);
  window.addEventListener("click", captureDOMNode, true);
  window.addEventListener("keydown", maybeCancelDOMPointer, true);
}

function deactivateDOMPointer()
{
  window.removeEventListener("mousemove", highlightDOM, true);
  window.removeEventListener("click", captureDOMNode, true);
  window.removeEventListener("keydown", maybeCancelDOMPointer, true);
}

function resolveWithResult(result)
{
  deactivateDOMPointer();
  const resolve = deferred.resolve;
  deferred = null;
  document.body.removeChild(highlighter);
  resolve(result);
}

function maybeCancelDOMPointer(event)
{
  dompack.stop(event);

  if (event.which === 27 && deferred)
    resolveWithResult();
}

function highlightDOM(event)
{
  const hoverNode = getHoveredDOMNode(event);
  if (hoverNode) {
    const rect = hoverNode.getBoundingClientRect();
    highlighter.style.top = rect.top + "px";
    highlighter.style.left = rect.left + "px";
    highlighter.style.width = rect.width + "px";
    highlighter.style.height = rect.height + "px";
    document.body.appendChild(highlighter);
  } else
    document.body.removeChild(highlighter);
}

function captureDOMNode(event)
{
  dompack.stop(event);

  if (deferred) {
    const hoverNode = getHoveredDOMNode(event);
    if (!hoverNode)
      resolveWithResult();
    else {
      const rect = hoverNode.getBoundingClientRect();
      resolveWithResult({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    }
  }
}

function getHoveredDOMNode(event)
{
  const el = document.elementFromPoint(event.clientX, event.clientY);
  return highlightCallback ? highlightCallback(el) : el;
}
