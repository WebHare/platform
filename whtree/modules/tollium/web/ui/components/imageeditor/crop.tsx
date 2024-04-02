/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from "dompack";
import * as movable from "dompack/browserfix/movable";
import { getTid } from "@mod-tollium/js/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { Toolbar, ToolbarButton, ToolbarPanel } from "@mod-tollium/web/ui/components/toolbar/toolbars";

import { SetStatusCallback } from ".";
import { ImageSurface } from "./surface";
import { SurfaceTool } from "./surfacetool";

//@ts-ignore we only have this one as a .js
import SmartCrop from "./smartcrop";

import "./imageeditor.lang.json";

type PhotoCropOptions = {
  fixedsize?: { width: number; height: number };
  ratiosize?: { width: number; height: number };
  setStatus?: SetStatusCallback;
};

class PhotoCrop extends SurfaceTool {
  crop = null;
  aspect = 0;
  draggers: HTMLDivElement[] = [];
  masks: HTMLDivElement[] = [];
  masksize: DOMRect | null = null;
  reference = null;
  cropbox: HTMLDivElement | null = null;
  gridholder = null;
  gridanchor = null;
  active = false;
  fx = null;

  options;
  croppanel;
  autobutton;

  constructor(surface: ImageSurface, options?: PhotoCropOptions) {
    super(surface);

    this.options = {
      fixedsize: null, // { width: 0, height: 0 }
      ratiosize: null, // { width: 0, height: 0 }
      setStatus: null,
      ...options
    };

    this.croppanel = new ToolbarPanel(
      {
        onClose: this.stop.bind(this),
        onApply: this.apply.bind(this)
      });
    this.croppanel._imgedittool = "crop";
    this.autobutton = new ToolbarButton(this.croppanel,
      {
        label: getTid("tollium:components.imgedit.editor.smartcrop"),
        icon: toddImages.createImage("tollium:actions/resetcrop", 24, 24, "b"),
        onExecute: () => this.smartCrop()
      });
    this.croppanel.addButton(this.autobutton);
  }

  startCropping(toolbar: Toolbar) {
    toolbar.activateModalPanel(this.croppanel);
    this.surface.hidePreviewCanvas(true);
    this.start();
  }

  start() {
    this.active = false;
    this.fixedsize = this.options.fixedsize || { width: 0, height: 0 };

    const styles = this.surface.canvas.style.cssText;

    this.cropbox = <div class="wh-cropbox" style={styles} />;
    this.surface.node.append(this.cropbox);

    const canvaspos = this.surface.canvas.getBoundingClientRect();
    this.reference = { x: canvaspos.left, y: canvaspos.top };



    //viewport (used to display 33% grid)
    this.gridholder = <div class="wh-cropbox-viewport" />;
    this.cropbox.append(this.gridholder);
    movable.enable(this.gridholder);
    this.gridholder.addEventListener("dompack:move", evt => this.onDragMove(this.gridholder, evt));
    this.gridholder.addEventListener("dompack:end", evt => this.gridanchor = null);

    this.gridholder.append(<div class="vline1" />
      , <div class="vline2" />
      , <div class="hline1" />
      , <div class="hline2" />);

    this.masksize = this.surface.node.getBoundingClientRect();

    //set draggers:
    this.draggers = [];
    this.masks = [];
    for (let c = 0; c < 4; c++) {
      const dragger = <div class="wh-cropbox-dragger" />;
      dragger.classList.add(["wh-cropbox-dragger-nw", "wh-cropbox-dragger-sw", "wh-cropbox-dragger-ne", "wh-cropbox-dragger-se"][c]);
      this.cropbox.append(dragger);
      this.draggers.push(dragger);

      let pos = { x: 0, y: 0 };
      if (c === 1)
        pos = { x: 0, y: this.surface.canvasData.cssSize.y };
      else if (c === 2)
        pos = { x: this.surface.canvasData.cssSize.x, y: 0 };
      else if (c === 3)
        pos = { x: this.surface.canvasData.cssSize.x, y: this.surface.canvasData.cssSize.y };

      this.draggers[c].wh_pos = pos;
      dompack.setStyles(this.draggers[c], { 'top': pos.y + 'px', 'left': pos.x + 'px' });

      movable.enable(this.draggers[c]);
      this.draggers[c].addEventListener("dompack:move", evt => this.onDragMove(dragger, evt));


      const mask = <div class="wh-cropbox-mask" style={`width: ${this.masksize.width}px; height: ${this.masksize.height}px`} />;
      this.cropbox.append(mask);
      this.masks.push(mask);
    }

    //initial crop values
    this.crop = [0, 1, 1, 0];

    this.setAspectratio(this.options.ratiosize, function () {
      this.active = true;
    }.bind(this));
  }

  onDragMove(dragnode, ev) {
    let c;
    const movegrid = dragnode.classList.contains('wh-cropbox-viewport');
    if (movegrid) {//get upperleft dragger as reference for grid movement
      dragnode = this.draggers[0];
      for (c = 1; c < this.draggers.length; c++) {
        if (this.draggers[c].wh_pos.x < dragnode.wh_pos.x)
          dragnode = this.draggers[c];
        else if (this.draggers[c].wh_pos.y < dragnode.wh_pos.y)
          dragnode = this.draggers[c];
      }

      if (!this.gridanchor)//mouse snap position relative to upperleft dragger
        this.gridanchor = {
          x: dragnode.wh_pos.x - (ev.detail.pageX - this.reference.x),
          y: dragnode.wh_pos.y - (ev.detail.pageY - this.reference.y),
          width: this.crop[1] - this.crop[3],
          height: this.crop[2] - this.crop[0]
        };
    } else {
      this.gridanchor = null;
    }

    //css w/h canvas
    let w = this.crop[1] * this.surface.canvasData.cssSize.x - this.crop[3] * this.surface.canvasData.cssSize.x;
    let h = this.crop[2] * this.surface.canvasData.cssSize.y - this.crop[0] * this.surface.canvasData.cssSize.y;

    //mouse position relative to upperleft viewport
    let dx = ev.detail.pageX - this.reference.x;
    let dy = ev.detail.pageY - this.reference.y;

    if (this.gridanchor) {//if moving whole clipbox, compensate mouse position with (start) grab position
      dx += this.gridanchor.x;
      dy += this.gridanchor.y;
    }

    //some bounds checks:
    if (dx < 0)
      dx = 0;
    else if (dx > this.surface.canvasData.cssSize.x)
      dx = this.surface.canvasData.cssSize.x;

    if (dy < 0)
      dy = 0;
    else if (dy > this.surface.canvasData.cssSize.y)
      dy = this.surface.canvasData.cssSize.y;

    //sortout dragnodes in respect to current dragnode
    let hpairednode = null;
    let vpairednode = null;
    let diagonalnode = null;
    for (c = 0; c < this.draggers.length; c++) {
      if (this.draggers[c] !== dragnode) {
        if (!hpairednode && this.draggers[c].wh_pos.y === dragnode.wh_pos.y && this.draggers[c].wh_pos.x !== dragnode.wh_pos.x) {
          hpairednode = this.draggers[c];
        } else if (!vpairednode && this.draggers[c].wh_pos.x === dragnode.wh_pos.x && this.draggers[c].wh_pos.y !== dragnode.wh_pos.y) {
          vpairednode = this.draggers[c];
        } else if (!diagonalnode) {
          diagonalnode = this.draggers[c];
        }
      }
    }

    if (!hpairednode || !vpairednode) {//draggers have all the same position
      hpairednode = null;//reset
      vpairednode = null;
      diagonalnode = null;
      //assign directly:
      for (c = 0; c < this.draggers.length; c++) {
        if (this.draggers[c] !== dragnode) {
          if (!hpairednode)
            hpairednode = this.draggers[c];
          else if (!vpairednode)
            vpairednode = this.draggers[c];
          else if (!diagonalnode)
            diagonalnode = this.draggers[c];
        }
      }
    }


    if (!movegrid && this.aspect > 0 && !(this.fixedsize.width > 0 || this.fixedsize.height > 0)) {
      //use smallest displacement voor ratio correction
      if (Math.abs(dx - dragnode.wh_pos.x) < Math.abs(dy - dragnode.wh_pos.y)) {
        w = Math.abs(dx - hpairednode.wh_pos.x);
        h = w / this.aspect;

        if (dy < vpairednode.wh_pos.y)
          dy = vpairednode.wh_pos.y - h;
        else if (dy > vpairednode.wh_pos.y)
          dy = vpairednode.wh_pos.y + h;

        if (dy < 0)
          dy = 0;
        else if (dy > this.surface.canvasData.cssSize.y)
          dy = this.surface.canvasData.cssSize.y;
      } else {
        h = Math.abs(dy - vpairednode.wh_pos.y);
        w = h * this.aspect;

        if (dx < hpairednode.wh_pos.x)
          dx = hpairednode.wh_pos.x - w;
        else if (dx > hpairednode.wh_pos.x)
          dx = hpairednode.wh_pos.x + w;

        if (dx < 0)
          dx = 0;
        else if (dx > this.surface.canvasData.cssSize.x)
          dx = this.surface.canvasData.cssSize.x;
      }
    }

    dragnode.wh_pos = { x: Math.round(dx), y: Math.round(dy) };
    hpairednode.wh_pos.y = Math.round(dy);
    vpairednode.wh_pos.x = Math.round(dx);

    if (movegrid) {//moveing clipbox, then keep orginal width/height
      hpairednode.wh_pos.x = Math.round(w + dx);
      vpairednode.wh_pos.y = Math.round(h + dy);
    }

    //handling of dragnodes if fixed width or height is given
    if (!movegrid && (this.fixedsize.width > 0 || this.fixedsize.height > 0)) {
      let fixedw = this.fixedsize.width;
      let fixedh = this.fixedsize.height;
      if (this.aspect > 0) {
        if (fixedw <= 0)
          fixedw = fixedh * this.aspect;
        else if (fixedh <= 0)
          fixedh = fixedw / this.aspect;
      }

      if (fixedw > 0) {
        w = fixedw / (this.surface.canvasData.scale.x * this.surface.imgData.scale.x);

        if (hpairednode.wh_pos.x < dragnode.wh_pos.x) {
          //check bounds
          if (dragnode.wh_pos.x - w < 0) {
            dragnode.wh_pos.x = Math.round(w);
            vpairednode.wh_pos.x = dragnode.wh_pos.x;
          }
          hpairednode.wh_pos.x = Math.round(dragnode.wh_pos.x - w);
        } else {
          hpairednode.wh_pos.x = Math.round(dragnode.wh_pos.x + w);
        }

      }

      if (fixedh > 0) {
        h = fixedh / (this.surface.canvasData.scale.y * this.surface.imgData.scale.y);
        if (vpairednode.wh_pos.y < dragnode.wh_pos.y) {
          //check bounds
          if (dragnode.wh_pos.y - h < 0) {
            dragnode.wh_pos.y = Math.round(h);
            hpairednode.wh_pos.y = dragnode.wh_pos.y;
          }
          vpairednode.wh_pos.y = Math.round(dragnode.wh_pos.y - h);
        } else {
          vpairednode.wh_pos.y = Math.round(dragnode.wh_pos.y + h);
        }
      }

    }

    diagonalnode.wh_pos = { x: hpairednode.wh_pos.x, y: vpairednode.wh_pos.y };

    //sortout positions:
    let toppx = this.draggers[0].wh_pos.y;
    let rightpx = this.draggers[0].wh_pos.x;
    let bottompx = this.draggers[0].wh_pos.y;
    let leftpx = this.draggers[0].wh_pos.x;
    for (c = 1; c < this.draggers.length; c++) {
      if (this.draggers[c].wh_pos.x > rightpx)
        rightpx = this.draggers[c].wh_pos.x;

      if (this.draggers[c].wh_pos.x < leftpx)
        leftpx = this.draggers[c].wh_pos.x;

      if (this.draggers[c].wh_pos.y < toppx)
        toppx = this.draggers[c].wh_pos.y;

      if (this.draggers[c].wh_pos.y > bottompx)
        bottompx = this.draggers[c].wh_pos.y;
    }

    let d;
    //check if grid is within bounds else correct positions
    if (rightpx > this.surface.canvasData.cssSize.x) {
      d = this.surface.canvasData.cssSize.x - rightpx;
      rightpx += d;
      leftpx += d;

      for (c = 0; c < this.draggers.length; c++)
        this.draggers[c].wh_pos.x += d;
    }
    if (bottompx > this.surface.canvasData.cssSize.y) {
      d = this.surface.canvasData.cssSize.y - bottompx;
      bottompx += d;
      toppx += d;

      for (c = 0; c < this.draggers.length; c++)
        this.draggers[c].wh_pos.y += d;
    }

    if (rightpx > this.surface.canvasData.cssSize.x)
      rightpx = this.surface.canvasData.cssSize.x;
    if (leftpx < 0)
      leftpx = 0;

    if (bottompx > this.surface.canvasData.cssSize.y)
      bottompx = this.surface.canvasData.cssSize.y;
    if (toppx < 0)
      toppx = 0;

    this.crop[0] = toppx / this.surface.canvasData.cssSize.y;
    this.crop[1] = rightpx / this.surface.canvasData.cssSize.x;
    this.crop[2] = bottompx / this.surface.canvasData.cssSize.y;
    this.crop[3] = leftpx / this.surface.canvasData.cssSize.x;

    //reduce rounding errors of crop size:
    if (this.fixedsize.width > 0)
      this.crop[1] = this.crop[3] + (this.fixedsize.width / this.surface.canvasData.realSize.x);
    if (this.fixedsize.height > 0)
      this.crop[2] = this.crop[0] + (this.fixedsize.height / this.surface.canvasData.realSize.y);
    if (movegrid) {//moving whole grid
      this.crop[1] = this.crop[3] + this.gridanchor.width;
      this.crop[2] = this.crop[0] + this.gridanchor.height;
    } else if (this.aspect > 0) {
      if (this.fixedsize.width === 0) {
        this.crop[1] = this.crop[3] + ((bottompx - toppx) * this.aspect) / this.surface.canvasData.cssSize.x;
      } else
        this.crop[2] = this.crop[0] + (rightpx - leftpx) / (this.aspect * this.surface.canvasData.cssSize.y);
    }

    this.showCrop();
  }

  setAspectratio(aspect, callback?) {
    let crop = null;
    if (typeof aspect === "object") {
      crop = aspect;
      if (!crop || !crop.width || !crop.height)
        aspect = 0;
      else
        aspect = crop.width / crop.height;
    }

    this.aspect = aspect > 0 ? aspect : 0;

    const maxw = this.fixedsize.width > 0 ? this.fixedsize.width : crop ? crop.width : this.surface.canvasData.realSize.x;
    const maxh = this.fixedsize.height > 0 ? this.fixedsize.height : crop ? crop.height : this.surface.canvasData.realSize.y;
    let w = maxw;
    let h = maxh;

    if (this.aspect > 0) {//set crop to optimal fit
      h = Math.round(w / this.aspect);
      if (h > maxh) {
        h = maxh;
        w = Math.round(h * this.aspect);
      }

      if (this.fixedsize.width > 0 || this.fixedsize.height > 0)
        this.fixedsize = { 'width': w, 'height': h };
    }

    if (!this.surface.setBusy(true))
      return;

    const options = {
      width: w || this.surface.canvasData.realSize.x,
      height: h || this.surface.canvasData.realSize.y,
      debug: dompack.debugflags.isc
    };
    SmartCrop.crop(this.surface.canvas, options, function (result) {
      //ADDME:      if (options.debug && result.debugCanvas)
      //        this.tmpcanvas.getContext("2d").drawImage(result.debugCanvas, 0, 0, this.tmpcanvas.width, this.tmpcanvas.height);
      this.setClipValues(result.topCrop.x, result.topCrop.y, result.topCrop.y + result.topCrop.height, result.topCrop.x + result.topCrop.width);
      this.showCrop();
      this.surface.setBusy(false);
      if (callback)
        callback({ 'width': result.topCrop.width, 'height': result.topCrop.height });
    }.bind(this));
  }

  smartCrop(callback?) {
    this.setAspectratio(this.options.ratiosize, callback);
  }

  setClipValues(leftpx, toppx, bottompx, rightpx) {
    this.crop[0] = toppx / this.surface.canvasData.realSize.y;
    this.crop[1] = rightpx / this.surface.canvasData.realSize.x;
    this.crop[2] = bottompx / this.surface.canvasData.realSize.y;
    this.crop[3] = leftpx / this.surface.canvasData.realSize.x;

    //covert to css positions current canvas
    toppx = Math.round(toppx / (this.surface.imgData.scale.y * this.surface.canvasData.scale.y));
    rightpx = Math.round(rightpx / (this.surface.imgData.scale.x * this.surface.canvasData.scale.x));
    bottompx = Math.round(bottompx / (this.surface.imgData.scale.y * this.surface.canvasData.scale.y));
    leftpx = Math.round(leftpx / (this.surface.imgData.scale.x * this.surface.canvasData.scale.x));

    this.draggers[0].wh_pos = { x: leftpx, y: toppx };
    this.draggers[1].wh_pos = { x: leftpx, y: bottompx };
    this.draggers[2].wh_pos = { x: rightpx, y: toppx };
    this.draggers[3].wh_pos = { x: rightpx, y: bottompx };
  }

  setClipCenterValues(w, h) {
    const leftpx = 0.5 * (this.surface.canvasData.realSize.x - w);
    const toppx = 0.5 * (this.surface.canvasData.realSize.y - h);
    const bottompx = toppx + h;
    const rightpx = leftpx + w;
    this.setClipValues(leftpx, toppx, bottompx, rightpx);
  }

  setWidth(w, fixed) {
    const inputwidth = Math.round(w);

    if (w > this.surface.canvasData.realSize.x)
      w = this.surface.canvasData.realSize.x;
    let h = Math.round(this.crop[2] * this.surface.canvasData.realSize.y - this.crop[0] * this.surface.canvasData.realSize.y);

    if (this.aspect > 0 && w > 0) {
      //calc maximal width by given aspectratio
      let aw = this.surface.canvasData.realSize.x;
      let ah = aw / this.aspect;
      if (ah > this.surface.canvasData.realSize.y) {
        ah = this.surface.canvasData.realSize.y;
        aw = ah * this.aspect;
      }
      if (w > aw)
        w = aw;

      h = w / this.aspect;
    }

    if (w < 0)
      w = 0;

    w = Math.round(w);
    h = Math.round(h);

    const isvalid = inputwidth === w;
    if (isvalid) {
      if (fixed) {
        if (this.fixedsize.height > 0 && this.fixedsize.height !== h)
          this.fixedsize.height = h;
        this.fixedsize.width = w;
      }

      if (w > 0) {//resize clip area
        this.setClipCenterValues(w, h);
        this.showCrop();
      }
    }

    return isvalid;
  }

  setHeight(h, fixed) {
    const inputheight = Math.round(h);

    if (h > this.surface.canvasData.realSize.y)
      h = this.surface.canvasData.realSize.y;
    let w = Math.round(this.crop[1] * this.surface.canvasData.realSize.x - this.crop[3] * this.surface.canvasData.realSize.x);

    if (this.aspect > 0 && h > 0) {
      //calc maximal height by given aspectratio
      let aw = this.surface.canvasData.realSize.x;
      let ah = aw / this.aspect;
      if (ah > this.surface.canvasData.realSize.y) {
        ah = this.surface.canvasData.realSize.y;
        aw = ah * this.aspect;
      }
      if (h > ah)
        h = ah;

      w = h * this.aspect;
    }

    if (h < 0)
      h = 0;

    w = Math.round(w);
    h = Math.round(h);

    const isvalid = inputheight === h;
    if (isvalid) {
      if (fixed) {
        if (this.fixedsize.width > 0 && this.surface.canvasData.realSize.x !== w)
          this.fixedsize.width = w;
        this.fixedsize.height = h;
      }
      if (h > 0) {//resize clip area
        this.setClipCenterValues(w, h);
        this.showCrop();
      }
    }

    return isvalid;
  }

  showCrop() {
    let x1 = this.draggers[0].wh_pos.x;
    let y1 = this.draggers[0].wh_pos.y;
    let x2 = x1;
    let y2 = y1;
    for (let c = 0; c < this.draggers.length; c++) {
      dompack.setStyles(this.draggers[c], { 'top': this.draggers[c].wh_pos.y + 'px', 'left': this.draggers[c].wh_pos.x + 'px' });
      if (c > 0) {
        if (this.draggers[c].wh_pos.x > x2)
          x2 = this.draggers[c].wh_pos.x;

        if (this.draggers[c].wh_pos.x < x1)
          x1 = this.draggers[c].wh_pos.x;

        if (this.draggers[c].wh_pos.y < y1)
          y1 = this.draggers[c].wh_pos.y;

        if (this.draggers[c].wh_pos.y > y2)
          y2 = this.draggers[c].wh_pos.y;
      }
    }

    dompack.setStyles(this.gridholder, {
      'top': y1 + 'px',
      'right': x2 + 'px',
      'bottom': y2 + 'px',
      'left': x1 + 'px',
      'width': (x2 - x1) + 'px',
      'height': (y2 - y1) + 'px'
    });

    const canvasscale = Math.max(0, this.surface.canvasData.realSize.x / this.surface.viewPort.x, this.surface.canvasData.realSize.y / this.surface.viewPort.y);
    this.options.setStatus(Math.round((x2 - x1) * canvasscale), Math.round((y2 - y1) * canvasscale), this.surface.canvasData.realSize.x, this.surface.canvasData.realSize.y);

    this.masks[0].style.top = (y2 - this.masksize.height) + "px";
    this.masks[0].style.left = (x1 - this.masksize.width) + "px";
    this.masks[1].style.top = (y1 - this.masksize.height) + "px";
    this.masks[1].style.left = x1 + "px";
    this.masks[2].style.top = y1 + "px";
    this.masks[2].style.left = x2 + "px";
    this.masks[3].style.top = y2 + "px";
    this.masks[3].style.left = (x2 - this.masksize.width) + "px";
  }

  stop() {
    this.surface.showPreviewCanvas();
    this.cropbox.remove();
    this.refreshSurface();
  }

  apply() {
    this.surface.showPreviewCanvas();
    if (this.crop[0] === 0 && this.crop[1] === 1 && this.crop[2] === 1 && this.crop[3] === 0)
      return; //no changes

    this.applyCanvas({ crop: this.crop });
    this.surface.pushUndo({ action: "crop", comp: this, props: { crop: this.crop }, width: this.surface.canvas.width, height: this.surface.canvas.height, meta: false });
    this.refreshSurface();
  }

  applyCanvas(props) { //props is an array with top,right,bottom,left fractions (0..1)
    const newwidth = Math.round(props.crop[1] * this.surface.canvas.width - props.crop[3] * this.surface.canvas.width);
    const newheight = Math.round(props.crop[2] * this.surface.canvas.height - props.crop[0] * this.surface.canvas.height);

    //crop image
    const idata = this.surface.ctx.getImageData(Math.round(props.crop[3] * this.surface.canvas.width), Math.round(props.crop[0] * this.surface.canvas.height), newwidth, newheight);
    this.surface.canvas.width = newwidth;
    this.surface.canvas.height = newheight;
    this.surface.ctx.putImageData(idata, 0, 0);

    //correct css styling:
    const canvasscalex = newwidth / this.surface.viewPort.x;
    const canvasscaley = newheight / this.surface.viewPort.y;
    let canvasscale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
    if (canvasscale < 1)
      canvasscale = 1;//don't scale up
    this.surface.canvasScale = 1 / canvasscale;

    const cssw = Math.round(newwidth / canvasscale);
    const cssh = Math.round(newheight / canvasscale);
    this.surface.canvasData.cssSize = { 'x': cssw, 'y': cssh };
    this.surface.canvasData.scale = { 'x': (newwidth / cssw), 'y': (newheight / cssh) };
    //this.surface.canvasData.realSize = {'x' : Math.round(props.crop[1]*imgedit.canvasdata.realSize.x - props.crop[3]*imgedit.canvasdata.realSize.x), 'y' : Math.round(props.crop[2]*imgedit.canvasdata.realSize.y - props.crop[0]*imgedit.canvasdata.realSize.y)};

    dompack.setStyles(this.surface.canvas, {
      'width': this.surface.canvasData.cssSize.x + 'px',
      'height': this.surface.canvasData.cssSize.y + 'px',
      'margin-left': Math.floor(this.surface.canvasData.cssSize.x * -0.5) + 'px',
      'margin-top': Math.floor(this.surface.canvasData.cssSize.y * -0.5) + 'px'
    });
    this.surface.showScale();
  }
}

export type { PhotoCrop };

export function addImageCropButton(toolbar: Toolbar, surface: ImageSurface, options?: PhotoCropOptions) {
  const cropper = new PhotoCrop(surface, options);

  const button = new ToolbarButton(toolbar, {
    label: getTid("tollium:components.imgedit.editor.crop"),
    icon: toddImages.createImage("tollium:actions/crop", 24, 24, "b"),
    onExecute: cropper.startCropping.bind(cropper, toolbar)
  });
  toolbar.addButton(button);

  return { button: button, comp: cropper };
}
