// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/imgtransform" {
}

import * as dompack from "@webhare/dompack";
import { ImageEditor } from "./imageeditor";

export type ImgTransformMetadataEvent = CustomEvent<ImgTransformMetadata & ImgTransformSettings>;

declare global {
  interface GlobalEventHandlersEventMap {
    /** Fired whenever image metadata changes */
    "wh-imgtransform:metadata": ImgTransformMetadataEvent;
  }
}

/* we attempt to clean up/define some 'clean' types for images with more common names
   these types don't really exist in the browser - there was WebkitPoint (https://developer.mozilla.org/en-US/docs/Web/API/WebKitPoint)
   which never became Point, and there's DOMPoint that works in 3 dimensions */

export type ImgPoint = {
  x: number;
  y: number;
};

export type ImgSize = {
  width: number;
  height: number;
};

/** ImageEditorSettings represents the non-destructive settings supported by the image editor.
    which is currently only the focal point (filename mimetype etc should not be the editor's problem)
*/
export type ImgTransformSettings = {
  /** Image focal point. null if not yet set*/
  focalPoint: ImgPoint | null;
};

/** Current image metadata */
export type ImgTransformMetadata = {
  imgSize: ImgSize;
};

export type ImgTransformSaveOptions = {
  /** Type. Browsers default to image/png (and also pick that if the requested type is unsupported. See also https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) */
  type?: string;
  /** Quality for lossy formats, between 0 and 1. Defaults to 0.85 if not set */
  quality?: number;
};


//stylesheet for when running in Shadow mode
const stylesheet = `
:host {
  overflow: hidden;
  display: inline-block;
  position: relative;
}

.wh-toolbar,
.wh-toolbar-panel
{
  height: 72px;
}

.wh-toolbar-modalholder,
.wh-toolbar-panel
{
  display: flex;
  flex-wrap: nowrap;
  flex: 1;
}

.wh-toolbar-panel
{
  order: 1;
}

.wh-toolbar-modalbuttons
{
  display: flex; /* remove to show apply and cancel buttons at the right side of the toolbar */
  flex: 0;
  order: 2;
  text-align: right;
}

.wh-toolbar .wh-toolbar-button
{
  border: none;
  border-radius: 2px;
  cursor: pointer;
  display: inline-block;
  font-size: 11px;
  height: 72px;
  line-height: inherit;
  margin: 0;
  min-width: 73px;
  overflow: hidden;
  padding: 16px 4px;
  position: relative;
  text-align: center;
  vertical-align: top;
  white-space: nowrap;
}

.wh-toolbar .wh-toolbar-button > span
{
  display: block;
  overflow: hidden;
  pointer-events: none;
  text-align: center !important;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wh-toolbar .wh-toolbar-button:active > span
{
  left:1px;
  position:relative;
  top:1px;
}
.wh-toolbar .wh-toolbar-button.disabled:active > span
{
  left: 0;
  top: 0;
}

.wh-toolbar .wh-toolbar-button img
{
  height: 24px;
  margin: 0;
  pointer-events: none;
  width: 24px;
}

.wh-toolbar .wh-toolbar-button:active img
{
  left: 1px;
  top: 1px;
  position: relative;
}

.wh-toolbar .wh-toolbar-button.disabled
{
  cursor: default;
}

.wh-toolbar .wh-toolbar-button.disabled.pressed span,
.wh-toolbar .wh-toolbar-button.disabled:active span,
.wh-toolbar .wh-toolbar-button.disabled:active img
{
  left: 0;
  top: 0;
}

.wh-toolbar .wh-toolbar-button:hover img
{
  opacity: 1;
}

.wh-toolbar .wh-toolbar-button + .wh-toolbar-button
{
  margin-left: 4px;
}
.wh-toolbar .wh-toolbar-separator
{
  display: inline-block;
  height: 100%;
  margin: 2px 8px 0 8px;
  position: relative;
  vertical-align: top;
  width: 0;
}
.wh-toolbar .wh-toolbar-separator:before
{
  border-color: inherit;
  border-style: solid;
  border-width: 1px;
  bottom:18px;
  content: "";
  position: absolute;
  top: 12px;
  width:0;
}

.wh-holder
{
  box-sizing:border-box;
}
.wh-toolbar
{
}
.wh-toolbar > *:not(.open)
{
  display:none;
}

/***************
 * this is a straight cop from imageeditor.css
 * */
.wh-imageeditor-fullscreen
{
  position: fixed;
  z-index: 1000;
  top:0;
  left:0;
  bottom:0;
  right:0;
  background:#dddddd;
}

.wh-image-surface
{
  position:relative;
  overflow:hidden;
  /*checkerboard*/
  background: #ccc url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAIUlEQVQ4y2P4jxecwQsYRjWPaiaoGb80fqNHNY9qJqgZAP2BNAVlXUe2AAAAAElFTkSuQmCC) 0 0 repeat;
}

  .wh-cropbox
, .wh-refbox
{
  position:absolute;
  margin:0 auto;
  z-index: 0;
}
  .wh-cropbox-mask
, .wh-cropbox-img
{
  position:absolute;
  top:0;
  right:0;
  left:0;
  bottom:0;
  width:inherit;
  height:inherit;
  overflow: hidden;
}

.wh-cropbox-mask
{
  background-color: #000;
  opacity:0.6;
  position: absolute;
  z-index: 1;
}
.wh-cropbox-dragger
{
  position:absolute;
  border:1px solid #fff;
  background-color: green;
  width:16px;
  height:16px;
  border-radius:8px;
  margin:-9px;
  cursor:pointer;
  z-index: 2;
}
.wh-cropbox-viewport
{
  position:absolute;
  border:1px solid #000;
  cursor:pointer;
  width:inherit;
  height:inherit;
}
.wh-cropbox-viewport > div
{
  position:absolute;
  background-color: #000;
}
  .wh-cropbox-viewport .vline1
, .wh-cropbox-viewport .vline2
{
  height:inherit;
  width:1px;
  top:0;
  bottom:0;
}
.wh-cropbox-viewport .vline1
{
  left:33%;
}
.wh-cropbox-viewport .vline2
{
  right:33%;
}

  .wh-cropbox-viewport .hline1
, .wh-cropbox-viewport .hline2
{
  height:1px;
  width:inherit;
  left:0;
  right:0;
}
.wh-cropbox-viewport .hline1
{
  top:33%;
}
.wh-cropbox-viewport .hline2
{
  bottom:33%;
}

.wh-refbox > canvas
{
  cursor: crosshair;
}

.wh-refbox-pointer
{
  background: transparent;
  border: 5px solid green;
  border-radius: 100%;
  cursor: move;
  height: 16px;
  margin-left: -8px;
  margin-top: -8px;
  position: absolute;
  width: 16px;
}

`;

export class ImgTransformElement extends HTMLElement {
  #editor!: ImageEditor;
  static observedAttributes = ["focalpoint"];

  constructor() {
    super();

    /* init the component in the connectedCallback (or when a method is called), sp
       we can read the attributes and set the initial state
    */
  }

  initEditor() {
    if (this.#editor)
      return;

    const imgSize = this.hasAttribute("imgsize") ? JSON.parse(this.getAttribute("imgsize")!) : undefined;

    this.#editor = new ImageEditor(this, {
      onMetadataChange: () => this.#broadcastMetadata(),
      imgSize,
    }, true);
    this.attributeChangedCallback();

    const styleSheet = document.createElement("style");
    styleSheet.innerText = stylesheet;
    this.shadowRoot?.prepend(styleSheet);
  }

  connectedCallback() {
    this.initEditor();
  }

  #broadcastMetadata() {
    dompack.dispatchCustomEvent(this, "wh-imgtransform:metadata", {
      bubbles: true,
      cancelable: false,
      detail: {
        focalPoint: this.#editor.surface.refPoint,
        imgSize: {
          width: this.#editor.surface.canvasData!.realSize.x ?? this.#editor.surface.imgData!.size.x,
          height: this.#editor.surface.canvasData!.realSize.y ?? this.#editor.surface.imgData!.size.y
        }
      }
    });
  }

  attributeChangedCallback(/*name: string, oldValue: string, newValue: string*/) {
    this.#editor.pointer.button.node.style.display = this.hasAttribute("focalpoint") ? "" : "none";
  }

  /** Load a blob into the canvas  */
  async loadImage(image: Blob, settings?: Partial<ImgTransformSettings>): Promise<void> {
    this.initEditor();

    // Cancel current modal edits
    this.#editor.cancelModalEdits();

    //We use Blob because we're most likely to work and return uploads. Image elements just complicate load/error handling
    //Not sure if we need to care about EXIF? https://github.com/whatwg/html/issues/7210 suggests al browsers apply EXIF orientation
    const bitmap = await createImageBitmap(image);
    this.#editor.surface.setImgBitmap(bitmap, {
      focalPoint: null,
      ...settings
    });
  }

  async saveImage(options?: ImgTransformSaveOptions): Promise<{
    blob: Blob;
    settings: ImgTransformSettings;
  }> {
    this.initEditor();

    // Apply current modal edits
    this.#editor.applyModalEdits();

    //WebHare Harescript can only efficiently ScanBlob JPEG, so avoid WEBP/AVIF for now
    const type = options?.type === "image/png" ? "image/png" : "image/jpeg";
    const quality = options?.quality ?? 0.85;
    if (quality < 0 || quality > 1) //"is a number in the range 0.0 to 1.0 inclusive"
      throw new Error("Quality must be between 0 and 1");

    const blob = await new Promise<Blob | null>(resolve => this.#editor.surface.canvas.toBlob(resolve, type, quality));
    if (!blob)
      throw new Error("Failed to save image");

    return {
      blob,
      settings: { focalPoint: this.#editor.getFocalPoint() }
    };
  }
}
