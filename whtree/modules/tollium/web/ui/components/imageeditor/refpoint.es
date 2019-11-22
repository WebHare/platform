import * as dompack from 'dompack';
import * as movable from 'dompack/browserfix/movable';
var Toolbar = require('../toolbar/toolbars');
var getTid = require("@mod-tollium/js/gettid").getTid;
require("./imageeditor.lang.json");
var toddImages = require("@mod-tollium/js/icons");
import Keyboard from 'dompack/extra/keyboard';
import { SurfaceTool } from './surfacetool.es';

// Set to true to activate 'inline' mode, without the modal toolbar
var tool_inline = false;

var buttonicon;

class PhotoPoint extends SurfaceTool
{
  constructor(surface, options)
  {
    super(surface, options);

    this.refpoint = null;// { x: 0, y: 0 }
    this.isactive = false;
    this.activated = false;
    this.options = {...options};

    this.refpointpanel = new Toolbar.Panel(
        { onClose: this.stop.bind(this)
        , onApply: this.apply.bind(this)
        , onCancel: this.cancel.bind(this)
        });
    this.refpointpanel._imgedittool = "refpoint";

    this.delbutton = new Toolbar.Button(this.refpointpanel,
          { label: getTid("tollium:components.imgedit.editor.delrefpoint")
          , icon: toddImages.createImage("tollium:actions/delete", 24, 24, "b")
          , onExecute: this.clearPoint.bind(this)
          });
    this.refpointpanel.addButton(this.delbutton);

    this._setPoint = this.setPoint.bind(this);
    this.keyboard = new Keyboard(this.surface.container, { Delete: this.clearPoint.bind(this) });
    if (tool_inline)
    {
      this.surface.imgeditornode.addEventListener("tollium-imageeditor:reset", () => this.resetPoint());
      this.surface.imgeditornode.addEventListener("tollium-imageeditor:showpreview", () => this.activate(true));
      this.surface.imgeditornode.addEventListener("tollium-imageeditor:hidepreview", () => this.activate(false));
    }
    else
    {
      this.surface.imgeditornode.addEventListener("tollium-imageeditor:updatepreview", evt => this.previewCanvasChanged(evt));
    }
  }

  togglePointing(button)
  {
    if (!this.isactive)
    {
      this.start();
      toddImages.updateImage(buttonicon, "tollium:actions/reference", 24, 24, "w");
    }
    else
    {
      this.stop();
      toddImages.updateImage(buttonicon, "tollium:actions/reference", 24, 24, "b");
    }
    button.setPressed(this.isactive);
  }

  start(toolbar)
  {
    if (!tool_inline)
      toolbar.activateModalPanel(this.refpointpanel);
    this.refpoint = this.surface.refpoint;
    this.isactive = true;

    this.updateRefs();

    this.refpointer = <div class="wh-refbox-pointer"/>
    movable.enable(this.refpointer);
    this.refpointer.addEventListener("dompack:movestart", evt => this.moveStart(evt));
    this.refpointer.addEventListener("dompack:move", evt => this.move(evt));
    this.refpointer.addEventListener("dompack:moveend", evt => this.moveEnd(evt));

    this.activate(true);
  }

  cancel()
  {
    // Reset surface refpoint when cancelling
    this.surface.refpoint = this.surface.orgrefpoint;
  }

  stop()
  {
    this.activate(false);
    this.isactive = false;

    this.refpointer.remove();
    this.refpointer= null;
    this.refreshSurface();
  }

  apply(fireapply)
  {
    this.applyCanvas({ refpoint : this.refpoint });
    if (fireapply !== false)
    {
      this.surface.pushUndo({action: "refpoint", comp: this, props: { refpoint : this.refpoint }, meta: true}, tool_inline);
    }
  }

  applyCanvas(props)
  {
    this.refpoint = props.refpoint;
    this.surface.refpoint = this.refpoint;
    this.refreshSurface();
    this.updatePoint();
  }

  activate(active)
  {
    if (!this.isactive)
      return;

    active = !!active;
    if (active != this.activated)
    {
      var canvas = this.surface.previewcanvas || this.surface.canvas;
      this.activated = active;
      if (active)
      {
        canvas.addEventListener("click", this._setPoint);
        this.surface.container.classList.add("wh-refbox");
        this.updatePoint();
      }
      else
      {
        canvas.removeEventListener("click", this._setPoint);
        this.surface.container.classList.remove("wh-refbox");
        this.updatePoint(true);
      }
    }
  }

  previewCanvasChanged(event)
  {
    if (this.activated && event.detail.oldcanvas)
    {
      event.detail.oldcanvas.removeEventListener("click", this._setPoint);
      var canvas = this.surface.previewcanvas || this.surface.canvas;
      canvas.addEventListener("click", this._setPoint);
    }
  }

  moveStart(event)
  {
    event.stopPropagation();
    this.updateRefs();
  }

  move(event)
  {
    event.stopPropagation();
    var x = Math.max(this.reference.relpos.x, Math.min(this.reference.imgsize.x + this.reference.relpos.x, Math.round(this.refpoint.x * this.reference.canvasscale) + event.detail.movedX + this.reference.relpos.x));
    var y = Math.max(this.reference.relpos.y, Math.min(this.reference.imgsize.y + this.reference.relpos.y, Math.round(this.refpoint.y * this.reference.canvasscale) + event.detail.movedY + this.reference.relpos.y));
    dompack.setStyles(this.refpointer, { left: x , top:  y });
  }

  moveEnd(event)
  {
    event.stopPropagation();
    this.refpoint = { x: (parseInt(getComputedStyle(this.refpointer).left) - this.reference.relpos.x) / this.reference.canvasscale
                    , y: (parseInt(getComputedStyle(this.refpointer).top) - this.reference.relpos.y) / this.reference.canvasscale
                    };
    this.apply(tool_inline);
  }

  updateRefs()
  {
    var canvas = this.surface.previewcanvas || this.surface.canvas;
    let canvaspos = canvas.getBoundingClientRect();
    let surfacepos = this.surface.container.getBoundingClientRect();
    this.reference = { abspos: { x: canvaspos.left, y: canvaspos.top }
                     , relpos: { x: canvaspos.left - surfacepos.left, y: canvaspos.top - surfacepos.top }
                     , imgsize: { x: canvaspos.width, y: canvaspos.height }
                     };
    this.reference.canvasscale = this.reference.imgsize.x / this.surface.canvasdata.realsize.x;
  }

  updatePoint(hide)
  {
    if (!this.refpointer)
      return;
    this.updateRefs();
    if (!hide && this.refpoint)
    {
      dompack.setStyles(this.refpointer, { left: Math.round(this.refpoint.x * this.reference.canvasscale + this.reference.relpos.x)
                                         , top:  Math.round(this.refpoint.y * this.reference.canvasscale + this.reference.relpos.y)
                                         });
      this.surface.container.append(this.refpointer);
    }
    else
    {
      this.refpointer.remove();
    }
  }

  setPoint(event)
  {
    this.refpoint = { x: (event.clientX - this.reference.abspos.x) / this.reference.canvasscale
                    , y: (event.clientY - this.reference.abspos.y) / this.reference.canvasscale
                    };
    this.apply(tool_inline);
  }

  clearPoint()
  {
    if (!this.isactive)
      return;
    this.refpoint = null;
    this.apply(tool_inline);
  }

  resetPoint()
  {
    this.refpoint = this.surface.refpoint;
    if (this.isactive)
      this.updatePoint();
  }
};

function addRefPointButton(toolbar, surface, options)
{
  var pointer = new PhotoPoint(surface, options);

  buttonicon = toddImages.createImage("tollium:actions/reference", 24, 24, "b");
  var button = new Toolbar.Button(toolbar,
      { label: getTid("tollium:components.imgedit.editor.refpoint")
      , icon: buttonicon
      });

  if (tool_inline)
    button.toElement().addEventListener("execute", pointer.togglePointing.bind(pointer, button));
  else
    button.toElement().addEventListener("execute", pointer.start.bind(pointer, toolbar));
  toolbar.addButton(button);

  return { button: button, comp: pointer };
}

exports.addRefPointButton = addRefPointButton;
