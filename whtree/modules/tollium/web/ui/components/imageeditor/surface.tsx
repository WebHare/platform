import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { type ApplicationBusyLock } from "@mod-tollium/web/ui/js/application";
import { Toolbar, ToolbarButton } from "@mod-tollium/web/ui/components/toolbar/toolbars";
import { PhotoCrop } from "./crop";
import { PhotoRotate } from "./scaling";
import { PhotoFilters } from "./filters";
import { PhotoPoint } from "./refpoint";

require("./imageeditor.lang.json");

export type ImageSurfaceOptions = {
  getBusyLock?: (() => ApplicationBusyLock) | null;
  editorBackground?: string;
  maxLength?: number;
  maxArea?: number;
};

type Size = { x: number; y: number };

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type OffsetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  offsetx: number;
  offsety: number;
};

type EditStep = {
  action: "crop";
  comp: PhotoCrop;
  props: { crop: number[] };
  width: number;
  height: number;
  meta: boolean;
} | {
  action: "rotate";
  props: { angle: number; scale: number };
  comp: PhotoRotate;
  meta: boolean;
} | {
  action: "filters";
  props: { data: unknown };
  comp: PhotoFilters;
  meta: boolean;
} | {
  action: "refpoint";
  props: { refpoint: Size };
  comp: PhotoPoint;
  meta: boolean;
};

//image canvas
export class ImageSurface {
  imgEditorNode: HTMLElement;
  node: HTMLElement;
  img: HTMLImageElement | null = null;
  imgData: {
    size: Size;
    scale: Size;
    orgSize: Size;
    aspect: number;
    orientation: number;
  } | null = null;
  viewPort: Size | null = null;
  canvas: HTMLCanvasElement | null = null;
  canvasData: {
    cssSize: Size;
    scale: Size;
    realSize: Size;
  } | null = null;
  previewCanvas: HTMLCanvasElement | null = null;
  canvasScale = 1;
  previewScale = 1;
  previewRect: OffsetRect | null = null;
  previewMask: Rect | null = null;
  maskCanvas: HTMLCanvasElement | null = null;
  imageLimited = false;
  ctx: CanvasRenderingContext2D | null = null;
  refPoint: Size | null = null;
  orgRefPoint: Size | null = null; // initial reference point, used to reset refpoint on undo
  undoStack: EditStep[] = []; //contains all steps done
  redoStack: EditStep[] = []; //contains all steps undone
  undoButton: ToolbarButton | null = null;
  redoButton: ToolbarButton | null = null;
  busyLock: ApplicationBusyLock | null = null;
  scaleTimeout?: NodeJS.Timeout;
  options: ImageSurfaceOptions = {};

  constructor(imgEditorNode: HTMLElement, toolbar: Toolbar, options?: ImageSurfaceOptions) {
    this.imgEditorNode = imgEditorNode;
    this.options = {
      editorBackground: "",
      maxLength: 0,
      maxArea: 0,
      ...options
    };

    this.node = <div class="wh-image-surface" tabindex="0">
      {this.canvas = <canvas />}
      {this.maskCanvas = <canvas style="position: absolute; left: 0; top: 0; pointer-events: none;" />}
    </div>;
    if (this.options.editorBackground)
      this.node.style.background = this.options.editorBackground;

  }

  fireEvent(name: string, detail?: unknown) {
    dompack.dispatchCustomEvent(this.imgEditorNode, 'tollium-imageeditor:' + name, { bubbles: true, cancelable: false, detail });
  }

  setSize(w: number, h: number) {
    dompack.setStyles(this.node, { width: w, height: h });
    if (this.ctx) {
      this.viewPort = { x: w, y: h };
      this.setupCanvas();
      this.fireEvent("resized", {
        width: w,
        height: h
      });
    }
  }

  setImg(img: HTMLImageElement, settings: { refPoint: Size; orientation: number }) {
    if ("refpoint" in settings) {
      //FIXME there are steps missing in the typescript APIs but once we have types at all stack levels between us and ImageSettings we should rename the fields to fileName and refPoint
      console.warn(`Received refpoint instead of refPoint - should fix caller`);
      //@ts-ignore trust us
      settings = { ...settings, refPoint: settings.refpoint, refpoint: undefined };
    }
    this.orgRefPoint = settings.refPoint;

    this.undoStack = [];
    this.redoStack = [];
    if (this.undoButton)
      this.undoButton.setEnabled(false);
    if (this.redoButton)
      this.redoButton.setEnabled(false);

    const containersize = this.node.getBoundingClientRect();
    this.viewPort = { x: containersize.width, y: containersize.height };
    this.setupFromImage(img, settings.orientation);

    // After setupFromImage, this.canvas is not null
    this.ctx = this.canvas!.getContext("2d");

    this.setupCanvas();
    this.fireEvent('ready', this.imgData);
  }

  // Are there changes?
  isDirty() {
    return this.undoStack.length > 0;
  }

  // Are there image data modifying changes?
  isModified() {
    // Returns true if there is at least one image modifying state on the undo stack
    return this.undoStack.findIndex(function (state) {
      return !state.meta;
    }) >= 0;
  }

  setBusy(busy: boolean) {
    if (!this.options.getBusyLock)
      return true; // No busy lock available
    // If busyLock exists, don't accept 'true' as it's already busy, and vice versa
    if ((this.busyLock !== null) === busy)
      return false; // Already busy

    if (busy) {
      this.busyLock = this.options.getBusyLock();
    } else {
      if (this.busyLock)
        this.busyLock.release();
      this.busyLock = null;
    }
    return true;
  }

  stop() {
  }

  setupFromImage(img: HTMLImageElement, orientation: number) {
    let width = img.width;
    let height = img.height;

    // Restrict image width and height
    if (this.options.maxLength && this.options.maxLength > 0 && (width > this.options.maxLength || height > this.options.maxLength)) {
      const s = this.options.maxLength / Math.max(width, height);
      width = Math.floor(width * s);
      height = Math.floor(height * s);
      this.imageLimited = true;
    }
    // Restrict image area
    if (this.options.maxArea && width * height > this.options.maxArea) {
      const s = Math.sqrt(this.options.maxArea / (width * height));
      width = Math.floor(width * s);
      height = Math.floor(height * s);
      this.imageLimited = true;
    }
    if (this.imageLimited)
      console.warn("Restricting image dimensions from " + img.width + "x" + img.height + " to " + width + "x" + height);

    orientation = orientation || 0;
    const rotated = [5, 6, 7, 8].includes(orientation);
    const scale = { x: 1, y: 1 };//use separate scale x/y for error reduction rounding
    const orgSize = { x: rotated ? height : width, y: rotated ? width : height };

    this.img = img;
    this.imgData = {
      size: { x: rotated ? height : width, y: rotated ? width : height },
      scale: scale,
      orgSize: orgSize,
      aspect: (orgSize.x / orgSize.y),
      orientation: orientation
    };
  }

  setupCanvas() {
    this.refPoint = this.orgRefPoint;
    this.canvas!.width = this.imgData!.size.x;
    this.canvas!.height = this.imgData!.size.y;
    this.maskCanvas!.width = this.viewPort!.x;
    this.maskCanvas!.height = this.viewPort!.y;

    //what scale to use to fit image on canvas in current position
    const canvasScaleX = this.canvas!.width / this.viewPort!.x;
    const canvasScaleY = this.canvas!.height / this.viewPort!.y;
    let canvasScale = canvasScaleX > canvasScaleY ? canvasScaleX : canvasScaleY;
    if (canvasScale < 1)
      canvasScale = 1;//don't scale up
    this.canvasScale = 1 / canvasScale;

    const cssw = Math.round(this.canvas!.width / canvasScale);
    const cssh = Math.round(this.canvas!.height / canvasScale);
    this.canvasData = {
      cssSize: { x: cssw, y: cssh },
      scale: { x: (this.canvas!.width / cssw), y: (this.canvas!.height / cssh) },
      realSize: { x: this.imgData!.orgSize.x, y: this.imgData!.orgSize.y }
    };

    this.canvas!.style.position = "absolute";
    this.canvas!.style.top = '50%';
    this.canvas!.style.left = '50%';
    this.canvas!.style.width = this.canvasData.cssSize!.x + 'px';
    this.canvas!.style.height = this.canvasData.cssSize!.y + 'px';
    this.canvas!.style.marginLeft = Math.ceil(this.canvasData.cssSize!.x * -0.5) + 'px';
    this.canvas!.style.marginTop = Math.ceil(this.canvasData.cssSize!.y * -0.5) + 'px';

    let drawWidth = this.imgData!.size.x;
    let drawHeight = this.imgData!.size.y;
    if ([5, 6, 7, 8].includes(this.imgData!.orientation)) {
      const tmp = drawWidth;
      drawWidth = drawHeight;
      drawHeight = tmp;
    }
    // See: http://stackoverflow.com/a/6010475
    switch (this.imgData!.orientation) {
      case 1: // rotated 0°, not mirrored
        break;
      case 2: // rotated 0°, mirrored
        this.ctx!.scale(-1, 1);
        this.ctx!.translate(-drawWidth, 0);
        break;
      case 3: // rotated 180°, not mirrored
        this.ctx!.translate(drawWidth, drawHeight);
        this.ctx!.rotate(Math.PI);
        break;
      case 4: // rotated 180°, mirrored
        this.ctx!.scale(1, -1);
        this.ctx!.translate(0, -drawHeight);
        break;
      case 5: // rotated 270°, mirrored
        this.ctx!.rotate(-Math.PI / 2);
        this.ctx!.scale(-1, 1);
        break;
      case 6: // rotated 270°, not mirrored
        this.ctx!.translate(drawHeight, 0);
        this.ctx!.rotate(Math.PI / 2);
        break;
      case 7: // rotated 90°, mirrored
        this.ctx!.scale(-1, 1);
        this.ctx!.translate(-drawHeight, drawWidth);
        this.ctx!.rotate(3 * Math.PI / 2);
        break;
      case 8: // rotated 90°, not mirrored
        this.ctx!.translate(0, drawWidth);
        this.ctx!.rotate(3 * Math.PI / 2);
        break;
    }
    this.ctx!.drawImage(this.img!, 0, 0, drawWidth, drawHeight);
    this.showScale();
    this.fireEvent('reset');
  }

  setPreviewCanvas(canvas: HTMLCanvasElement, contentRect?: OffsetRect) {
    const oldcanvas = this.previewCanvas;
    if (this.previewCanvas) {
      this.hidePreviewCanvas();
      this.previewCanvas.remove();
      this.previewCanvas = null;
      this.previewScale = 1;
    }
    if (canvas) {
      this.previewCanvas = canvas;
      this.previewRect = contentRect || {
        left: 0,
        top: 0,
        width: this.previewCanvas.width,
        height: this.previewCanvas.height,
        offsetx: 0,
        offsety: 0
      };
      if (this.previewRect.width > this.viewPort!.x || this.previewRect.height > this.viewPort!.y) {
        this.previewScale = Math.min(this.viewPort!.x / this.previewRect.width, this.viewPort!.y / this.previewRect.height);
        this.previewCanvas.style.transform = "scale(" + this.previewScale + ")";
      } else {
        this.previewScale = 1;
        this.previewCanvas.style.transform = "";
      }

      const left = Math.floor((this.viewPort!.x - this.previewCanvas.width) / 2) - Math.floor(this.previewScale * this.previewRect.offsetx);
      const top = Math.floor((this.viewPort!.y - this.previewCanvas.height) / 2) - Math.floor(this.previewScale * this.previewRect.offsety);
      this.previewCanvas.style.marginLeft = left + "px";
      this.previewCanvas.style.marginTop = top + "px";

      this.previewMask = {
        left: left + Math.floor(this.previewRect.left * this.previewScale) + Math.floor((this.previewCanvas.width - this.previewScale * this.previewCanvas.width) / 2),
        top: top + Math.floor(this.previewRect.top * this.previewScale) + Math.floor((this.previewCanvas.height - this.previewScale * this.previewCanvas.height) / 2),
        width: Math.round(this.previewRect.width * this.previewScale),
        height: Math.round(this.previewRect.height * this.previewScale)
      };
      this.fireEvent("updatepreview", { oldcanvas: oldcanvas });
      this.showPreviewCanvas();
    }
  }

  updateMaskCanvas(contentRect?: Rect) {
    contentRect = contentRect || {
      left: Math.floor((this.maskCanvas!.width - this.canvasData!.cssSize.x) / 2),
      top: Math.floor((this.maskCanvas!.height - this.canvasData!.cssSize.y) / 2),
      width: Math.round(this.canvasData!.cssSize.x),
      height: Math.round(this.canvasData!.cssSize.y)
    };
    const ctx = this.maskCanvas!.getContext("2d");
    if (!ctx)
      return;
    // Clear the mask
    ctx.clearRect(0, 0, this.maskCanvas!.width, this.maskCanvas!.height);
    // Fill with transparent black
    ctx.fillStyle = "rgba(0, 0, 0, .6)";
    ctx.fillRect(0, 0, this.maskCanvas!.width, this.maskCanvas!.height);
    // Cut out the image rect, compensate for scaling
    ctx.clearRect(contentRect.left, contentRect.top, contentRect.width, contentRect.height);
  }

  showPreviewCanvas() {
    if (this.previewCanvas) {
      if (this.canvas?.parentNode)
        this.node.removeChild(this.canvas);
      this.node.insertBefore(this.previewCanvas, this.node.firstChild);
      if (this.maskCanvas && !this.maskCanvas.parentNode)
        this.node.appendChild(this.maskCanvas);
      else if (this.previewMask)
        this.updateMaskCanvas(this.previewMask);
      this.fireEvent("showpreview");
    }
    this.showScale();
  }

  hidePreviewCanvas(hidemask = false) {
    if (this.previewCanvas) {
      this.fireEvent("hidepreview");
      this.node.removeChild(this.previewCanvas);
      this.node.insertBefore(this.canvas!, this.node.firstChild);
      if (hidemask)
        this.node.removeChild(this.maskCanvas!);
      else
        this.updateMaskCanvas();
      this.showScale(this.canvasScale);
    }
  }

  showScale(scale?: number) {
    this.hideScale();
    if (!scale)
      scale = this.previewCanvas ? this.previewScale : this.canvasScale;
    this.node.appendChild(<span class="wh-imageeditor-scale">{Math.round(100 * scale) + "%"}</span>);
    this.scaleTimeout = setTimeout(() => this.hideScale(), 2500);
  }

  hideScale() {
    clearTimeout(this.scaleTimeout);
    dompack.qSA(this.node, ".wh-imageeditor-scale").forEach(node => node.remove());
  }

  apply() {

  }

  pushUndo(state: EditStep, replace_same_action?: boolean) {
    // If pushing the same action, replace the previous state if the redo stack is empty
    if (replace_same_action
      && this.undoStack.length
      && !this.redoStack.length
      && this.undoStack[this.undoStack.length - 1].action === state.action)
      this.undoStack[this.undoStack.length - 1] = state;
    else
      this.undoStack.push(state);
    this.redoStack = [];
    if (this.undoButton)
      this.undoButton.setEnabled(true);
    if (this.redoButton)
      this.redoButton.setEnabled(false);
  }

  popUndo() {
    if (this.undoStack.length === 0)
      return;

    // Remove last action from undo stack and push it to redo stack
    this.redoStack.push(this.undoStack.pop()!);
    if (this.undoButton)
      this.undoButton.setEnabled(this.undoStack.length > 0);
    if (this.redoButton)
      this.redoButton.setEnabled(true);

    // Restore original
    this.setupCanvas();

    // Reconstruct previous actions with minimum steps
    this.undoStack.forEach(step => {
      step.comp.applyCanvas(step.props);
    });

    this.fireEvent("undo");
  }

  popRedo() {
    if (this.redoStack.length === 0)
      return;

    // Remove last action from redo stack and push it to undo stack
    this.undoStack.push(this.redoStack.pop()!);
    if (this.redoButton)
      this.redoButton.setEnabled(this.redoStack.length > 0);
    if (this.undoButton)
      this.undoButton.setEnabled(true);

    // Restore original
    this.setupCanvas();

    // Reconstruct previous actions with minimum steps
    this.undoStack.forEach(step => {
      step.comp.applyCanvas(step.props);
    });

    this.fireEvent("redo");
  }

  cloneCanvas(options?: { clearOriginal: boolean }) {
    const copy = document.createElement("canvas");
    copy.width = this.canvas!.width;
    copy.height = this.canvas!.height;

    const ctx = copy.getContext('2d');
    if (!ctx)
      return;
    ctx.drawImage(this.canvas!, 0, 0);

    if (options?.clearOriginal) {
      this.ctx!.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    }

    return { canvas: copy, ctx };
  }

  static addUndoButton(toolbar: Toolbar, surface: ImageSurface) {
    const button = new ToolbarButton(toolbar,
      {
        label: getTid("~undo"),
        icon: toddImages.createImage("tollium:actions/undo", 24, 24, "b"),
        onExecute: surface.popUndo.bind(surface),
        enabled: false
      });
    toolbar.addButton(button);
    surface.undoButton = button;
    return { button: button };
  }

  static addRedoButton(toolbar: Toolbar, surface: ImageSurface) {
    const button = new ToolbarButton(toolbar,
      {
        label: getTid("~redo"),
        icon: toddImages.createImage("tollium:actions/redo", 24, 24, "b"),
        onExecute: surface.popRedo.bind(surface),
        enabled: false
      });
    toolbar.addButton(button);
    surface.redoButton = button;
    return { button: button };
  }
}
