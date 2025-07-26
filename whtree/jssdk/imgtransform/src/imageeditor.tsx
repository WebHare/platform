import * as dompack from "dompack";

import { getTid } from "@webhare/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { Toolbar, type ToolbarButton, ToolbarSeparator } from "@mod-tollium/web/ui/components/toolbar/toolbars";
import type * as $todd from "@mod-tollium/web/ui/js/support";
import type { ObjFrame } from '@mod-tollium/webdesigns/webinterface/components/frame/frame';

import { type PhotoCrop, addImageCropButton } from "./crop";
import { type PhotoPoint, addRefPointButton } from "./refpoint";
import { type PhotoRotate, addImageRotateButton } from "./scaling";
import { type ImageSurfaceSettings, ImageSurface, type ImageSurfaceOptions } from "./surface";

import "@mod-tollium/web/ui/components/imageeditor/imageeditor.lang.json"; //TODO gettid system currently cant read from a JSSDK folder. our caller will have to register texts
import "@mod-tollium/web/ui/common.lang.json"; //TODO that's a lot of texts from which we only need a small part
import type { ImgPoint } from "./imgtransform";
import type { ResizeMethodName } from "@webhare/services/src/descriptor";

// Impose some limits on image sizes
//ADDME: Should these be different for other platforms, e.g. mobile?
const MAX_IMAGE_LENGTH = 32767; // Max length of one size
const MAX_IMAGE_AREA = 15000000; // Max number of pixels

/*
Supported debug flags:
  isc Set SmartCrop debug flag
  */

export type Size = { x: number; y: number };
export type RefPoint = Size;
export type RectSize = { width: number; height: number };
export type Rect = RectSize & { left: number; top: number };
export type OffsetRect = Rect & { offsetx: number; offsety: number };
export type OffsetRectWithRefpoint = OffsetRect & { refPoint?: RefPoint };

export type SetStatusCallback = (width: number, height: number, orgwidth?: number, orgheight?: number) => void;
export type ExportImageCallback = (blob: Blob | null, settings: { refPoint: RefPoint | null }) => void;
export type SetProgressCallback = (value: number, max: number) => void;
export type CreateScreenCallback = (components: $todd.ComponentsForMessages) => ObjFrame;
export type SetModalLayerOpacityCallback = (opacity: number) => void;

type ImageAction = "all" | "crop" | "rotate" | "refpoint";

export type LegacyImgSize = {
  method?: ResizeMethodName;
  setwidth?: number;
  setheight?: number;
  noforce?: boolean;
  format?: string;
  bgcolor?: string;
  allowedactions?: ImageAction[];
};

export interface ImageEditorOptions extends ImageSurfaceOptions {
  width?: number;
  height?: number;
  toolbarHeight?: number;
  imgSize?: LegacyImgSize;
  setStatus?: (status: string, warning?: string) => void;
  setModalLayerOpacity?: SetModalLayerOpacityCallback;
  onMetadataChange?: () => void;
}

export class ImageEditor {
  readonly el: HTMLElement;
  readonly toolbar: Toolbar;
  readonly surface: ImageSurface;
  undoButton: ToolbarButton;
  redoButton: ToolbarButton;
  cropper: { button: ToolbarButton; comp: PhotoCrop };
  rotator: { button: ToolbarButton; comp: PhotoRotate };
  pointer: { button: ToolbarButton; comp: PhotoPoint };
  mimeType = "";
  fileName = "";
  orgBlob: Blob | null = null;
  cropSize: RectSize | null = null;
  cropRatio: RectSize | null = null;
  allowedactions: ImageAction[] = [];
  previewing: boolean = false;
  dirty: boolean = false;
  options: ImageEditorOptions;

  constructor(el: HTMLElement, options?: ImageEditorOptions, __shadowroot?: true) {
    this.el = el;
    const host = __shadowroot ? this.el.attachShadow({ mode: "open" }) : this.el;

    this.options = {
      width: 640,
      height: 320, //ADDME default toolbar height!
      toolbarHeight: 72,
      editorBackground: "",
      maxLength: MAX_IMAGE_LENGTH,
      maxArea: MAX_IMAGE_AREA,
      ...options
    };

    this.toolbar = new Toolbar({
      applyIcon: toddImages.createImage("tollium:actions/accept", 24, 24, "b"),
      applyLabel: getTid("~apply"),
      closeIcon: toddImages.createImage("tollium:actions/cancel", 24, 24, "b"),
      closeLabel: getTid("~cancel")
    });
    this.surface = new ImageSurface(this.el, this.toolbar, options);
    this.el.addEventListener("tollium-imageeditor:ready", evt => this.onLoad(evt as CustomEvent));
    this.el.addEventListener("tollium-imageeditor:refresh", () => this.previewImgSize());
    this.el.addEventListener("tollium-imageeditor:undo", () => this.previewImgSize());
    this.el.addEventListener("tollium-imageeditor:redo", () => this.previewImgSize());

    host.replaceChildren(this.toolbar.node, this.surface.node);
    this.setSize(this.options.width!, this.options.height!);

    // Add toolbar buttons
    this.undoButton = ImageSurface.addUndoButton(this.toolbar, this.surface).button;
    this.redoButton = ImageSurface.addRedoButton(this.toolbar, this.surface).button;
    this.toolbar.addButton(new ToolbarSeparator);

    this.cropper = addImageCropButton(this.toolbar, this.surface, {
      fixedSize: this.cropSize || undefined,
      ratioSize: this.cropRatio || undefined,
      setStatus: (width: number, height: number, orgwidth?: number, orgheight?: number) => this.setStatus(width, height, orgwidth, orgheight)
    });
    this.rotator = addImageRotateButton(this.toolbar, this.surface, {
      setStatus: (width: number, height: number, orgwidth?: number, orgheight?: number) => this.setStatus(width, height, orgwidth, orgheight),
    });
    this.pointer = addRefPointButton(this.toolbar, this.surface, {
      setStatus: (width: number, height: number, orgwidth?: number, orgheight?: number) => this.setStatus(width, height, orgwidth, orgheight)
    });
    if (this.options.imgSize) {
      this.previewing = true;
      this.applyImgSize();
    }
  }

  onLoad(event: CustomEvent) {
    this.previewImgSize();
    this.surface.fireEvent("load", { target: this, width: event.detail.size.x, height: event.detail.size.y }); //who was listening ??
  }
  setSize(w: number, h: number) {
    this.toolbar.setSize(w, this.options.toolbarHeight!);
    this.surface.setSize(w, h - this.options.toolbarHeight!);
    this.previewImgSize();
  }
  setImg(img: HTMLImageElement, options: ImageSurfaceSettings & {
    mimetype: string;
    filename: string;
    orgblob: null;
  }) {
    this.mimeType = options.mimetype;
    this.fileName = options.filename;
    this.orgBlob = options.orgblob;
    this.surface.setImg(img, options);
  }
  getFocalPoint(): ImgPoint | null {
    return this.surface.refPoint ? { //They're integers in HS so we'll keep rounding for now
      x: Math.round(this.surface.refPoint.x),
      y: Math.round(this.surface.refPoint.y)
    } : null;
  }
  stop() {
    this.surface.stop();
  }
  isDirty() {
    return this.dirty || this.surface.isDirty();
  }
  applyImgSize() {
    if (this.options.imgSize) {
      if (this.options.imgSize.setwidth && this.options.imgSize.setwidth > 0 && this.options.imgSize.setheight && this.options.imgSize.setheight > 0) {
        this.cropRatio = {
          width: this.options.imgSize.setwidth,
          height: this.options.imgSize.setheight
        };
        if (this.cropper)
          this.cropper.comp.options.ratioSize = this.cropRatio;
      }

      this.allowedactions = this.options.imgSize.allowedactions ?? [];
    } else {
      this.allowedactions = [];
    }

    this.updateActionButtons();
    this.previewImgSize();
  }
  previewImgSize() {
    if (!this.surface.ctx)
      return; //not ready yet

    const canvas = this.surface.canvas;

    if (this.previewing && this.options.imgSize) {
      const resized = resizeCanvasWithMethod(canvas, this.options.imgSize, this.surface.refPoint || this.isRefpointAllowed());
      if (resized) {
        this.surface.setPreviewCanvas(resized.canvas, resized.rect);
        this.setStatus(resized.rect ? resized.rect.width : resized.canvas.width,
          resized.rect ? resized.rect.height : resized.canvas.height,
          canvas.width, canvas.height);
      } else {
        this.surface.setPreviewCanvas(null);
        this.setStatus(canvas.width, canvas.height);
      }
      this.previewing = true;
    }
  }
  setStatus(width: number, height: number, orgwidth = 0, orgheight = 0) {
    if (!this.options.setStatus)
      return;
    const status = (this.fileName ? this.fileName + ": " : "")
      + width + "\u00d7" + height
      + (orgwidth && orgheight ? " (" + orgwidth + "\u00d7" + orgheight + ")" : "");
    const minwarning = (orgwidth > 0 && orgwidth < width) || (orgheight > 0 && orgheight < height);
    const maxwarning = (orgwidth > 0 || orgheight > 0)
      && this.surface.imageLimited
      && !this.surface.undoStack.some(item => item.action === "crop");
    this.options.setStatus(status, minwarning ? "min" : maxwarning ? "max" : undefined);
  }
  updateActionButtons() {
    const allallowed = this.allowedactions.indexOf("all") >= 0;
    this.cropper.button.node.style.display = allallowed || this.allowedactions.indexOf("crop") >= 0 ? "" : "none";
    this.rotator.button.node.style.display = allallowed || this.allowedactions.indexOf("rotate") >= 0 ? "" : "none";
    this.pointer.button.node.style.display = this.isRefpointAllowed() ? "" : "none";
  }
  isRefpointAllowed() {
    // Setting the reference point only makes sense if the image is not resized (it may be resized in the image cache using
    // the reference point) or if the resize method is fill (which actually crops the image). It is not enabled when 'all'
    // actions are allowed; it has to be enabled explicitly.
    const methodRefPoint = !this.options.imgSize || this.options.imgSize.method === "none" || this.options.imgSize.method === "fill";
    return methodRefPoint && this.allowedactions.indexOf("refpoint") >= 0;
  }
  cancelModalEdits() {
    this.toolbar.onModalCancel();
  }
  applyModalEdits() {
    this.toolbar.onModalApply();
  }
}

function resizeCanvasWithMethod(canvas: HTMLCanvasElement, imgSize: LegacyImgSize, refPoint: RefPoint | boolean, forUpload?: boolean) {
  let resizeMethod = imgSize.method;
  if (!resizeMethod)
    return;

  if (resizeMethod === "none") {
    // Use 'fill' method for previewing refpoint when method is 'none'
    if (refPoint && !forUpload)
      resizeMethod = "fill";
    else
      return;
  }

  let canvasWidth = imgSize.setwidth ?? 0;
  let canvasHeight = imgSize.setheight ?? 0;
  if (canvasWidth || canvasHeight) {
    let imageWidth = canvas.width;
    let imageHeight = canvas.height;
    let imageTop = 0;
    let imageLeft = 0;
    if (!canvasWidth) {
      // If only height is restricted, scale width proportionally
      canvasWidth = Math.round(canvasHeight * imageWidth / imageHeight);
    } else if (!canvasHeight) {
      // If only width is restricted, scale height proportionally
      canvasHeight = Math.round(canvasWidth * imageHeight / imageWidth);
    }

    if (resizeMethod.indexOf("fit") === 0 && imageWidth <= canvasWidth && imageHeight <= canvasHeight) {
      // Don't resize
      if (resizeMethod === "fit") {
        canvasWidth = imageWidth;
        canvasHeight = imageHeight;
      }
    } else if (canvasWidth / canvasHeight > imageWidth / imageHeight) {
      // canvas is more wide than image
      if (resizeMethod.indexOf("scale") === 0
        || (resizeMethod.indexOf("fit") === 0 && imageHeight > canvasHeight)) {
        // Scale width proportionally, keep height
        imageWidth = Math.round(canvasHeight * imageWidth / imageHeight);
        imageHeight = canvasHeight;
        // If not scaling to canvas, only keep image width
        if (resizeMethod.indexOf("canvas") < 0)
          canvasWidth = imageWidth;
      } else if (resizeMethod === "fill") {
        // Scale height proportionally, keep width
        imageHeight = Math.round(canvasWidth * imageHeight / imageWidth);
        imageWidth = canvasWidth;
      }
    } else {
      // canvas is more tall than image
      if (resizeMethod.indexOf("scale") === 0
        || (resizeMethod.indexOf("fit") === 0 && imageWidth > canvasWidth)) {
        // Scale height proportionally, keep width
        imageHeight = Math.round(canvasWidth * imageHeight / imageWidth);
        imageWidth = canvasWidth;
        // If not scaling to canvas, only keep image height
        if (resizeMethod.indexOf("canvas") < 0)
          canvasHeight = imageHeight;
      } else if (resizeMethod === "fill") {
        // Scale width proportionally, keep height
        imageWidth = Math.round(canvasHeight * imageWidth / imageHeight);
        imageHeight = canvasHeight;
      }
    }

    // Center image
    imageTop = Math.round((canvasHeight - imageHeight) / 2);
    imageLeft = Math.round((canvasWidth - imageWidth) / 2);

    let rect: OffsetRectWithRefpoint | undefined;
    if (resizeMethod === "fill") {
      // When filling, either top or left is 0, the other is <0
      rect = {
        left: Math.abs(imageLeft),
        top: Math.abs(imageTop),
        offsetx: 0,
        offsety: 0,
        width: canvasWidth,
        height: canvasHeight,
      };
      if (refPoint && refPoint !== true) {
        if (!rect.left) {
          const curtop = rect.top;
          const scalex = imageWidth / canvas.width;
          rect.top = (refPoint.y * scalex / imageHeight) * (imageHeight - canvasHeight);
          rect.offsety = rect.top - curtop;
          rect.refPoint = {
            x: refPoint.x * scalex,
            y: refPoint.y * scalex - rect.top
          };
        } else if (!rect.top) {
          const curleft = rect.left;
          const scaley = imageHeight / canvas.height;
          rect.left = (refPoint.x * scaley / imageWidth) * (imageWidth - canvasWidth);
          rect.offsetx = rect.left - curleft;
          rect.refPoint = {
            x: refPoint.x * scaley - rect.left,
            y: refPoint.y * scaley
          };
        }
      }

      if (!forUpload) {
        canvasWidth = imageWidth;
        canvasHeight = imageHeight;
        imageTop = 0;
        imageLeft = 0;
      } else {
        imageTop -= rect.offsety;
        imageLeft -= rect.offsetx;
      }
    }

    // Create the resized canvas
    const resized: HTMLCanvasElement = <canvas width={canvasWidth} height={canvasHeight} />;
    const ctx = resized.getContext("2d")!;
    // Set background color, if specified
    if (imgSize.bgcolor && imgSize.bgcolor !== "transparent") {
      ctx.fillStyle = imgSize.bgcolor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    // Draw (and possibly resize) the editor image onto the resized canvas
    ctx.drawImage(canvas, imageLeft, imageTop, imageWidth, imageHeight);
    return { canvas: resized, rect: rect };
  }
}
