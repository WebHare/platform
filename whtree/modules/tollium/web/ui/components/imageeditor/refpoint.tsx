import * as dompack from "dompack";
import * as movable from "dompack/browserfix/movable";
import Keyboard from "dompack/extra/keyboard";

import { getTid } from "@mod-tollium/js/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import { ToolbarButton, type Toolbar } from "@mod-tollium/web/ui/components/toolbar/toolbars";
import type { RefPoint } from "@mod-tollium/web/ui/js/dialogs/imgeditcontroller";

import { ImageToolbarPanel, Size } from ".";
import type { ImageSurface } from "./surface";
import { SurfaceTool } from "./surfacetool";

import "./imageeditor.lang.json";

// Set to true to activate 'inline' mode, without the modal toolbar
const tool_inline = false;

let buttonicon: HTMLImageElement;

export type PhotoPointProps = {
  refPoint: Size | null;
};

type PhotoPointOptions = {
  // no options yet
};

class PhotoPoint extends SurfaceTool {
  refPoint: RefPoint | null = null;
  reference: {
    abspos: Size;
    relpos: Size;
    imgsize: Size;
    canvasscale: number;
  } | null = null;
  isActive = false;
  activated = false;
  options: PhotoPointOptions;
  refPointPanel: ImageToolbarPanel;
  deleteButton: ToolbarButton;
  keyboard: Keyboard;
  _setPoint: (event: MouseEvent) => void;
  refPointer: HTMLDivElement | null = null;

  constructor(surface: ImageSurface, options?: PhotoPointOptions) {
    super(surface);

    this.options = { ...options };

    this.refPointPanel = new ImageToolbarPanel("refpoint", {
      onClose: () => this.stop(),
      onApply: () => this.apply()
    });

    this.deleteButton = new ToolbarButton(this.refPointPanel, {
      label: getTid("tollium:components.imgedit.editor.delrefpoint"),
      icon: toddImages.createImage("tollium:actions/delete", 24, 24, "b"),
      onExecute: () => this.clearPoint()
    });
    this.refPointPanel.addButton(this.deleteButton);

    this._setPoint = (event: MouseEvent) => this.setPoint(event);
    this.keyboard = new Keyboard(this.surface.node, { Delete: () => this.clearPoint() });
    if (tool_inline) {
      this.surface.eventTarget.addEventListener("tollium-imageeditor:reset", () => this.resetPoint());
      this.surface.eventTarget.addEventListener("tollium-imageeditor:showpreview", () => this.activate(true));
      this.surface.eventTarget.addEventListener("tollium-imageeditor:hidepreview", () => this.activate(false));
    } else {
      this.surface.eventTarget.addEventListener("tollium-imageeditor:updatepreview", (evt: Event) => this.previewCanvasChanged(evt as CustomEvent));
    }
  }

  togglePointing(button: ToolbarButton) {
    if (!this.isActive) {
      this.start();
      toddImages.updateImage(buttonicon, "tollium:actions/reference", 24, 24, "w");
    } else {
      this.stop();
      toddImages.updateImage(buttonicon, "tollium:actions/reference", 24, 24, "b");
    }
    button.setPressed(this.isActive);
  }

  start(toolbar?: Toolbar) {
    if (!tool_inline)
      toolbar!.activateModalPanel(this.refPointPanel); // toolbar is only undefined when tool_inline = true
    this.refPoint = this.surface.refPoint;
    this.isActive = true;

    this.updateRefs();

    this.refPointer = <div class="wh-refbox-pointer" />;
    movable.enable(this.refPointer!);
    this.refPointer!.addEventListener("dompack:movestart", (evt: movable.DompackMoveEvent) => this.moveStart(evt));
    this.refPointer!.addEventListener("dompack:move", (evt: movable.DompackMoveEvent) => this.move(evt));
    this.refPointer!.addEventListener("dompack:moveend", (evt: movable.DompackMoveEvent) => this.moveEnd(evt));

    this.activate(true);
  }

  stop() {
    this.activate(false);
    this.isActive = false;

    if (this.refPointer)
      this.refPointer.remove();
    this.refPointer = null;
    this.refreshSurface();
  }

  apply(fireApply?: boolean) {
    this.applyCanvas({ refPoint: this.refPoint });
    if (fireApply !== false) {
      this.surface.pushUndo({ action: "refpoint", comp: this, props: { refPoint: this.refPoint }, meta: true }, tool_inline);
    }
  }

  applyCanvas(props: PhotoPointProps) {
    this.refPoint = props.refPoint;
    this.surface.refPoint = this.refPoint;
    this.refreshSurface();
    this.updatePoint();
  }

  activate(active: boolean) {
    if (!this.isActive)
      return;

    if (active !== this.activated) {
      const canvas = this.surface.previewCanvas || this.surface.canvas;
      this.activated = active;
      if (active) {
        canvas.addEventListener("click", this._setPoint);
        this.surface.node.classList.add("wh-refbox");
        this.updatePoint();
      } else {
        canvas.removeEventListener("click", this._setPoint);
        this.surface.node.classList.remove("wh-refbox");
        this.updatePoint(true);
      }
    }
  }

  previewCanvasChanged(event: CustomEvent) {
    if (this.activated && event.detail.oldcanvas) {
      event.detail.oldcanvas.removeEventListener("click", this._setPoint);
      const canvas = this.surface.previewCanvas || this.surface.canvas;
      canvas.addEventListener("click", this._setPoint);
    }
  }

  moveStart(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    this.updateRefs();
  }

  move(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    const x = Math.max(this.reference!.relpos.x, Math.min(this.reference!.imgsize.x + this.reference!.relpos.x, Math.round(this.refPoint!.x * this.reference!.canvasscale) + event.detail.movedX + this.reference!.relpos.x));
    const y = Math.max(this.reference!.relpos.y, Math.min(this.reference!.imgsize.y + this.reference!.relpos.y, Math.round(this.refPoint!.y * this.reference!.canvasscale) + event.detail.movedY + this.reference!.relpos.y));
    Object.assign(this.refPointer!.style, { left: x + "px", top: y + "px" });
  }

  moveEnd(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    this.refPoint = {
      x: (parseInt(getComputedStyle(this.refPointer!).left) - this.reference!.relpos.x) / this.reference!.canvasscale,
      y: (parseInt(getComputedStyle(this.refPointer!).top) - this.reference!.relpos.y) / this.reference!.canvasscale
    };
    this.apply(tool_inline);
  }

  updateRefs() {
    const canvas = this.surface.previewCanvas || this.surface.canvas;
    const canvaspos = canvas.getBoundingClientRect();
    const surfacepos = this.surface.node.getBoundingClientRect();
    this.reference = {
      abspos: { x: canvaspos.left, y: canvaspos.top },
      relpos: { x: canvaspos.left - surfacepos.left, y: canvaspos.top - surfacepos.top },
      imgsize: { x: canvaspos.width, y: canvaspos.height },
      canvasscale: 1
    };
    this.reference.canvasscale = this.reference.imgsize.x / this.surface.canvasData!.realSize.x;
  }

  updatePoint(hide?: boolean) {
    if (!this.refPointer)
      return;
    this.updateRefs();
    if (!hide && this.refPoint) {
      Object.assign(this.refPointer.style, {
        left: Math.round(this.refPoint.x * this.reference!.canvasscale + this.reference!.relpos.x) + "px",
        top: Math.round(this.refPoint.y * this.reference!.canvasscale + this.reference!.relpos.y) + "px"
      });
      this.surface.node.append(this.refPointer);
    } else {
      this.refPointer.remove();
    }
  }

  setPoint(event: MouseEvent) {
    this.refPoint = {
      x: (event.clientX - this.reference!.abspos.x) / this.reference!.canvasscale,
      y: (event.clientY - this.reference!.abspos.y) / this.reference!.canvasscale
    };
    this.apply(tool_inline);
  }

  clearPoint() {
    if (!this.isActive)
      return;
    this.refPoint = null;
    this.apply(tool_inline);
  }

  resetPoint() {
    this.refPoint = this.surface.refPoint;
    if (this.isActive)
      this.updatePoint();
  }
}

export type { PhotoPoint };

export function addRefPointButton(toolbar: Toolbar, surface: ImageSurface, options?: PhotoPointOptions) {
  const pointer = new PhotoPoint(surface, options);

  buttonicon = toddImages.createImage("tollium:actions/reference", 24, 24, "b");
  const button = new ToolbarButton(toolbar, {
    label: getTid("tollium:components.imgedit.editor.refpoint"),
    icon: buttonicon
  });

  if (tool_inline)
    button.node.addEventListener("execute", () => pointer.togglePointing(button));
  else
    button.node.addEventListener("execute", () => pointer.start(toolbar));
  toolbar.addButton(button);

  return { button: button, comp: pointer };
}
