import { dispatchCustomEvent, stop } from '../src/events';

const HAS_TOUCHEVENT = typeof TouchEvent !== "undefined"; // Desktop Safari doesn't have TouchEvent

type EventCoordinates =
  {
    pageX: number;
    pageY: number;
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
  };
// Store data about the current move
let moveeventdata: { target: EventTarget | null; startX: number; startY: number } | null = null;
let lastcoordinates: EventCoordinates | null = null;

// Fire a move event and return the resulting event
function fireMoveEvent(eventtype: string, listener: EventTarget | null, event: MouseEvent | TouchEvent, cancelable: boolean) {
  //FIXME properly wait for 'last' touch when multitouchmoving ?

  listener = moveeventdata?.target ?? listener;
  const originaltarget = moveeventdata?.target ?? event.target;
  if (!originaltarget)
    return;

  let coordinatesource;
  if ("touches" in event && event.touches.length)
    coordinatesource = event.touches[0];
  else if (event.type === "touchend")
    coordinatesource = lastcoordinates;
  else
    coordinatesource = event as MouseEvent;
  if (!coordinatesource)
    return;

  if (event.type === "touchmove")
    lastcoordinates = cloneCoordinates(coordinatesource);

  const movedX = moveeventdata ? coordinatesource.clientX - moveeventdata.startX : 0;
  const movedY = moveeventdata ? coordinatesource.clientY - moveeventdata.startY : 0;

  const eventdata = {
    movedX: movedX, movedY: movedY,
    pageX: coordinatesource.pageX, pageY: coordinatesource.pageY,
    clientX: coordinatesource.clientX, clientY: coordinatesource.clientY,
    screenX: coordinatesource.screenX, screenY: coordinatesource.screenY,
    listener: listener,
    currentTarget: event.target
  };

  return dispatchCustomEvent(originaltarget, eventtype, { detail: eventdata, cancelable: cancelable, bubbles: true });
}

// Activate the global mouse handlers and store the original event target (the 'movable' element) and start position to
// calculate mouse movement
function startMove(target: EventTarget | null, startX: number, startY: number) {
  moveeventdata = { target, startX, startY };
  window.addEventListener("mousemove", moveMouseMove, true);
  window.addEventListener("mouseup", moveMouseUp, true);
  window.addEventListener("touchmove", moveMouseMove, true);
  window.addEventListener("touchend", moveMouseUp, true);
}

// Deactivate the global mouse handlers and remove stored move data
function stopMove() {
  moveeventdata = null;
  window.removeEventListener("mousemove", moveMouseMove, true);
  window.removeEventListener("mouseup", moveMouseUp, true);
  window.removeEventListener("touchmove", moveMouseMove, true);
  window.removeEventListener("touchend", moveMouseUp, true);
}

function cloneCoordinates(coordinatesource: MouseEvent | Touch | EventCoordinates): EventCoordinates {
  return {
    pageX: coordinatesource.pageX,
    pageY: coordinatesource.pageY,
    clientX: coordinatesource.clientX,
    clientY: coordinatesource.clientY,
    screenX: coordinatesource.screenX,
    screenY: coordinatesource.screenY
  };
}

// Handle a mousedown event on a movable element
function moveMouseDown(event: Event) { // We're a mouse/touch event handler, so we know the event is a MouseEvent or TouchEvent
  if (event instanceof MouseEvent && event.button) //not the main button
    return;

  // Start the move by firing the movestart event
  if (!fireMoveEvent("dompack:movestart", event.target, event as MouseEvent | TouchEvent, true))
    return;

  // Start the move action
  const coordinatesource = HAS_TOUCHEVENT && event instanceof TouchEvent ? event.touches[0] : event as MouseEvent;
  lastcoordinates = cloneCoordinates(coordinatesource);
  startMove(event.target, coordinatesource.clientX, coordinatesource.clientY);

  // Prevent default to prevent selecting text or click
  stop(event);
}

// Handle a (global) mousemove event
function moveMouseMove(event: Event) { // We're a mouse/touch event handler, so we know the event is a MouseEvent or TouchEvent
  // Check if we have data (we should have, but check just in case)
  if (moveeventdata) {
    stop(event);
    // Fire the move event on the original target, use the current event target as relatedTarget
    fireMoveEvent("dompack:move", null, event as MouseEvent | TouchEvent, false);
  }

}

// Handle a (global) mouseup event
function moveMouseUp(event: Event) { // We're a mouse/touch event handler, so we know the event is a MouseEvent or TouchEvent
  // Check if we have data (we should have, but check just in case)
  if (moveeventdata) {
    stop(event);
    fireMoveEvent("dompack:moveend", null, event as MouseEvent | TouchEvent, false);
  }
  // We're done, stop the move action
  stopMove();
}

export function enable(el: EventTarget) {
  el.addEventListener("mousedown", moveMouseDown);
  el.addEventListener("touchstart", moveMouseDown);
}
export function disable(el: EventTarget) {
  el.removeEventListener("mousedown", moveMouseDown);
  el.removeEventListener("touchstart", moveMouseDown);
}

export function cancelMove() {
  if (moveeventdata)
    stopMove();
}
