import { dispatchCustomEvent, stop } from '../src/events.es';

// Store data about the current move
let moveeventdata = null;
let lastcoordinates = null;

// Fire a move event and return the resulting event
function fireMoveEvent(eventtype, listener, event, cancelable)
{
  //FIXME properly wait for 'last' touch when multitouchmoving ?

  listener = moveeventdata ? moveeventdata.listener : listener;
  let originaltarget = moveeventdata ? moveeventdata.target : event.target;
  let coordinatesource = event.type == "touchmove" ? event.touches[0] : event.type == "touchend" ? lastcoordinates : event;
  if(event.type == "touchmove")
    lastcoordinates = cloneCoordinates(coordinatesource);

  let movedX = moveeventdata ? coordinatesource.clientX - moveeventdata.startX : 0;
  let movedY = moveeventdata ? coordinatesource.clientY - moveeventdata.startY : 0;

  let eventdata = { movedX: movedX, movedY: movedY
                  , pageX: coordinatesource.pageX, pageY: coordinatesource.pageY
                  , clientX: coordinatesource.clientX, clientY: coordinatesource.clientY
                  , screenX: coordinatesource.screenX, screenY: coordinatesource.screenY
                  , listener: listener
                  , currentTarget: event.target
                  };

  return dispatchCustomEvent(originaltarget, eventtype, { detail: eventdata, cancelable: cancelable, bubbles: true });
}

// Activate the global mouse handlers and store the original event target (the 'movable' element) and start position to
// calculate mouse movement
function startMove(listener, target, startX, startY)
{
  moveeventdata = { listener, target, startX, startY };
  window.addEventListener("mousemove", moveMouseMove, true);
  window.addEventListener("mouseup", moveMouseUp, true);
  window.addEventListener("touchmove", moveMouseMove, true);
  window.addEventListener("touchend", moveMouseUp, true);
}

// Deactivate the global mouse handlers and remove stored move data
function stopMove()
{
  moveeventdata = null;
  window.removeEventListener("mousemove", moveMouseMove, true);
  window.removeEventListener("mouseup", moveMouseUp, true);
  window.removeEventListener("touchmove", moveMouseMove, true);
  window.removeEventListener("touchend", moveMouseUp, true);
}

function cloneCoordinates(coordinatesource)
{
  return { pageX: coordinatesource.pageX
         , pageY: coordinatesource.pageY
         , clientX: coordinatesource.clientX
         , clientY: coordinatesource.clientY
         , screenX: coordinatesource.screenX
         , screenY: coordinatesource.screenY
         };
}

// Handle a mousedown event on a movable element
function moveMouseDown(event)
{
  if (event.button) //not the main button
    return;

  // Start the move by firing the movestart event
  if(!fireMoveEvent("dompack:movestart", this, event, true))
    return;

  // Start the move action
  let coordinatesource = event.touches ? event.touches[0] : event;
  lastcoordinates = cloneCoordinates(coordinatesource);
  startMove(this, event.target, coordinatesource.clientX, coordinatesource.clientY);

  // Prevent default to prevent selecting text or click
  stop(event);
}

// Handle a (global) mousemove event
function moveMouseMove(event)
{
  // Check if we have data (we should have, but check just in case)
  if (moveeventdata)
  {
    stop(event);
    // Fire the move event on the original target, use the current event target as relatedTarget
    fireMoveEvent("dompack:move", null, event, false);
  }

}

// Handle a (global) mouseup event
function moveMouseUp(event)
{
  // Check if we have data (we should have, but check just in case)
  if (moveeventdata)
  {
    stop(event);
    fireMoveEvent("dompack:moveend", null, event, false);
  }
  // We're done, stop the move action
  stopMove();
}

export function enable(el)
{
  el.addEventListener("mousedown", moveMouseDown);
  el.addEventListener("touchstart", moveMouseDown);
}
export function disable(el)
{
  el.removeEventListener("mousedown", moveMouseDown);
  el.removeEventListener("touchstart", moveMouseDown);
}

export function cancelMove()
{
  if (moveeventdata)
    stopMove();
}
