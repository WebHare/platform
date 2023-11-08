/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from "dompack";
import Keyboard from 'dompack/extra/keyboard';
import * as movable from 'dompack/browserfix/movable';

export class OverlayManager {
  constructor(container, classname, options) {
    if (!container)
      throw new Error("No container specified");
    if (!classname)
      throw new Error("No className specified");

    this.options = { bounds: null, autoselectdrawnoverlays: true, ...options };

    this.holder = container;
    this.classname = classname;
    this.overlays = [];
    this.dragcreateinfo = null;

    this._boundDragStart = this._onDragStart.bind(this);
    this._boundDragMove = this._onDragMove.bind(this);
    this._boundDragEnd = this._onDragEnd.bind(this);

    container.addEventListener("dompack:movestart", this._boundDragStart);
    container.addEventListener("dompack:move", this._boundDragMove);
    container.addEventListener("dompack:moveend", this._boundDragEnd);

    new Keyboard(container,
      {
        "Escape": (e) => this._onDragCancel(e)
      });

    movable.enable(container);
  }

  destroy() {
    this.holder.removeEventListener("dompack:movestart", this._boundDragStart);
    this.holder.removeEventListener("dompack:move", this._boundDragMove);
    this.holder.removeEventListener("dompack:moveend", this._boundDragEnd);

    // FIXME: it isn't safe to cleanup moveable (it's mousedown event)
    //        because whe'd kill moveable's functionality for others too which activated moveable on that container
    //        movable.disable(container);

    // FIXME: the Keyboard handler doesn't have a destroy yet, it'll die when our container node is garbage collected

    for (const overlay of this.overlays)
      overlay.remove();
  }

  _onDragStart(e) {
    e.stopPropagation();
    if (!this.options.allowcreate) {
      e.preventDefault();
      return;
    }

    const bounds = this.holder.getBoundingClientRect();
    this.dragcreateinfo =
    {
      x: e.detail.clientX - bounds.left,
      y: e.detail.clientY - bounds.top,
      overlay: null
    };
  }

  _onDragMove(e) {
    e.stopPropagation();

    if (!this.dragcreateinfo)
      return;

    const bounds = this.holder.getBoundingClientRect();
    const newx = e.detail.clientX - bounds.left;
    const newy = e.detail.clientY - bounds.top;

    let area =
    {
      top: Math.min(newy, this.dragcreateinfo.y),
      left: Math.min(newx, this.dragcreateinfo.x),
      bottom: Math.max(newy, this.dragcreateinfo.y),
      right: Math.max(newx, this.dragcreateinfo.x)
    };

    if (this.options.bounds) {
      area =
      {
        top: Math.max(area.top, this.options.bounds.top),
        left: Math.max(area.left, this.options.bounds.left),
        bottom: Math.min(area.bottom, this.options.bounds.bottom),
        right: Math.min(area.right, this.options.bounds.right)
      };
    }

    if (!this.dragcreateinfo.overlay) {
      if (Math.abs(area.right - area.left) < 5 && Math.abs(area.bottom - area.top) < 5)
        return;

      this.dragcreateinfo.overlay = new ResizeableOverlayRectangle(this, area);
    } else
      this.dragcreateinfo.overlay.update(area);
  }

  _onDragCancel(e) {
    if (this.dragcreateinfo) {
      movable.cancelMove();
      e.stopPropagation();
      this._finishCreateDrag(false);
    }
  }

  _onDragEnd(e) {
    e.stopPropagation();
    this._finishCreateDrag(true);
  }

  _finishCreateDrag(commit) {
    if (!this.dragcreateinfo)
      return;

    if (this.dragcreateinfo.overlay) {
      const area = this.dragcreateinfo.overlay.getArea();

      const result = commit && dompack.dispatchCustomEvent(this.holder, "dompack:overlay-created",
        {
          bubbles: true,
          cancelable: false,
          detail: { area: area, overlay: this.dragcreateinfo.overlay }
        });

      if (!result) {
        this.dragcreateinfo.overlay.remove();
      } else {
        this.overlays.push(this.dragcreateinfo.overlay);
        this.dragcreateinfo.overlay.focus();

        if (this.options.autoselectdrawnoverlays)
          this.setSelection([this.dragcreateinfo.overlay], { useraction: true });
      }
    }
    this.dragcreateinfo = null;
  }

  _fireOverlayChange(useraction) {
    dompack.dispatchCustomEvent(this.holder, "dompack:overlay-areachange",
      {
        bubbles: true,
        cancelable: false,
        detail: { useraction: useraction }
      });
  }

  addRectangle(options) {
    const newoverlay = new ResizeableOverlayRectangle(this, options);
    this.overlays.push(newoverlay);
    return newoverlay;
  }

  delete(overlay) {
    const idx = this.overlays.indexOf(overlay);
    console.info("overlay deleted from OverlayManager");//, idx, overlay["overlay-data"].rowkey);

    if (idx !== -1) {
      this.overlays.splice(idx, 1);
      overlay.remove();
    }
  }

  updateOptions(options) {
    Object.assign(this.options, options);
  }

  getSelection() {
    return this.overlays.filter(overlay => overlay.selected);
  }

  setSelection(selection, options) {
    options = { useraction: false, ...options };
    let anychange = false;

    this.overlays.forEach(overlay => {
      const shouldbeselected = selection.includes(overlay);
      if (shouldbeselected == overlay.selected)
        return;

      overlay.selected = shouldbeselected;
      dompack.toggleClass(overlay.nodes.container, `${this.classname}--selected`, shouldbeselected);

      anychange = true;
    });

    if (anychange)
      dompack.dispatchCustomEvent(this.holder, "dompack:overlay-selectionchange", { bubbles: true, cancelable: false, detail: { useraction: options.useraction } });
  }
}

/*
FIXME !!: wordt nog niet voorkomen dat men een corner over de andere trekt (en swappen van x/y als je corners over elkaar trekt werkt nog niet correct)
FIXME: ignore right click
FIXME: support for touch devices
*/

class ResizeableOverlayRectangle //we may export these separately in the future, but not sure yet why
{
  constructor(overlaymgr, options) {
    if (!overlaymgr)
      throw new Error("No container node specified");

    if (typeof options.width === "undefined")
      options.width = options.right - options.left + 1;
    if (typeof options.height === "undefined")
      options.height = options.bottom - options.top + 1;

    this.overlaymgr = overlaymgr;
    this.classname = overlaymgr.classname;
    this.deleted = false;
    this.selected = false;
    this.options = {
      enabled: true,   // option not implemented yet
      top: 0,
      left: 0,
      width: 100,
      height: 100,
      //, minwidth:  40     // min size (also usefull to prevent overlay accidently becoming so small it's hard to edit)
      //, minheight: 40

      bounds: null,   // pass the reference to an object with { x: 0, y: 0, width: , height: } or leave null to have no bounds
      ...options
    };
    //console.log("ResizeableOverlay options", this.options);

    this.dragging = false; // when in dragging mode, the temporary drag coordinates/sizes must be used by the redraw function

    this.rect = {
      left: this.options.left,
      top: this.options.top,
      right: this.options.left + this.options.width,
      bottom: this.options.top + this.options.height
    };

    // This is a temporary state which the overlay has which has the position the overlay will have if the drag is finalized
    // (and not canceled using ESQ)
    this.rect_temp = null; //{ x: 0, y: 0, width: 0, height: 0 };

    this._createDOM();
    this._addListeners();
    movable.enable(this.nodes.container); // FIXME: what is a good place for this?
  }

  getArea() {
    return {
      type: "rectangle",
      left: this.rect.left,
      top: this.rect.top,
      right: this.rect.right,
      bottom: this.rect.bottom,
      width: this.rect.right - this.rect.left,
      height: this.rect.bottom - this.rect.top
    };
  }

  /** contentnode. use if you want to add custom content to an overlay */
  getContentNode() {
    if (!this.contentnode) {
      this.contentnode = dompack.create("div", { className: `${this.classname}__content` });
      this.nodes.container.appendChild(this.contentnode);
    }
    return this.contentnode;
  }

  _createDOM() {
    this.nodes =
    {
      container: dompack.create("div", { className: `${this.classname}` }), //, style: { x: this.x, y: this.y, width: this.width, height: this.height } })
      dragger_nw: dompack.create("div", { className: `${this.classname}__dragger ${this.classname}__dragger--nw` }),
      dragger_sw: dompack.create("div", { className: `${this.classname}__dragger ${this.classname}__dragger--sw` }),
      dragger_ne: dompack.create("div", { className: `${this.classname}__dragger ${this.classname}__dragger--ne` }),
      dragger_se: dompack.create("div", { className: `${this.classname}__dragger ${this.classname}__dragger--se` })
    };
    this.nodes.container.appendChild(this.nodes.dragger_nw);
    this.nodes.container.appendChild(this.nodes.dragger_sw);
    this.nodes.container.appendChild(this.nodes.dragger_ne);
    this.nodes.container.appendChild(this.nodes.dragger_se);

    // NOTE: Tollium will block focus to any node which isn't keyboard focusable (it'll also block tabIndex < 0)
    //       So we need to use 0 to get focus for keyboard interaction.
    this.nodes.container.setAttribute("tabindex", "0");
    //this.nodes.container.classList[this.options.selected?"add":"remove"](`${this.classname}--selected`);
    this.nodes.container.classList[this.options.enabled ? "add" : "remove"](`${this.classname}--enabled`);

    this._refresh();

    this.overlaymgr.holder.appendChild(this.nodes.container);
  }

  _addListeners() {
    //this.nodes.container.addEventListener("touchstart", this._doActivateSelectedMode.bind(this));
    this.nodes.container.addEventListener("focus", this._onFocus.bind(this));
    this.nodes.container.addEventListener("blur", this._onBlur.bind(this));

    this.nodes.container.addEventListener("dompack:movestart", this._onDragStart.bind(this));
    this.nodes.container.addEventListener("dompack:move", this._onDragMoveOverlay.bind(this));
    this.nodes.container.addEventListener("dompack:moveend", this._onDragEnd.bind(this));

    new Keyboard(this.nodes.container
      , {
        "ArrowUp": () => this._moveBy(0, -1),
        "ArrowDown": () => this._moveBy(0, 1),
        "ArrowLeft": () => this._moveBy(-1, 0),
        "ArrowRight": () => this._moveBy(1, 0),

        "Shift+ArrowUp": () => this._moveBy(0, -10),
        "Shift+ArrowDown": () => this._moveBy(0, 10),
        "Shift+ArrowLeft": () => this._moveBy(-10, 0),
        "Shift+ArrowRight": () => this._moveBy(10, 0),

        "PageUp": () => this._moveBy(0, -50),
        "PageDown": () => this._moveBy(0, 50),
        "Home": () => this._moveBy(-50, 0),
        "End": () => this._moveBy(50, 0),

        "Accel+ArrowUp": () => this._moveToBoundsTop(),
        "Accel+ArrowDown": () => this._moveToBoundsBottom(),
        "Accel+ArrowLeft": () => this._moveToBoundsLeft(),
        "Accel+ArrowRight": () => this._moveToBoundsRight(),

        "Escape": (e) => this._onDragCancel(e),

        "Delete": (e) => this.deleteSelf(e)
      });
  }

  /** @short if specified area is a change, the changed will be used and an overlay change event will be fired
  */
  _setNewAreaAndFireOverlayChange(area, useraction) {
    if (this.rect.left == area.left
      && this.rect.top == area.top
      && this.rect.width == area.width
      && this.rect.height == area.height)
      return; // no change, so nothing to do

    this.rect = area;
    this.overlaymgr._fireOverlayChange(useraction);
  }

  _moveBy(movex, movey) {
    this._refresh();

    const newrect = this._getMovedRect(this.rect, movex, movey);
    this._setNewAreaAndFireOverlayChange(newrect, true);
  }

  /** @return a new object with the new coordinates
  */
  _getMovedRect(rect, movex, movey) {
    const cr = { ...rect };
    //console.info(cr);
    this._updateRectMovedBy(cr, movex, movey);
    return cr;
  }

  /** @return the object specified in the parameters, but the left/top properties will have been updated
  */
  _updateRectMovedBy(rect, movex, movey) {
    // with bounds just try to snap to the edge
    // (no going beyond the bounds are shrinking the overlay's size)
    if (this.overlaymgr.options.bounds) {
      if (movex < 0 && this.overlaymgr.options.bounds.left - rect.left >= movex)
        movex = this.overlaymgr.options.bounds.left - rect.left;

      if (movey < 0 && this.overlaymgr.options.bounds.top - rect.top >= movey)
        movey = this.overlaymgr.options.bounds.top - rect.top;

      if (movex > 0 && this.overlaymgr.options.bounds.right - rect.right <= movex)
        movex = this.overlaymgr.options.bounds.right - rect.right;

      if (movey > 0 && this.overlaymgr.options.bounds.bottom - rect.bottom <= movey)
        movey = this.overlaymgr.options.bounds.bottom - rect.bottom;
    }

    rect.left += movex;
    rect.top += movey;
    rect.right += movex;
    rect.bottom += movey;

    // NOTE: don't fire an change event here (used for translation during dragging)
  }

  _moveToBoundsLeft() {
    const width = this.rect.right - this.rect.left;
    const newx = this.overlaymgr.options.bounds ? this.overlaymgr.options.bounds.left : 0;

    this.rect.left = newx;
    this.rect.right = newx + width;

    this._refresh();
    this.overlaymgr._fireOverlayChange(true);
  }

  _moveToBoundsRight() {
    const width = this.rect.right - this.rect.left;
    const newx = this.overlaymgr.options.bounds ? this.overlaymgr.options.bounds.right : this.overlaymgr.holder.clientWidth;

    this.rect.left = newx - width;
    this.rect.right = newx;

    this._refresh();
    this.overlaymgr._fireOverlayChange(true);
  }

  _moveToBoundsTop() {
    const height = this.rect.bottom - this.rect.top;
    const newy = this.overlaymgr.options.bounds ? this.overlaymgr.options.bounds.top : 0;

    this.rect.top = newy;
    this.rect.bottom = newy + height;

    this._refresh();
    this.overlaymgr._fireOverlayChange(true);
  }

  _moveToBoundsBottom() {
    const height = this.rect.bottom - this.rect.top;
    const newy = this.overlaymgr.options.bounds ? this.overlaymgr.options.bounds.bottom : this.overlaymgr.holder.clientHeight;

    this.rect.top = newy - height;
    this.rect.bottom = newy;

    this._refresh();
    this.overlaymgr._fireOverlayChange(true);
  }

  _clampRectWithinBounds(rect) {
    //console.log("before", rect);

    // FIXME: either allow dragging a corner over another OR have a min width/height and force to user to drag the other corner
    if (rect.right < rect.left) {
      // swap
      const temp = rect.left;
      rect.left = rect.right;
      rect.right = temp;
    }
    if (rect.bottom < rect.top) {
      // swap
      const temp = rect.top;
      rect.top = rect.bottom;
      rect.bottom = temp;
    }

    if (!this.overlaymgr.options.bounds)
      return;

    const bounds = this.overlaymgr.options.bounds;

    if (rect.left < bounds.left)
      rect.left = bounds.left;

    if (rect.top < bounds.top)
      rect.top = bounds.top;

    if (rect.right > bounds.right)
      rect.right = bounds.right;

    if (rect.bottom > bounds.bottom)
      rect.bottom = bounds.bottom;

    //console.log("after", rect);

    // NOTE: don't fire an change event here
  }

  _refresh() {
    const node = this.nodes.container;

    // clone the current coordinates (don't accidently reference this.rect)
    const coords = this.dragging ? this.rect_temp : this.rect; //{ x: this.rect.left, y: this.rect..y, width: this.rect..width, height: this.rect..height };

    node.style.left = coords.left + "px";
    node.style.top = coords.top + "px";
    node.style.width = (coords.right - coords.left) + "px";
    node.style.height = (coords.bottom - coords.top) + "px";

    // NOTE: don't fire an change event here
  }

  _onFocus(evt) {
    console.log("Overlay FOCUS", this.nodes.container);
    this.overlaymgr.setSelection([this], { useraction: true });
  }

  _onBlur(evt) {
    console.log("Overlay BLUR", this.nodes.container);
  }

  _doActivateSelectedMode(evt) {
    this.overlaymgr.setSelection([this], { useraction: true });
  }

  _onDragStart(evt) {
    this._doActivateSelectedMode();

    this.rect_temp = { ...this.rect };
    this.dragging = true;
    this._refresh();
    evt.stopPropagation();

    // Explicit focus, because dompack:movestart will prevent default. Focus is necessary for keyboard handling
    this.focus();
  }

  // dragging started on the overlay container will move the whole overlay
  _onDragMoveOverlay(evt) {
    /*
    DOMPACK movable is too primitive and cannot handle overlapping drag areas,
    we must detect the source of the drag ourselves
    */
    if (evt.target.classList.contains(`${this.classname}__dragger`)) {
      this._onDragCorner(evt);
      return;
    }

    //console.info("dompack:move on overlay", evt); // evt.target, evt.details);
    this.rect_temp = { ...this.rect };
    this._updateRectMovedBy(this.rect_temp, evt.detail.movedX, evt.detail.movedY);

    this._refresh();
    evt.stopPropagation();
  }

  _onDragCorner(evt) {
    //console.log(evt.detail.movedX, evt.detail.movedY);
    const left = evt.target.classList.contains(`${this.classname}__dragger--nw`) || evt.target.classList.contains(`${this.classname}__dragger--sw`);
    const top = evt.target.classList.contains(`${this.classname}__dragger--nw`) || evt.target.classList.contains(`${this.classname}__dragger--ne`);

    if (left)
      this.rect_temp.left = this.rect.left + evt.detail.movedX;
    else
      this.rect_temp.right = this.rect.right + evt.detail.movedX;

    if (top)
      this.rect_temp.top = this.rect.top + evt.detail.movedY;
    else
      this.rect_temp.bottom = this.rect.bottom + evt.detail.movedY;

    this._clampRectWithinBounds(this.rect_temp);
    this._refresh();
    evt.stopPropagation();
  }

  _onDragCancel(evt) {
    console.log("_onDragCancel");
    if (this.dragging) {
      movable.cancelMove();
      this.dragging = false;
      this._refresh();
      evt.stopPropagation();
    }
  }

  _onDragEnd(evt) {
    this.dragging = false;

    const newrect = { ...this.rect_temp };
    this._setNewAreaAndFireOverlayChange(newrect, true);

    // finalize/store the new position
    this.rect = newrect;
  }

  update(options) {
    options = { ...options };
    if (typeof options.width === "undefined")
      options.width = options.right - options.left + 1;
    if (typeof options.height === "undefined")
      options.height = options.bottom - options.top + 1;

    Object.assign(this.options, options);

    this.rect = {
      left: this.options.left,
      top: this.options.top,
      right: this.options.left + this.options.width,
      bottom: this.options.top + this.options.height
    };

    this._refresh();
  }

  deleteSelf(evt) {
    //console.log("User 'del' on: ",this, this["overlay-data"].rowkey);

    const result = dompack.dispatchCustomEvent(this.nodes.container, "dompack:overlay-deleted",
      {
        bubbles: true,
        cancelable: false,
        detail: { useraction: true, overlay: this }
      });

    this.deleted = true;

    this.overlaymgr.delete(this);
    this.overlaymgr._fireOverlayChange(true);
    evt.stopPropagation();
  }

  remove() {
    //console.log("ResizeableOverlayRectangle:remove()", this.overlaymgr.holder, this.nodes.container);

    //this.overlaymgr.holder.removeChild(this.nodes.container);

    const pn = this.nodes.container.parentNode;
    if (pn) {
      this.nodes.container.innerHTML = "DELETED";
      pn.removeChild(this.nodes.container);
    }
    //else
    //  console.error("Removing overlay which already has been removed from the DOM");
  }

  focus() {
    dompack.focus(this.nodes.container);
  }
}

/** @deprecated We recommend to import by name, not the default */
export default OverlayManager;
