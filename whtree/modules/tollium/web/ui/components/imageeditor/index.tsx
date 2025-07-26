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

import "./imageeditor.css";
import "./imageeditor.lang.json";
import "../../common.lang.json";
import type { ImgPoint } from "@webhare/imgtransform";

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

export type ImgSize = {
  method?: "none" | "fill" | "fitcanvas" | "scalecanvas" | "stretch" | "fit" | "scale";
  setwidth?: number;
  setheight?: number;
  noforce?: boolean;
  format?: string;
  bgcolor?: string;
  fixorientation?: boolean;
  allowedactions?: ImageAction[];
};

export interface ImageEditorOptions extends ImageSurfaceOptions {
  width?: number;
  height?: number;
  toolbarHeight?: number;
  imgSize?: ImgSize;
  setStatus?: (status: string, warning?: string) => void;
  setModalLayerOpacity?: SetModalLayerOpacityCallback;
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
  fixorientation: boolean = true;
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
      applyIcon: toddImages.createImage("tollium:actions/apply", 24, 24, "b"),
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
      setStatus: (width: number, height: number, orgwidth?: number, orgheight?: number) => this.setStatus(width, height, orgwidth, orgheight)
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
  getImageAsBlob(callback: ExportImageCallback) {
    if (!this.surface.ctx)
      throw new Error(`Cannot export image yet`);

    let canvas = this.surface.canvas;
    let mimeType = this.mimeType;

    const settings = {
      refPoint: this.getFocalPoint()
    };
    if (this.options.imgSize) {
      // If the image didn't actually change, we can return the original blob directly
      if (!this.surface.isModified() && !resizeMethodApplied(this.options.imgSize, canvas.width, canvas.height, mimeType)) {
        // Call callback after a delay; maybe the caller doesn't expect the callback to be called directly
        const blob = this.orgBlob;
        setTimeout(() => callback(blob, settings), 1);
        return;
      }
      const res = resizeCanvasWithMethod(canvas, this.options.imgSize, this.surface.refPoint || this.isRefpointAllowed(), true);
      if (res) {
        if (res.rect && res.rect.refPoint)
          settings.refPoint = {
            x: Math.round(res.rect.refPoint.x),
            y: Math.round(res.rect.refPoint.y)
          };
        canvas = res.canvas;
      }
      mimeType = this.options.imgSize.format || mimeType;
    }

    //WebHare Harescript can only efficiently ScanBlob JPEG, so avoid WEBP/AVIF for now
    canvas.toBlob((blob) => callback(blob, settings), mimeType === 'image/png' ? mimeType : "image/jpeg", 0.85);
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

      this.fixorientation = this.options.imgSize.fixorientation === true;
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
}

function resizeCanvasWithMethod(canvas: HTMLCanvasElement, imgSize: ImgSize, refPoint: RefPoint | boolean, forUpload?: boolean) {
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

    if (resizeMethod === "stretch") {
      // Just stretch to canvas
      imageWidth = canvasWidth;
      imageHeight = canvasHeight;
    } else if (resizeMethod.indexOf("fit") === 0 && imageWidth <= canvasWidth && imageHeight <= canvasHeight) {
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

// Check if the given resize method is applied for an image with given widht, height and MIME type
export function resizeMethodApplied(imgSize: ImgSize, width: number, height: number, mimeType: string) {
  // If preserveifunchanged is not set (unless resize method is "none"), the method is applied
  if (!imgSize.noforce && imgSize.method !== "none")
    return true;

  // If the image doesn't have the expected MIME type, the method is applied
  if (imgSize.format && mimeType !== imgSize.format)
    return true;

  switch (imgSize.method) {
    case "none":
      // The image would not be resized, skip editor
      return false;
    case "fill":
    case "fitcanvas":
    case "scalecanvas":
    case "stretch":
      // Image method is applied if the image doesn't match both the set width and height exactly
      //ADDME: If image has transparency, only skip editor if conversionbackground is transparent
      return width !== imgSize.setwidth || height !== imgSize.setheight;
    case "fit":
      // Image method is applied if the image is bigger than to the set width and/or height
      return (imgSize.setwidth && imgSize.setwidth > 0 && width > imgSize.setwidth)
        || (imgSize.setheight && imgSize.setheight > 0 && height > imgSize.setheight);
    case "scale":
      // Image method is applied if the image size has an incorrect width and/or height
      return (imgSize.setwidth && imgSize.setwidth > 0 && width !== imgSize.setwidth)
        || (imgSize.setheight && imgSize.setheight > 0 && height !== imgSize.setheight);
  }
  // Don't know, assume it's applied
  return true;
}
