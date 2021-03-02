import * as dompack from "../src/index.es";

/** Add swipe event */

const swipedetect = Symbol();

class SwipeDetect
{
  constructor(node, options)
  {
    if(!node)
      throw new Error("Invalid node passed to SwipeDetect");

    this.options = { threshold_distance: 15
                   , threshold_speed: 0.3
                   , enablemouseswipe: true
                   , ...options
                   };

    this.swipeinfo = null;
    this.node = node;

    this.boundTouchStart = this.onTouchStart.bind(this);
    this.boundTouchMove = this.onTouchMove.bind(this);
    this.boundTouchEnd = this.onTouchEnd.bind(this);

    if(this.options.enablemouseswipe)
    {
      node.addEventListener("mousedown", this.boundTouchStart);
      node.addEventListener("mousemove", this.boundTouchMove);
      node.addEventListener("mouseup",   this.boundTouchEnd);
    }
    if(this.touchEnabled())
    {
      node.addEventListener("touchstart", this.boundTouchStart);
      node.addEventListener("touchmove",  this.boundTouchMove);
      node.addEventListener("touchend",   this.boundTouchEnd);
    }
  }

  destroy()
  {
    if(this.options.enablemouseswipe)
    {
      this.node.removeEventListener("mousedown", this.boundTouchStart);
      this.node.removeEventListener("mousemove", this.boundTouchMove);
      this.node.removeEventListener("mouseup",   this.boundTouchEnd);
    }
    if(this.touchEnabled())
    {
      this.node.removeEventListener("touchstart", this.boundTouchStart);
      this.node.removeEventListener("touchmove",  this.boundTouchMove);
      this.node.removeEventListener("touchend",   this.boundTouchEnd);
    }
  }

  touchEnabled()
  {
    return ("createTouch" in document);
  }

  onTouchStart(ev)
  {
    this.swipeinfo = { starttime : new Date().getTime()
                     , endtime   : -1
                     , start     : { x : ev.pageX, y : ev.pageY }
                     , end       : { x : ev.pageX, y : ev.pageY }
                     , target    : ev.target
                     , direction : ""
                     };
  }

  onTouchMove(ev)
  {
    if(!this.swipeinfo)
      return;
    this.swipeinfo.end = { x : ev.pageX, y : ev.pageY };
  }

  onTouchEnd(ev)
  {
    if(!this.swipeinfo)
      return;

    let dx = this.swipeinfo.end.x - this.swipeinfo.start.x;
    let dy = this.swipeinfo.end.y - this.swipeinfo.start.y;

    this.swipeinfo.endtime = new Date().getTime();

    let abs_x = Math.abs(dx);
    let abs_y = Math.abs(dy);

    if(abs_x > this.options.threshold_distance && abs_x / (this.swipeinfo.endtime - this.swipeinfo.starttime) > this.options.threshold_speed)
      this.swipeinfo.direction += dx > 0 ? "e" : "w";

    if(abs_y > this.options.threshold_distance && abs_y / (this.swipeinfo.endtime - this.swipeinfo.starttime) > this.options.threshold_speed)
      this.swipeinfo.direction += dy > 0 ? "s" : "n";

    if(this.swipeinfo.direction != "")
    {
      dompack.dispatchCustomEvent(this.node, "dompack:swipe", { bubbles: true
                                                              , cancelable: true
                                                              , detail: this.swipeinfo
                                                              });

    }

    this.swipeinfo = null;
  }

}

export function enable(element, options)
{
  if (element[swipedetect])
    return;

  element[swipedetect] = new SwipeDetect(element, options);
}

export function disable(element)
{
  if (!element[swipedetect])
    return;

  element[swipedetect].destroy();
  delete element[swipedetect];
}
