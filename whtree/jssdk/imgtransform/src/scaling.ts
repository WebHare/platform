import { getTid } from "@mod-tollium/js/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { ToolbarButton, ToolbarSeparator, type Toolbar } from "@mod-tollium/web/ui/components/toolbar/toolbars";

import { ImageToolbarPanel, type SetStatusCallback, type Size } from "./imageeditor";
import type { ImageSurface } from "./surface";
import { SurfaceTool } from "./surfacetool";

type PhotoRotateOptions = {
  setStatus?: SetStatusCallback;
};

export type PhotoRotateProps = {
  angle: number;
  scale: Size;
};

class PhotoRotate extends SurfaceTool {
  options: PhotoRotateOptions;
  angle = 0;
  scale = { x: 1, y: 1 };
  active = false;
  canvasScale = 1;
  scalePanel: ImageToolbarPanel;
  toolbar?: Toolbar;

  constructor(surface: ImageSurface, options?: PhotoRotateOptions) {
    super(surface);

    console.log(`new rotator`, surface, options);

    this.options = {
      ...options
    };

    this.scalePanel = new ImageToolbarPanel("rotate", {
      onClose: () => this.stop(),
      onApply: () => this.apply()
    });
    this.scalePanel.addButton(new ToolbarButton({
      label: getTid("tollium:components.imgedit.editor.rotateleft"),
      icon: toddImages.createImage("tollium:actions/rotateleft", 24, 24, "b"),
      onExecute: () => this.rotate(-90)
    }));
    this.scalePanel.addButton(new ToolbarButton({
      label: getTid("tollium:components.imgedit.editor.rotateright"),
      icon: toddImages.createImage("tollium:actions/rotateright", 24, 24, "b"),
      onExecute: () => this.rotate(90)
    }));
    this.scalePanel.addButton(new ToolbarSeparator);
    this.scalePanel.addButton(new ToolbarButton({
      label: getTid("tollium:components.imgedit.editor.fliphorizontal"),
      icon: toddImages.createImage("tollium:actions/fliphorizontal", 24, 24, "b"),
      onExecute: () => this.fliphorizontal()
    }));
    this.scalePanel.addButton(new ToolbarButton({
      label: getTid("tollium:components.imgedit.editor.flipvertical"),
      icon: toddImages.createImage("tollium:actions/flipvertical", 24, 24, "b"),
      onExecute: () => this.flipvertical()
    }));
  }

  startScaling(toolbar: Toolbar) {
    this.toolbar = toolbar;
    toolbar.activateModalPanel(this.scalePanel);
    this.surface.hidePreviewCanvas();
    this.start();
  }

  start() {

    //initial values
    this.angle = 0;
    this.scale = { x: 1, y: 1 };

    //what scale to use to fit image on canvas in current position
    const canvasscalex = this.surface.canvas.width / this.surface.viewPort!.x;
    const canvasscaley = this.surface.canvas.height / this.surface.viewPort!.y;
    this.canvasScale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;

    //what scale if rotated 90deg.:
    const canvasscalexr = this.surface.canvas.width / this.surface.viewPort!.y;
    const canvasscaleyr = this.surface.canvas.height / this.surface.viewPort!.x;
    this.canvasScale = canvasscalexr > this.canvasScale ? canvasscalexr : this.canvasScale;
    this.canvasScale = canvasscaleyr > this.canvasScale ? canvasscaleyr : this.canvasScale;
    if (this.canvasScale < 1)
      this.canvasScale = 1;//don't scale up
    this.surface.showScale(1 / this.canvasScale);

    this.active = true;

    //resize canvas so it fits if rotated
    const cssw = Math.round(this.surface.canvas.width / this.canvasScale);
    const cssh = Math.round(this.surface.canvas.height / this.canvasScale);
    this.surface.canvasData!.cssSize = { 'x': cssw, 'y': cssh };
    this.surface.canvasData!.scale = { 'x': (this.surface.canvas.width / cssw), 'y': (this.surface.canvas.height / cssh) };

    Object.assign(this.surface.canvas.style, {
      width: this.surface.canvasData!.cssSize.x + 'px',
      height: this.surface.canvasData!.cssSize.y + 'px',
      marginLeft: Math.ceil(this.surface.canvasData!.cssSize.x * -0.5) + 'px',
      marginTop: Math.ceil(this.surface.canvasData!.cssSize.y * -0.5) + 'px'
    });
    this.surface.updateMaskCanvas();

    this.setStatus();
  }

  stop() {
    this.surface.showPreviewCanvas();

    this.scale = { x: 1, y: 1 };
    this.angle = 0;
    this.rotate(0);

    //what scale to use to fit image on canvas in current position
    const canvasscalex = this.surface.canvas.width / this.surface.viewPort!.x;
    const canvasscaley = this.surface.canvas.height / this.surface.viewPort!.y;
    this.canvasScale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
    if (this.canvasScale < 1)
      this.canvasScale = 1;//don't scale up

    this.active = false;
    //resize canvas so it fits if rotated

    const cssw = Math.round(this.surface.canvas.width / this.canvasScale);
    const cssh = Math.round(this.surface.canvas.height / this.canvasScale);
    this.surface.canvasData!.cssSize = { 'x': cssw, 'y': cssh };
    this.surface.canvasData!.scale = { 'x': (this.surface.canvas.width / cssw), 'y': (this.surface.canvas.height / cssh) };

    Object.assign(this.surface.canvas.style, {
      width: this.surface.canvasData!.cssSize.x + 'px',
      height: this.surface.canvasData!.cssSize.y + 'px',
      marginLeft: Math.ceil(this.surface.canvasData!.cssSize.x * -0.5) + 'px',
      marginTop: Math.ceil(this.surface.canvasData!.cssSize.y * -0.5) + 'px'
    });
    this.surface.updateMaskCanvas();
    this.refreshSurface();
  }

  apply() {
    this.surface.showPreviewCanvas();
    this.active = false;

    if (this.angle === 0 && this.scale.x === 1 && this.scale.y === 1)
      return;//no changes

    const newprops = { angle: this.angle, scale: this.scale };
    this.applyCanvas(newprops);

    this.surface.pushUndo({ action: "rotate", comp: this, props: newprops, meta: false });

    //and setback initial values:
    this.scale = { x: 1, y: 1 };
    this.angle = 0;
    this.rotate(0);
  }

  applyCanvas(props: PhotoRotateProps) {
    let newWidth = this.surface.canvas.width;
    let newHeight = this.surface.canvas.height;
    if (Math.round(Math.cos(props.angle * Math.PI / 180) * 100) === 0) {//rotated 90 or 270 deg.
      newWidth = this.surface.canvas.height;
      newHeight = this.surface.canvas.width;

      //switch scalefactors
      const scaleX = this.surface.imgData!.scale.x;
      this.surface.imgData!.scale.x = this.surface.imgData!.scale.y;
      this.surface.imgData!.scale.y = scaleX;

      const rx = this.surface.canvasData!.realSize.x;
      this.surface.canvasData!.realSize.x = this.surface.canvasData!.realSize.y;
      this.surface.canvasData!.realSize.y = rx;
    } else if (Math.round(Math.sin(props.angle * Math.PI / 180) * 100) === 0) {//rotated 0 or 360 deg.
      //no change in dimensions
    } else {//arbitrary angle
      //FIXME?
    }

    let copy;
    if (newWidth !== this.surface.canvas.width) {//resize canvas to fit image
      //Copy image

      let imgData = this.surface.ctx!.getImageData(0, 0, this.surface.canvas.width, this.surface.canvas.height);
      this.surface.ctx!.clearRect(0, 0, this.surface.canvas.width, this.surface.canvas.height);

      const prevWidth = this.surface.canvas.width;
      const prevHeight = this.surface.canvas.height;

      //set needed canvas size to fit rotation
      const max = newHeight > newWidth ? newHeight : newWidth;
      this.surface.canvas.width = max;
      this.surface.canvas.height = max;
      this.surface.ctx!.putImageData(imgData, Math.floor(0.5 * (max - prevWidth)), Math.floor(0.5 * (max - prevHeight)), 0, 0, prevWidth, prevHeight);

      copy = this.surface.cloneCanvas({ clearOriginal: true })!;

      //Rotate and or flip canvas
      this.surface.ctx!.save();
      this.surface.ctx!.setTransform(1, 0, 0, 1, 0, 0);
      this.surface.ctx!.translate(this.surface.canvas.width / 2, this.surface.canvas.height / 2);
      this.surface.ctx!.scale(props.scale.x, props.scale.y);//scaling is -1 or 1 (flip vertical/horizontal)
      this.surface.ctx!.rotate(props.angle * Math.PI / 180);

      //        this.surface.ctx!.globalCompositeOperation = 'copy';//disabled because of bug in webkit
      // as far we use steps of 90deg. this is no problem because we crop the image after rotation
      // will be an issue if we use free rotation
      this.surface.ctx!.drawImage(copy.canvas, -this.surface.canvas.width / 2, -this.surface.canvas.height / 2);
      this.surface.ctx!.restore();

      //crop the transparent parts
      imgData = this.surface.ctx!.getImageData(Math.floor(0.5 * (max - newWidth)), Math.floor(0.5 * (max - newHeight)), newWidth, newHeight);
      this.surface.ctx!.clearRect(0, 0, this.surface.canvas.width, this.surface.canvas.height);

      this.surface.canvas.width = newWidth;
      this.surface.canvas.height = newHeight;
      this.surface.ctx!.putImageData(imgData, 0, 0);
    } else {
      copy = this.surface.cloneCanvas({ clearOriginal: true })!;

      this.surface.ctx!.save();
      this.surface.ctx!.setTransform(1, 0, 0, 1, 0, 0);
      this.surface.ctx!.translate(this.surface.canvas.width / 2, this.surface.canvas.height / 2);
      this.surface.ctx!.scale(props.scale.x, props.scale.y);//scaling is -1 or 1 (flip vertical/horizontal)
      this.surface.ctx!.rotate(props.angle * props.scale.x * props.scale.y * Math.PI / 180);//to rotate correct direction, multiply with scaling which is -1 or 1 (flip vertical/horizontal)

      this.surface.ctx!.drawImage(copy.canvas, -this.surface.canvas.width / 2, -this.surface.canvas.height / 2);
      this.surface.ctx!.restore();
    }

    if (!this.active) {//used if direct call from history
      //what scale to use to fit image on canvas in current position
      const canvasscalex = this.surface.canvas.width / this.surface.viewPort!.x;
      const canvasscaley = this.surface.canvas.height / this.surface.viewPort!.y;
      this.canvasScale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
      if (this.canvasScale < 1)
        this.canvasScale = 1;//don't scale up
    }
    this.surface.canvasScale = 1 / this.canvasScale;

    //correct css position/dimensions
    const cssWidth = Math.round(this.surface.canvas.width / this.canvasScale);
    const cssHeight = Math.round(this.surface.canvas.height / this.canvasScale);

    this.surface.canvasData!.cssSize = { 'x': cssWidth, 'y': cssHeight };
    this.surface.canvasData!.scale = { 'x': (this.surface.canvas.width / cssWidth), 'y': (this.surface.canvas.height / cssHeight) };

    Object.assign(this.surface.canvas.style, {
      width: this.surface.canvasData!.cssSize.x + 'px',
      height: this.surface.canvasData!.cssSize.y + 'px',
      marginLeft: Math.ceil(this.surface.canvasData!.cssSize.x * -0.5) + 'px',
      marginTop: Math.ceil(this.surface.canvasData!.cssSize.y * -0.5) + 'px'
    });
    this.surface.updateMaskCanvas();
    this.surface.showScale();
    this.refreshSurface();
  }

  fliphorizontal() {
    this.scale.x *= -1;
    this.rotate(0);
    this.setStatus();
  }

  flipvertical() {
    this.scale.y *= -1;
    this.rotate(0);
    this.setStatus();
  }

  rotate(degrees: number) {
    this.angle += degrees;
    this.angle -= Math.floor(this.angle / 360) * 360;//keep range between 0 and 360

    this.surface.canvas.style.transform = 'scale(' + this.scale.x + ',' + this.scale.y + ') rotate(' + this.angle + 'deg)';

    this.setStatus();
  }

  setStatus() {
    if (!this.active)
      return;
    let newWidth = this.surface.canvas.width;
    let newHeight = this.surface.canvas.height;
    if (Math.round(Math.cos(this.angle * Math.PI / 180) * 100) === 0) {//rotated 90 or 270 deg.
      newWidth = this.surface.canvas.height;
      newHeight = this.surface.canvas.width;
      this.surface.updateMaskCanvas({
        left: Math.floor((this.surface.maskCanvas.width - this.surface.canvasData!.cssSize.y) / 2),
        top: Math.floor((this.surface.maskCanvas.height - this.surface.canvasData!.cssSize.x) / 2),
        width: this.surface.canvasData!.cssSize.y,
        height: this.surface.canvasData!.cssSize.x
      });
    } else
      this.surface.updateMaskCanvas();
    //ADDME: scaling?
    if (this.options.setStatus)
      this.options.setStatus(newWidth, newHeight);
  }
}

export type { PhotoRotate };

export function addImageRotateButton(toolbar: Toolbar, surface: ImageSurface, options?: PhotoRotateOptions) {
  const rotator = new PhotoRotate(surface, options);

  const button = new ToolbarButton({
    label: getTid("tollium:components.imgedit.editor.rotate"),
    icon: toddImages.createImage("tollium:actions/rotate", 24, 24, "b"),
    onExecute: () => rotator.startScaling(toolbar)
  });
  toolbar.addButton(button);

  return { button: button, comp: rotator };
}
