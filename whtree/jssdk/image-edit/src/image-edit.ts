/* we attempt to clean up/define some 'clean' types for images with more common names
   these types don't really exist in the browser - there was WebkitPoint (https://developer.mozilla.org/en-US/docs/Web/API/WebKitPoint)
   which never became Point, and there's DOMPoint that works in 3 dimensions */

export type ImagePoint = {
  x: number;
  y: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

/** ImageEditorSettings represents the non-destructive settings supported by the image editor.
    which is currently only the focal point (filename mimetype etc should not be the editor's problem)
*/
export type ImageEditSettings = {
  /** Image focal point. null if not yet set*/
  focalPoint: ImagePoint | null;
};

/** Current image metadata */
export type ImageEditMetadata = {
  imageSize: ImageSize;
};

import { ImageEditor, type ImageEditorOptions } from "@mod-tollium/web/ui/components/imageeditor";

//stylesheet for when running in Shadow mode
const stylesheet = ` //copied from apps.css
/****************************************************************************************************************************
 * Image editor
 */

.wh-toolbar,
.wh-toolbar-panel
{
  height: 72px;
}

.wh-toolbar-modalholder
{
  display: flex;
  flex-wrap: nowrap;
}

.wh-toolbar-modalbuttons
{
  display: none; /* remove to show apply and cancel buttons at the right side of the toolbar */
  flex: 1;
  order: 2;
  text-align: right;
}

.wh-toolbar-panel
{
  flex: 0 0 100%;
  order: 1;
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
.wh-toolbar > *
{
  display:none;
}
.wh-toolbar > *.open
{
  display: block;
}
.wh-toolbar-panel > *,
.wh-toolbar-modalholder > *
{
  display: inline-block;
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
, .wh-filterbox
, .wh-refbox
{
  position:absolute;
  margin:0 auto;
}
  .wh-cropbox .wh-cropbox-mask
, .wh-cropbox .wh-cropbox-img
, .wh-filterbox .wh-filterbox-img
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

.wh-cropbox .wh-cropbox-mask
{
  background-color: #000;
  opacity:0.6;
  position: absolute;
}
.wh-cropbox .wh-cropbox-dragger
{
  position:absolute;
  border:1px solid #fff;
  background-color: green;
  width:16px;
  height:16px;
  border-radius:8px;
  margin:-9px;
  cursor:pointer;
}
.wh-cropbox .wh-cropbox-viewport
{
  position:absolute;
  border:1px solid #000;
  cursor:pointer;
  width:inherit;
  height:inherit;
}
.wh-cropbox .wh-cropbox-viewport > div
{
  position:absolute;
  background-color: #000;
}
  .wh-cropbox .wh-cropbox-viewport .vline1
, .wh-cropbox .wh-cropbox-viewport .vline2
{
  height:inherit;
  width:1px;
  top:0;
  bottom:0;
}
.wh-cropbox .wh-cropbox-viewport .vline1
{
  left:33%;
}
.wh-cropbox .wh-cropbox-viewport .vline2
{
  right:33%;
}

  .wh-cropbox .wh-cropbox-viewport .hline1
, .wh-cropbox .wh-cropbox-viewport .hline2
{
  height:1px;
  width:inherit;
  left:0;
  right:0;
}
.wh-cropbox .wh-cropbox-viewport .hline1
{
  top:33%;
}
.wh-cropbox .wh-cropbox-viewport .hline2
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

export class ImageEditElement extends HTMLElement {
  private editor: ImageEditor;

  constructor() {
    super();
    this.editor = new ImageEditor(this, {}, true);

    const styleSheet = document.createElement("style");
    styleSheet.innerText = stylesheet;
    this.shadowRoot?.prepend(styleSheet);
  }

  /** Load a blob into the canvas  */
  async loadImage(image: Blob, settings?: Partial<ImageEditorSettings>): Promise<void> {

    //We use Blob because we're most likely to work and return uploads. Image elements just complicate load/error handling
    //Not sure if we need to care about EXIF? https://github.com/whatwg/html/issues/7210 suggests al browsers apply EXIF orientation
    const bitmap = await createImageBitmap(image);
    this.editor.surface.setImgBitmap(bitmap, {
      focalPoint: null,
      ...settings
    });
  }

}

export { type ImageEditorOptions };
