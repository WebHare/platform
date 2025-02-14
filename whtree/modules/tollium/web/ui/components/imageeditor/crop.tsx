import * as dompack from "dompack";
import * as movable from "dompack/browserfix/movable";
//@ts-ignore we only have this one as a .js
import SmartCrop from "./smartcrop";

import { debugFlags } from "@webhare/env";
import { getTid } from "@mod-tollium/js/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { type Toolbar, ToolbarButton } from "@mod-tollium/web/ui/components/toolbar/toolbars";

import type { Rect, RectSize, SetStatusCallback, Size } from ".";
import type { ImageSurface } from "./surface";
import { SurfaceTool } from "./surfacetool";

import "./imageeditor.lang.json";
import { ImageToolbarPanel } from "./toolbarpanel";

const DraggerPos = Symbol("DraggerPos");
interface DraggerElement extends HTMLDivElement {
  [DraggerPos]: Size;
}

export type PhotoCropProps = {
  crop: number[];
};

type PhotoCropOptions = {
  fixedSize?: RectSize;
  ratioSize?: RectSize;
  setStatus?: SetStatusCallback;
};

class PhotoCrop extends SurfaceTool {
  crop: number[] | null = null;
  aspect = 0;
  fixedSize?: RectSize;
  draggers: DraggerElement[] = [];
  masks: HTMLDivElement[] = [];
  maskSize: DOMRect | null = null;
  reference: Size | null = null;
  cropBox: HTMLDivElement | null = null;
  gridHolder: HTMLDivElement | null = null;
  gridAnchor: Rect | null = null;
  active = false;

  options: PhotoCropOptions;
  cropPanel: ImageToolbarPanel;
  autoButton: ToolbarButton;

  constructor(surface: ImageSurface, options?: PhotoCropOptions) {
    super(surface);

    this.options = {
      ...options
    };

    this.cropPanel = new ImageToolbarPanel("crop", {
      onClose: () => this.stop(),
      onApply: () => this.apply()
    });
    this.autoButton = new ToolbarButton({
      label: getTid("tollium:components.imgedit.editor.smartcrop"),
      icon: toddImages.createImage("tollium:actions/resetcrop", 24, 24, "b"),
      onExecute: () => this.smartCrop()
    });
    this.cropPanel.addButton(this.autoButton);
  }

  startCropping(toolbar: Toolbar) {
    toolbar.activateModalPanel(this.cropPanel);
    this.surface.hidePreviewCanvas(true);
    this.start();
  }

  start() {
    this.active = false;
    this.fixedSize = this.options.fixedSize || { width: 0, height: 0 };

    const styles = this.surface.canvas.style.cssText;

    this.cropBox = <div class="wh-cropbox" style={styles} />;
    this.surface.node.append(this.cropBox!);

    const canvaspos = this.surface.canvas.getBoundingClientRect();
    this.reference = { x: canvaspos.left, y: canvaspos.top };

    //viewport (used to display 33% grid)
    this.gridHolder = <div class="wh-cropbox-viewport" />;
    this.cropBox!.append(this.gridHolder!);
    movable.enable(this.gridHolder!);
    this.gridHolder!.addEventListener("dompack:move", evt => this.onDragMove(this.gridHolder!, evt));
    this.gridHolder!.addEventListener("dompack:end", () => this.gridAnchor = null);

    this.gridHolder!.append(<div class="vline1" />,
      <div class="vline2" />,
      <div class="hline1" />,
      <div class="hline2" />);

    this.maskSize = this.surface.node.getBoundingClientRect();

    //set draggers:
    this.draggers = [];
    this.masks = [];
    for (let c = 0; c < 4; c++) {
      const dragger: DraggerElement = <div class="wh-cropbox-dragger" />;
      dragger.classList.add(["wh-cropbox-dragger-nw", "wh-cropbox-dragger-sw", "wh-cropbox-dragger-ne", "wh-cropbox-dragger-se"][c]);
      this.cropBox!.append(dragger);
      this.draggers.push(dragger);

      let pos = { x: 0, y: 0 };
      if (c === 1)
        pos = { x: 0, y: this.surface.canvasData!.cssSize.y };
      else if (c === 2)
        pos = { x: this.surface.canvasData!.cssSize.x, y: 0 };
      else if (c === 3)
        pos = { x: this.surface.canvasData!.cssSize.x, y: this.surface.canvasData!.cssSize.y };

      this.draggers[c][DraggerPos] = pos;
      Object.assign(this.draggers[c].style, { top: pos.y + 'px', left: pos.x + 'px' });

      movable.enable(this.draggers[c]);
      this.draggers[c].addEventListener("dompack:move", evt => this.onDragMove(dragger, evt));


      const mask = <div class="wh-cropbox-mask" style={`width: ${this.maskSize.width}px; height: ${this.maskSize.height}px`} />;
      this.cropBox!.append(mask);
      this.masks.push(mask);
    }

    //initial crop values
    this.crop = [0, 1, 1, 0];

    this.setAspectratio(this.options.ratioSize || 0, () => {
      this.active = true;
    });
  }

  onDragMove(movedNode: DraggerElement | HTMLDivElement, ev: CustomEvent) {
    let dragNode: DraggerElement | undefined;
    const moveGrid = !(DraggerPos in movedNode);// dragnode.classList.contains('wh-cropbox-viewport');
    if (moveGrid) {//get upperleft dragger as reference for grid movement
      dragNode = this.draggers[0];
      for (let c = 1; c < this.draggers.length; c++) {
        if (this.draggers[c][DraggerPos].x < dragNode[DraggerPos].x)
          dragNode = this.draggers[c];
        else if (this.draggers[c][DraggerPos].y < dragNode[DraggerPos].y)
          dragNode = this.draggers[c];
      }

      if (!this.gridAnchor)//mouse snap position relative to upperleft dragger
        this.gridAnchor = {
          left: dragNode[DraggerPos].x - (ev.detail.pageX - this.reference!.x),
          top: dragNode[DraggerPos].y - (ev.detail.pageY - this.reference!.y),
          width: this.crop![1] - this.crop![3],
          height: this.crop![2] - this.crop![0]
        };
    } else {
      this.gridAnchor = null;
      dragNode = movedNode;
    }

    //css w/h canvas
    let width = this.crop![1] * this.surface.canvasData!.cssSize.x - this.crop![3] * this.surface.canvasData!.cssSize.x;
    let height = this.crop![2] * this.surface.canvasData!.cssSize.y - this.crop![0] * this.surface.canvasData!.cssSize.y;

    //mouse position relative to upperleft viewport
    let dx = ev.detail.pageX - this.reference!.x;
    let dy = ev.detail.pageY - this.reference!.y;

    if (this.gridAnchor) {//if moving whole clipbox, compensate mouse position with (start) grab position
      dx += this.gridAnchor.left;
      dy += this.gridAnchor.top;
    }

    //some bounds checks:
    if (dx < 0)
      dx = 0;
    else if (dx > this.surface.canvasData!.cssSize.x)
      dx = this.surface.canvasData!.cssSize.x;

    if (dy < 0)
      dy = 0;
    else if (dy > this.surface.canvasData!.cssSize.y)
      dy = this.surface.canvasData!.cssSize.y;

    //sortout dragnodes in respect to current dragnode
    let hPairedNode = null;
    let vPairedNode = null;
    let diagonalNode = null;
    for (let c = 0; c < this.draggers.length; c++) {
      if (this.draggers[c] !== dragNode) {
        if (!hPairedNode && this.draggers[c][DraggerPos].y === dragNode[DraggerPos].y && this.draggers[c][DraggerPos].x !== dragNode[DraggerPos].x) {
          hPairedNode = this.draggers[c];
        } else if (!vPairedNode && this.draggers[c][DraggerPos].x === dragNode[DraggerPos].x && this.draggers[c][DraggerPos].y !== dragNode[DraggerPos].y) {
          vPairedNode = this.draggers[c];
        } else if (!diagonalNode) {
          diagonalNode = this.draggers[c];
        }
      }
    }

    if (!hPairedNode || !vPairedNode) {//draggers have all the same position
      hPairedNode = null;//reset
      vPairedNode = null;
      diagonalNode = null;
      //assign directly:
      for (let c = 0; c < this.draggers.length; c++) {
        if (this.draggers[c] !== dragNode) {
          if (!hPairedNode)
            hPairedNode = this.draggers[c];
          else if (!vPairedNode)
            vPairedNode = this.draggers[c];
          else if (!diagonalNode)
            diagonalNode = this.draggers[c];
        }
      }
    }


    if (!moveGrid && this.aspect > 0 && !(this.fixedSize!.width > 0 || this.fixedSize!.height > 0)) {
      //use smallest displacement voor ratio correction
      if (Math.abs(dx - dragNode[DraggerPos].x) < Math.abs(dy - dragNode[DraggerPos].y)) {
        width = Math.abs(dx - hPairedNode![DraggerPos].x);
        height = width / this.aspect;

        if (dy < vPairedNode![DraggerPos].y)
          dy = vPairedNode![DraggerPos].y - height;
        else if (dy > vPairedNode![DraggerPos].y)
          dy = vPairedNode![DraggerPos].y + height;

        if (dy < 0)
          dy = 0;
        else if (dy > this.surface.canvasData!.cssSize.y)
          dy = this.surface.canvasData!.cssSize.y;
      } else {
        height = Math.abs(dy - vPairedNode![DraggerPos].y);
        width = height * this.aspect;

        if (dx < hPairedNode![DraggerPos].x)
          dx = hPairedNode![DraggerPos].x - width;
        else if (dx > hPairedNode![DraggerPos].x)
          dx = hPairedNode![DraggerPos].x + width;

        if (dx < 0)
          dx = 0;
        else if (dx > this.surface.canvasData!.cssSize.x)
          dx = this.surface.canvasData!.cssSize.x;
      }
    }

    dragNode[DraggerPos] = { x: Math.round(dx), y: Math.round(dy) };
    hPairedNode![DraggerPos].y = Math.round(dy);
    vPairedNode![DraggerPos].x = Math.round(dx);

    if (moveGrid) {//moveing clipbox, then keep orginal width/height
      hPairedNode![DraggerPos].x = Math.round(width + dx);
      vPairedNode![DraggerPos].y = Math.round(height + dy);
    }

    //handling of dragnodes if fixed width or height is given
    if (!moveGrid && (this.fixedSize!.width > 0 || this.fixedSize!.height > 0)) {
      let fixedWidth = this.fixedSize!.width;
      let fixedHeight = this.fixedSize!.height;
      if (this.aspect > 0) {
        if (fixedWidth <= 0)
          fixedWidth = fixedHeight * this.aspect;
        else if (fixedHeight <= 0)
          fixedHeight = fixedWidth / this.aspect;
      }

      if (fixedWidth > 0) {
        width = fixedWidth / (this.surface.canvasData!.scale.x * this.surface.imgData!.scale.x);

        if (hPairedNode![DraggerPos].x < dragNode[DraggerPos].x) {
          //check bounds
          if (dragNode[DraggerPos].x - width < 0) {
            dragNode[DraggerPos].x = Math.round(width);
            vPairedNode![DraggerPos].x = dragNode[DraggerPos].x;
          }
          hPairedNode![DraggerPos].x = Math.round(dragNode[DraggerPos].x - width);
        } else {
          hPairedNode![DraggerPos].x = Math.round(dragNode[DraggerPos].x + width);
        }

      }

      if (fixedHeight > 0) {
        height = fixedHeight / (this.surface.canvasData!.scale.y * this.surface.imgData!.scale.y);
        if (vPairedNode![DraggerPos].y < dragNode[DraggerPos].y) {
          //check bounds
          if (dragNode[DraggerPos].y - height < 0) {
            dragNode[DraggerPos].y = Math.round(height);
            hPairedNode![DraggerPos].y = dragNode[DraggerPos].y;
          }
          vPairedNode![DraggerPos].y = Math.round(dragNode[DraggerPos].y - height);
        } else {
          vPairedNode![DraggerPos].y = Math.round(dragNode[DraggerPos].y + height);
        }
      }

    }

    diagonalNode![DraggerPos] = { x: hPairedNode![DraggerPos].x, y: vPairedNode![DraggerPos].y };

    //sortout positions:
    let topPx = this.draggers[0][DraggerPos].y;
    let rightPx = this.draggers[0][DraggerPos].x;
    let bottomPx = this.draggers[0][DraggerPos].y;
    let leftPx = this.draggers[0][DraggerPos].x;
    for (let c = 1; c < this.draggers.length; c++) {
      if (this.draggers[c][DraggerPos].x > rightPx)
        rightPx = this.draggers[c][DraggerPos].x;

      if (this.draggers[c][DraggerPos].x < leftPx)
        leftPx = this.draggers[c][DraggerPos].x;

      if (this.draggers[c][DraggerPos].y < topPx)
        topPx = this.draggers[c][DraggerPos].y;

      if (this.draggers[c][DraggerPos].y > bottomPx)
        bottomPx = this.draggers[c][DraggerPos].y;
    }

    let d;
    //check if grid is within bounds else correct positions
    if (rightPx > this.surface.canvasData!.cssSize.x) {
      d = this.surface.canvasData!.cssSize.x - rightPx;
      rightPx += d;
      leftPx += d;

      for (let c = 0; c < this.draggers.length; c++)
        this.draggers[c][DraggerPos].x += d;
    }
    if (bottomPx > this.surface.canvasData!.cssSize.y) {
      d = this.surface.canvasData!.cssSize.y - bottomPx;
      bottomPx += d;
      topPx += d;

      for (let c = 0; c < this.draggers.length; c++)
        this.draggers[c][DraggerPos].y += d;
    }

    if (rightPx > this.surface.canvasData!.cssSize.x)
      rightPx = this.surface.canvasData!.cssSize.x;
    if (leftPx < 0)
      leftPx = 0;

    if (bottomPx > this.surface.canvasData!.cssSize.y)
      bottomPx = this.surface.canvasData!.cssSize.y;
    if (topPx < 0)
      topPx = 0;

    this.crop![0] = topPx / this.surface.canvasData!.cssSize.y;
    this.crop![1] = rightPx / this.surface.canvasData!.cssSize.x;
    this.crop![2] = bottomPx / this.surface.canvasData!.cssSize.y;
    this.crop![3] = leftPx / this.surface.canvasData!.cssSize.x;

    //reduce rounding errors of crop size:
    if (this.fixedSize!.width > 0)
      this.crop![1] = this.crop![3] + (this.fixedSize!.width / this.surface.canvasData!.realSize.x);
    if (this.fixedSize!.height > 0)
      this.crop![2] = this.crop![0] + (this.fixedSize!.height / this.surface.canvasData!.realSize.y);
    if (moveGrid) {//moving whole grid
      this.crop![1] = this.crop![3] + this.gridAnchor!.width;
      this.crop![2] = this.crop![0] + this.gridAnchor!.height;
    } else if (this.aspect > 0) {
      if (this.fixedSize!.width === 0) {
        this.crop![1] = this.crop![3] + ((bottomPx - topPx) * this.aspect) / this.surface.canvasData!.cssSize.x;
      } else
        this.crop![2] = this.crop![0] + (rightPx - leftPx) / (this.aspect * this.surface.canvasData!.cssSize.y);
    }

    this.showCrop();
  }

  setAspectratio(aspect: number | RectSize, callback?: (size: RectSize) => void) {
    let crop = null;
    if (typeof aspect === "object") {
      crop = aspect;
      if (!crop || !crop.width || !crop.height)
        aspect = 0;
      else
        aspect = crop.width / crop.height;
    }

    this.aspect = aspect > 0 ? aspect : 0;

    const maxWidth = this.fixedSize!.width > 0 ? this.fixedSize!.width : crop ? crop.width : this.surface.canvasData!.realSize.x;
    const maxHeight = this.fixedSize!.height > 0 ? this.fixedSize!.height : crop ? crop.height : this.surface.canvasData!.realSize.y;
    let width = maxWidth;
    let height = maxHeight;

    if (this.aspect > 0) {//set crop to optimal fit
      height = Math.round(width / this.aspect);
      if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * this.aspect);
      }

      if (this.fixedSize!.width > 0 || this.fixedSize!.height > 0)
        this.fixedSize = { 'width': width, 'height': height };
    }

    if (!this.surface.setBusy(true))
      return;

    const options = {
      width: width || this.surface.canvasData!.realSize.x,
      height: height || this.surface.canvasData!.realSize.y,
      debug: debugFlags.isc
    };
    SmartCrop.crop(this.surface.canvas, options, (result: { topCrop: { x: number; y: number; width: number; height: number } }) => {
      //ADDME:      if (options.debug && result.debugCanvas)
      //        this.tmpcanvas.getContext("2d").drawImage(result.debugCanvas, 0, 0, this.tmpcanvas.width, this.tmpcanvas.height);
      this.setClipValues(result.topCrop.x, result.topCrop.y, result.topCrop.y + result.topCrop.height, result.topCrop.x + result.topCrop.width);
      this.showCrop();
      this.surface.setBusy(false);
      if (callback)
        callback({ 'width': result.topCrop.width, 'height': result.topCrop.height });
    });
  }

  smartCrop(callback?: (size: RectSize) => void) {
    this.setAspectratio(this.options.ratioSize || 0, callback);
  }

  setClipValues(leftPx: number, topPx: number, bottomPx: number, rightPx: number) {
    this.crop![0] = topPx / this.surface.canvasData!.realSize.y;
    this.crop![1] = rightPx / this.surface.canvasData!.realSize.x;
    this.crop![2] = bottomPx / this.surface.canvasData!.realSize.y;
    this.crop![3] = leftPx / this.surface.canvasData!.realSize.x;

    //covert to css positions current canvas
    topPx = Math.round(topPx / (this.surface.imgData!.scale.y * this.surface.canvasData!.scale.y));
    rightPx = Math.round(rightPx / (this.surface.imgData!.scale.x * this.surface.canvasData!.scale.x));
    bottomPx = Math.round(bottomPx / (this.surface.imgData!.scale.y * this.surface.canvasData!.scale.y));
    leftPx = Math.round(leftPx / (this.surface.imgData!.scale.x * this.surface.canvasData!.scale.x));

    this.draggers[0][DraggerPos] = { x: leftPx, y: topPx };
    this.draggers[1][DraggerPos] = { x: leftPx, y: bottomPx };
    this.draggers[2][DraggerPos] = { x: rightPx, y: topPx };
    this.draggers[3][DraggerPos] = { x: rightPx, y: bottomPx };
  }

  setClipCenterValues(w: number, h: number) {
    const leftPx = 0.5 * (this.surface.canvasData!.realSize.x - w);
    const topPx = 0.5 * (this.surface.canvasData!.realSize.y - h);
    const bottomPx = topPx + h;
    const rightPx = leftPx + w;
    this.setClipValues(leftPx, topPx, bottomPx, rightPx);
  }

  setWidth(width: number, fixed: boolean) {
    const inputWidth = Math.round(width);

    if (width > this.surface.canvasData!.realSize.x)
      width = this.surface.canvasData!.realSize.x;
    let height = Math.round(this.crop![2] * this.surface.canvasData!.realSize.y - this.crop![0] * this.surface.canvasData!.realSize.y);

    if (this.aspect > 0 && width > 0) {
      //calc maximal width by given aspectratio
      let aw = this.surface.canvasData!.realSize.x;
      let ah = aw / this.aspect;
      if (ah > this.surface.canvasData!.realSize.y) {
        ah = this.surface.canvasData!.realSize.y;
        aw = ah * this.aspect;
      }
      if (width > aw)
        width = aw;

      height = width / this.aspect;
    }

    if (width < 0)
      width = 0;

    width = Math.round(width);
    height = Math.round(height);

    const isValid = inputWidth === width;
    if (isValid) {
      if (fixed) {
        if (this.fixedSize!.height > 0 && this.fixedSize!.height !== height)
          this.fixedSize!.height = height;
        this.fixedSize!.width = width;
      }

      if (width > 0) {//resize clip area
        this.setClipCenterValues(width, height);
        this.showCrop();
      }
    }

    return isValid;
  }

  setHeight(height: number, fixed: boolean) {
    const inputHeight = Math.round(height);

    if (height > this.surface.canvasData!.realSize.y)
      height = this.surface.canvasData!.realSize.y;
    let width = Math.round(this.crop![1] * this.surface.canvasData!.realSize.x - this.crop![3] * this.surface.canvasData!.realSize.x);

    if (this.aspect > 0 && height > 0) {
      //calc maximal height by given aspectratio
      let aw = this.surface.canvasData!.realSize.x;
      let ah = aw / this.aspect;
      if (ah > this.surface.canvasData!.realSize.y) {
        ah = this.surface.canvasData!.realSize.y;
        aw = ah * this.aspect;
      }
      if (height > ah)
        height = ah;

      width = height * this.aspect;
    }

    if (height < 0)
      height = 0;

    width = Math.round(width);
    height = Math.round(height);

    const isValid = inputHeight === height;
    if (isValid) {
      if (fixed) {
        if (this.fixedSize!.width > 0 && this.surface.canvasData!.realSize.x !== width)
          this.fixedSize!.width = width;
        this.fixedSize!.height = height;
      }
      if (height > 0) {//resize clip area
        this.setClipCenterValues(width, height);
        this.showCrop();
      }
    }

    return isValid;
  }

  showCrop() {
    let x1 = this.draggers[0][DraggerPos].x;
    let y1 = this.draggers[0][DraggerPos].y;
    let x2 = x1;
    let y2 = y1;
    for (let c = 0; c < this.draggers.length; c++) {
      Object.assign(this.draggers[c].style, { top: this.draggers[c][DraggerPos].y + 'px', left: this.draggers[c][DraggerPos].x + 'px' });
      if (c > 0) {
        if (this.draggers[c][DraggerPos].x > x2)
          x2 = this.draggers[c][DraggerPos].x;

        if (this.draggers[c][DraggerPos].x < x1)
          x1 = this.draggers[c][DraggerPos].x;

        if (this.draggers[c][DraggerPos].y < y1)
          y1 = this.draggers[c][DraggerPos].y;

        if (this.draggers[c][DraggerPos].y > y2)
          y2 = this.draggers[c][DraggerPos].y;
      }
    }

    Object.assign(this.gridHolder!.style, {
      top: y1 + 'px',
      right: x2 + 'px',
      bottom: y2 + 'px',
      left: x1 + 'px',
      width: (x2 - x1) + 'px',
      height: (y2 - y1) + 'px'
    });

    const canvasScale = Math.max(0, this.surface.canvasData!.realSize.x / this.surface.viewPort!.x, this.surface.canvasData!.realSize.y / this.surface.viewPort!.y);
    if (this.options.setStatus)
      this.options.setStatus(Math.round((x2 - x1) * canvasScale), Math.round((y2 - y1) * canvasScale), this.surface.canvasData!.realSize.x, this.surface.canvasData!.realSize.y);

    this.masks[0].style.top = (y2 - this.maskSize!.height) + "px";
    this.masks[0].style.left = (x1 - this.maskSize!.width) + "px";
    this.masks[1].style.top = (y1 - this.maskSize!.height) + "px";
    this.masks[1].style.left = x1 + "px";
    this.masks[2].style.top = y1 + "px";
    this.masks[2].style.left = x2 + "px";
    this.masks[3].style.top = y2 + "px";
    this.masks[3].style.left = (x2 - this.maskSize!.width) + "px";
  }

  stop() {
    this.surface.showPreviewCanvas();
    this.cropBox!.remove();
    this.refreshSurface();
  }

  apply() {
    this.surface.showPreviewCanvas();
    if (this.crop![0] === 0 && this.crop![1] === 1 && this.crop![2] === 1 && this.crop![3] === 0)
      return; //no changes

    this.applyCanvas({ crop: this.crop! });
    this.surface.pushUndo({ action: "crop", comp: this, props: { crop: this.crop! }/* , width: this.surface.canvas.width, height: this.surface.canvas.height */, meta: false });
    this.refreshSurface();
  }

  applyCanvas(props: PhotoCropProps) { //props is an array with top,right,bottom,left fractions (0..1)
    const newWidth = Math.round(props.crop[1] * this.surface.canvas.width - props.crop[3] * this.surface.canvas.width);
    const newHeight = Math.round(props.crop[2] * this.surface.canvas.height - props.crop[0] * this.surface.canvas.height);

    //crop image
    const imgData = this.surface.ctx!.getImageData(Math.round(props.crop[3] * this.surface.canvas.width), Math.round(props.crop[0] * this.surface.canvas.height), newWidth, newHeight);
    this.surface.canvas.width = newWidth;
    this.surface.canvas.height = newHeight;
    this.surface.ctx!.putImageData(imgData, 0, 0);

    //correct css styling:
    const canvasScaleX = newWidth / this.surface.viewPort!.x;
    const canvasScaleY = newHeight / this.surface.viewPort!.y;
    let canvasscale = canvasScaleX > canvasScaleY ? canvasScaleX : canvasScaleY;
    if (canvasscale < 1)
      canvasscale = 1;//don't scale up
    this.surface.canvasScale = 1 / canvasscale;

    const cssWidth = Math.round(newWidth / canvasscale);
    const cssHeight = Math.round(newHeight / canvasscale);
    this.surface.canvasData!.cssSize = { 'x': cssWidth, 'y': cssHeight };
    this.surface.canvasData!.scale = { 'x': (newWidth / cssWidth), 'y': (newHeight / cssHeight) };
    //this.surface.canvasData!.realSize = {'x' : Math.round(props.crop[1]*imgedit.canvasdata.realSize.x - props.crop[3]*imgedit.canvasdata.realSize.x), 'y' : Math.round(props.crop[2]*imgedit.canvasdata.realSize.y - props.crop[0]*imgedit.canvasdata.realSize.y)};

    Object.assign(this.surface.canvas.style, {
      width: this.surface.canvasData!.cssSize.x + 'px',
      height: this.surface.canvasData!.cssSize.y + 'px',
      marginLeft: Math.floor(this.surface.canvasData!.cssSize.x * -0.5) + 'px',
      marginTop: Math.floor(this.surface.canvasData!.cssSize.y * -0.5) + 'px'
    });
    this.surface.showScale();
  }
}

export type { PhotoCrop };

export function addImageCropButton(toolbar: Toolbar, surface: ImageSurface, options?: PhotoCropOptions) {
  const cropper = new PhotoCrop(surface, options);

  const button = new ToolbarButton({
    label: getTid("tollium:components.imgedit.editor.crop"),
    icon: toddImages.createImage("tollium:actions/crop", 24, 24, "b"),
    onExecute: () => cropper.startCropping(toolbar)
  });
  toolbar.addButton(button);

  return { button, comp: cropper };
}
