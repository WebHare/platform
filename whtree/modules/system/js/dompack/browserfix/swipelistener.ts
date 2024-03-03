import * as dompack from "../index";

/** Add swipe event */

const HAS_TOUCHEVENT = typeof TouchEvent !== "undefined"; // Desktop Safari doesn't have TouchEvent

const swipedetect = Symbol("dompack swipedetect");
interface SwipeEventTarget extends EventTarget {
  [key: symbol]: SwipeDetect;
}

type SwipeDetectOptions =
  {
    threshold_distance?: number;
    threshold_speed?: number;
    enablemouseswipe?: boolean;
  };

type SwipePosition = { x: number; y: number };

type SwipeInfo =
  {
    starttime: number;
    endtime: number;
    start: SwipePosition;
    end: SwipePosition;
    target: EventTarget | null;
    direction: string;
  };

type EventHandler = (event: Event) => boolean;

class SwipeDetect {
  options: SwipeDetectOptions;
  swipeinfo: SwipeInfo | null;
  node: EventTarget;
  boundTouchStart: EventHandler;
  boundTouchMove: EventHandler;
  boundTouchEnd: EventHandler;

  constructor(node: EventTarget, options?: SwipeDetectOptions) {
    if (!node)
      throw new Error("Invalid node passed to SwipeDetect");

    this.options = {
      threshold_distance: 15,
      threshold_speed: 0.3,
      enablemouseswipe: true,
      ...options
    };

    this.swipeinfo = null;
    this.node = node;

    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);

    if (this.options.enablemouseswipe) {
      node.addEventListener("mousedown", this.boundTouchStart);
      node.addEventListener("mousemove", this.boundTouchMove);
      node.addEventListener("mouseup", this.boundTouchEnd);
    }
    if (this.touchEnabled()) {
      node.addEventListener("touchstart", this.boundTouchStart);
      node.addEventListener("touchmove", this.boundTouchMove);
      node.addEventListener("touchend", this.boundTouchEnd);
    }
  }

  destroy() {
    if (this.options.enablemouseswipe) {
      this.node.removeEventListener("mousedown", this.boundTouchStart);
      this.node.removeEventListener("mousemove", this.boundTouchMove);
      this.node.removeEventListener("mouseup", this.boundTouchEnd);
    }
    if (this.touchEnabled()) {
      this.node.removeEventListener("touchstart", this.boundTouchStart);
      this.node.removeEventListener("touchmove", this.boundTouchMove);
      this.node.removeEventListener("touchend", this.boundTouchEnd);
    }
  }

  touchEnabled() {
    return ("ontouchstart" in window);
  }

  onTouchStart(ev: Event) {
    let pos: SwipePosition | null = null;
    if (HAS_TOUCHEVENT && ev instanceof TouchEvent)
      pos = { x: ev.touches[0].pageX, y: ev.touches[0].pageY };
    else if (ev instanceof MouseEvent)
      pos = { x: ev.pageX, y: ev.pageY };
    if (!pos)
      return true;
    this.swipeinfo = {
      starttime: Date.now(),
      endtime: -1,
      start: pos,
      end: pos,
      target: ev.target,
      direction: ""
    };
    return true;
  }

  onTouchMove(ev: Event) {
    if (!this.swipeinfo)
      return true;
    if (HAS_TOUCHEVENT && ev instanceof TouchEvent)
      this.swipeinfo.end = { x: ev.touches[0].pageX, y: ev.touches[0].pageY };
    else if (ev instanceof MouseEvent)
      this.swipeinfo.end = { x: ev.pageX, y: ev.pageY };
    return true;
  }

  onTouchEnd() {
    if (!this.swipeinfo)
      return true;

    const dx = this.swipeinfo.end.x - this.swipeinfo.start.x;
    const dy = this.swipeinfo.end.y - this.swipeinfo.start.y;

    this.swipeinfo.endtime = Date.now();

    const abs_x = Math.abs(dx);
    const abs_y = Math.abs(dy);

    if (this.options.threshold_distance && this.options.threshold_speed && abs_x > this.options.threshold_distance && abs_x / (this.swipeinfo.endtime - this.swipeinfo.starttime) > this.options.threshold_speed)
      this.swipeinfo.direction += dx > 0 ? "e" : "w";

    if (this.options.threshold_distance && this.options.threshold_speed && abs_y > this.options.threshold_distance && abs_y / (this.swipeinfo.endtime - this.swipeinfo.starttime) > this.options.threshold_speed)
      this.swipeinfo.direction += dy > 0 ? "s" : "n";

    if (this.swipeinfo.direction !== "") {
      dompack.dispatchCustomEvent(this.node, "dompack:swipe", {
        bubbles: true,
        cancelable: true,
        detail: this.swipeinfo
      });

    }

    this.swipeinfo = null;
    return true;
  }

}

export function enable(element: SwipeEventTarget, options?: SwipeDetectOptions) {
  if (element[swipedetect])
    return;

  element[swipedetect] = new SwipeDetect(element, options);
}

export function disable(element: SwipeEventTarget) {
  if (!element[swipedetect])
    return;

  element[swipedetect].destroy();
  delete element[swipedetect];
}
