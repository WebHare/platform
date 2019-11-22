import * as dompack from 'dompack';
var Toolbar = require('../toolbar/toolbars');
var getTid = require("@mod-tollium/js/gettid").getTid;
require("./imageeditor.lang.json");
var toddImages = require("@mod-tollium/js/icons");

//image canvas
class ImageSurface
{
  constructor(imgeditornode, toolbar, options)
  {
    this.imgeditornode = imgeditornode;
    this.container  = null;
    this.img        = null;
    this.imgdata    = {};
    this.viewport   = null;
    this.canvasdata = {};
    this.canvas     = null;
    this.previewcanvas= null;
    this.canvasscale= 1;
    this.previewscale= 1;
    this.imagelimited= false;
    this.ctx        = null;
    this.refpoint   = null; // { x= 0, y= 0 }
    this.orgrefpoint= null; // initial reference point, used to reset refpoint on undo
    this.undostack  = []; //contains all steps done
    this.redostack  = []; //contains all steps undone
    this.undobutton = null;
    this.redobutton = null;
    this.busylock   = null;
    this.options = { getBusyLock: null
                   , editorBackground: ""
                   , maxLength: 0
                   , maxArea: 0
                   , ...options
                   };

    this.container = <div class="wh-image-surface" tabindex="0">
                       {this.canvas = <canvas/>}
                       {this.maskcanvas = <canvas style="position:absolute;left:0;top:0;pointer-events:none"/>}
                     </div>
    if (this.options.editorBackground)
      this.container.style.background = this.options.editorBackground;
  }
  fireEvent(name, detail)
  {
    dompack.dispatchCustomEvent(this.imgeditornode, 'tollium-imageeditor:' + name, { bubbles:true, cancelable:false, detail});
  }
  toElement()
  {
    return this.container;
  }
  setSize(w,h)
  {
    dompack.setStyles(this.container, { width: w, height: h });
    if (this.ctx)
    {
      this.viewport = { x: w, y: h };
      this.setupCanvas();
      this.fireEvent("resized", { width: w
                                , height: h
                                });
    }
  }
  setImg(img, settings)
  {
    this.orgrefpoint = settings.refpoint;

    this.undostack = [];
    this.redostack = [];
    if (this.undobutton)
      this.undobutton.setEnabled(false);
    if (this.redobutton)
      this.redobutton.setEnabled(false);

    let containersize = this.container.getBoundingClientRect();
    this.viewport = { x: containersize.width, y: containersize.height };
    this.setupFromImage(img, settings.orientation);

    this.ctx = this.canvas.getContext("2d");

    this.setupCanvas();
    this.fireEvent('ready',this.imgdata);
  }

  // Are there changes?
  isDirty()
  {
    return this.undostack.length > 0;
  }

  // Are there image data modifying changes?
  isModified()
  {
    // Returns true if there is at least one image modifying state on the undo stack
    return this.undostack.findIndex(function(state)
    {
      return !state.meta;
    }) >= 0;
  }

  setBusy(busy)
  {
    if (!this.options.getBusyLock)
      return true; // No busy lock available
    // If busylock exists, don't accept 'true' as it's already busy, and vice versa
    if ((this.busylock !== null) == busy)
      return false; // Already busy

    if (busy)
    {
      this.busylock = this.options.getBusyLock();
    }
    else
    {
      if (this.busylock)
        this.busylock.release();
      this.busylock = null;
    }
    return true;
  }

  stop()
  {
  }

  reduceActions(cursteps)
  {
    //ADDME: more reduction if possible

    var steps = [];

/*
Merge:
-Same sequentially actions to one step
-Orientation if no cropping in between
-Scale if no cropping in between
*/
    var stepindex = -1;
    var stepaction = "";
    for(var c = 0; c < cursteps.length; c++)
    {
      if (stepaction != cursteps[c].action)
      {
        stepindex = -1;
        stepaction = cursteps[c].action;
      }
      if(cursteps[c].action == 'crop')
      {
        if(stepindex > -1)
        {
          var w = steps[stepindex].props.crop[1] - steps[stepindex].props.crop[3];
          var h = steps[stepindex].props.crop[2] - steps[stepindex].props.crop[0];

          steps[stepindex].props.crop[0]+=h*cursteps[c].props.crop[0]; //top
          steps[stepindex].props.crop[1]*=cursteps[c].props.crop[1];   //right
          steps[stepindex].props.crop[2]*=cursteps[c].props.crop[2];   //bottom
          steps[stepindex].props.crop[3]+=w*cursteps[c].props.crop[3]; //left
        }
        else
        {
          stepindex = steps.length;
          steps.push(cursteps[c]);
        }
      }
      else if(cursteps[c].action == 'scale')
      {
        if(stepindex > -1)
        {
          steps[stepindex].props.scale.x*=cursteps[c].props.scale.x;
          steps[stepindex].props.scale.y*=cursteps[c].props.scale.y;
        }
        else
        {
          stepindex = steps.length;
          steps.push(cursteps[c]);
        }
      }
      else if(cursteps[c].action == 'rotate')
      {
        if(stepindex > -1)
        {
          steps[stepindex].props.angle+=cursteps[c].props.angle;
          steps[stepindex].props.angle-=Math.floor(steps[stepindex].props.angle / 360) * 360;//keep range between 0 and 360
          steps[stepindex].props.scale.x*=cursteps[c].props.scale.x;
          steps[stepindex].props.scale.y*=cursteps[c].props.scale.y;
        }
        else
        {
          stepindex = steps.length;
          steps.push(cursteps[c]);
        }
      }
      else if(cursteps[c].action == 'filters')
      {
        if(stepindex > -1)
        {
          steps[stepindex].props.data=cursteps[c].props.data;
        }
        else
        {
          stepindex = steps.length;
          steps.push(cursteps[c]);
        }
      }
      else if(cursteps[c].action == 'refpoint')
      {
        if(stepindex > -1)
        {
          steps[stepindex].props.refpoint=cursteps[c].props.refpoint;
        }
        else
        {
          stepindex = steps.length;
          steps.push(cursteps[c]);
        }
      }
    }

    return steps;
  }

  setupFromImage(img, orientation)
  {
    var width = img.width;
    var height = img.height;

    // Restrict image width and height
    if (this.options.maxLength > 0 && (width > this.options.maxLength || height > this.options.maxLength))
    {
      let s = this.options.maxLength / Math.max(width, height);
      width = Math.floor(width * s);
      height = Math.floor(height * s);
      this.imagelimited = true;
    }
    // Restrict image area
    if (this.options.maxArea && width * height > this.options.maxArea)
    {
      let s = Math.sqrt(this.options.maxArea / (width * height));
      width = Math.floor(width * s);
      height = Math.floor(height * s);
      this.imagelimited = true;
    }
    if (this.imagelimited)
      console.warn("Restricting image dimensions from " + img.width + "x" + img.height + " to " + width + "x" + height);

    orientation = orientation || 0;
    var rotated = [ 5, 6, 7, 8 ].includes(orientation);
    var scale = { 'x': 1, 'y': 1 };//use separate scale x/y for error reduction rounding
    var orgsize = { 'x': rotated ? height : width, 'y': rotated ? width : height };

    this.img = img;
    this.imgdata = { 'size'       : { 'x': rotated ? height : width, 'y': rotated ? width : height }
                   , 'scale'      : scale
                   , 'orgsize'    : orgsize
                   , 'aspect'     : (orgsize.x / orgsize.y)
                   , 'orientation': orientation
                   };
  }

  setupCanvas()
  {
    this.refpoint = this.orgrefpoint;
    this.canvas.width = this.imgdata.size.x;
    this.canvas.height = this.imgdata.size.y;
    this.maskcanvas.width = this.viewport.x;
    this.maskcanvas.height = this.viewport.y;

    //what scale to use to fit image on canvas in current position
    var canvasscalex = this.canvas.width / this.viewport.x;
    var canvasscaley = this.canvas.height / this.viewport.y;
    var canvasscale  = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
    if(canvasscale < 1)
      canvasscale = 1;//don't scale up
    this.canvasscale = 1 / canvasscale;

    var cssw = Math.round(this.canvas.width / canvasscale);
    var cssh = Math.round(this.canvas.height / canvasscale);
    this.canvasdata = { 'csssize' : {'x' : cssw, 'y' : cssh}
                      , 'scale'   : {'x' : (this.canvas.width/cssw), 'y' : (this.canvas.height/cssh)}
                      , 'realsize': {'x' : this.imgdata.orgsize.x, 'y' : this.imgdata.orgsize.y}
                      };

    dompack.setStyles(this.canvas, { 'position'   : 'absolute'
                                   , 'top'        : '50%'
                                   , 'left'       : '50%'
                                   , 'width'      : this.canvasdata.csssize.x + 'px'
                                   , 'height'     : this.canvasdata.csssize.y + 'px'
                                   , 'margin-left': Math.ceil(this.canvasdata.csssize.x*-0.5) + 'px'
                                   , 'margin-top' : Math.ceil(this.canvasdata.csssize.y*-0.5) + 'px'
                                   });

    var drawwidth = this.imgdata.size.x;
    var drawheight = this.imgdata.size.y;
    if ([ 5, 6, 7, 8 ].includes(this.imgdata.orientation))
    {
      var tmp = drawwidth;
      drawwidth = drawheight;
      drawheight = tmp;
    }
    // See: http://stackoverflow.com/a/6010475
    switch (this.imgdata.orientation)
    {
      case 1: // rotated 0°, not mirrored
        break;
      case 2: // rotated 0°, mirrored
        this.ctx.scale(-1, 1);
        this.ctx.translate(-drawwidth, 0);
        break;
      case 3: // rotated 180°, not mirrored
        this.ctx.translate(drawwidth, drawheight);
        this.ctx.rotate(Math.PI);
        break;
      case 4: // rotated 180°, mirrored
        this.ctx.scale(1, -1);
        this.ctx.translate(0, -drawheight);
        break;
      case 5: // rotated 270°, mirrored
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.scale(-1, 1);
        break;
      case 6: // rotated 270°, not mirrored
        this.ctx.translate(drawheight, 0);
        this.ctx.rotate(Math.PI / 2);
        break;
      case 7: // rotated 90°, mirrored
        this.ctx.scale(-1, 1);
        this.ctx.translate(-drawheight, drawwidth);
        this.ctx.rotate(3 * Math.PI / 2);
        break;
      case 8: // rotated 90°, not mirrored
        this.ctx.translate(0, drawwidth);
        this.ctx.rotate(3 * Math.PI / 2);
        break;
    }
    this.ctx.drawImage(this.img, 0, 0, drawwidth, drawheight);
    this.showScale();
    this.fireEvent('reset');
  }

  setPreviewCanvas(canvas, contentRect)
  {
    var oldcanvas = this.previewcanvas;
    if (this.previewcanvas)
    {
      this.hidePreviewCanvas();
      this.previewcanvas.remove();
      this.previewcanvas = null;
      this.previewscale = 1;
    }
    if (canvas)
    {
      this.previewcanvas = canvas;
      this.previewrect = contentRect || { left: 0
                                        , top: 0
                                        , width: this.previewcanvas.width
                                        , height: this.previewcanvas.height
                                        , offsetx: 0
                                        , offsety: 0
                                        };
      if (this.previewrect.width > this.viewport.x || this.previewrect.height > this.viewport.y)
      {
        this.previewscale = Math.min(this.viewport.x / this.previewrect.width, this.viewport.y / this.previewrect.height);
        this.previewcanvas.style.transform = "scale(" + this.previewscale + ")";
      }
      else
      {
        this.previewscale = 1;
        this.previewcanvas.style.transform = "";
      }

      var left = Math.floor((this.viewport.x - this.previewcanvas.width) / 2) - Math.floor(this.previewscale * this.previewrect.offsetx);
      var top = Math.floor((this.viewport.y - this.previewcanvas.height) / 2) - Math.floor(this.previewscale * this.previewrect.offsety);
      this.previewcanvas.style.marginLeft = left + "px";
      this.previewcanvas.style.marginTop = top + "px";

      this.previewmask = { left: left + Math.floor(this.previewrect.left * this.previewscale) + Math.floor((this.previewcanvas.width - this.previewscale * this.previewcanvas.width) / 2)
                         , top: top + Math.floor(this.previewrect.top * this.previewscale) + Math.floor((this.previewcanvas.height - this.previewscale * this.previewcanvas.height) / 2)
                         , width: Math.round(this.previewrect.width * this.previewscale)
                         , height: Math.round(this.previewrect.height * this.previewscale)
                         };
      this.fireEvent("updatepreview", { oldcanvas: oldcanvas });
      this.showPreviewCanvas();
    }
  }
  updateMaskCanvas(contentRect)
  {
    contentRect = contentRect || { left: Math.floor((this.maskcanvas.width - this.canvasdata.csssize.x) / 2)
                                 , top: Math.floor((this.maskcanvas.height - this.canvasdata.csssize.y) / 2)
                                 , width: Math.round(this.canvasdata.csssize.x)
                                 , height: Math.round(this.canvasdata.csssize.y)
                                 };
    var ctx = this.maskcanvas.getContext("2d");
    // Clear the mask
    ctx.clearRect(0, 0, this.maskcanvas.width, this.maskcanvas.height);
    // Fill with transparent black
    ctx.fillStyle = "rgba(0, 0, 0, .6)";
    ctx.fillRect(0, 0, this.maskcanvas.width, this.maskcanvas.height);
    // Cut out the image rect, compensate for scaling
    ctx.clearRect(contentRect.left, contentRect.top, contentRect.width, contentRect.height);
  }
  showPreviewCanvas()
  {
    if (this.previewcanvas)
    {
      if (this.canvas.parentNode)
        this.container.removeChild(this.canvas);
      this.container.insertBefore(this.previewcanvas, this.container.firstChild);
      if (!this.maskcanvas.parentNode)
        this.container.appendChild(this.maskcanvas);
      else
        this.updateMaskCanvas(this.previewmask);
      this.fireEvent("showpreview");
    }
    this.showScale();
  }
  hidePreviewCanvas(hidemask)
  {
    if (this.previewcanvas)
    {
      this.fireEvent("hidepreview");
      this.container.removeChild(this.previewcanvas);
      this.container.insertBefore(this.canvas, this.container.firstChild);
      if (hidemask)
        this.container.removeChild(this.maskcanvas);
      else
        this.updateMaskCanvas();
      this.showScale(this.canvasscale);
    }
  }

  showScale(scale)
  {
    this.hideScale();
    if (!scale)
      scale = this.previewcanvas ? this.previewscale : this.canvasscale;
    this.container.appendChild(<span class="wh-imageeditor-scale">{Math.round(100 * scale) + "%"}</span>);
    this.scaletimeout = setTimeout(() => this.hideScale(), 2500);
  }

  hideScale()
  {
    clearTimeout(this.scaletimeout);
    dompack.qSA(this.container,".wh-imageeditor-scale").forEach(node => node.remove());
  }

  apply()
  {

  }

  pushUndo(state, replace_same_action)
  {
    // If pushing the same action, replace the previous state if the redo stack is empty
    if (replace_same_action
        && this.undostack.length
        && !this.redostack.length
        && this.undostack[this.undostack.length - 1].action == state.action)
      this.undostack[this.undostack.length - 1] = state;
    else
      this.undostack.push(state);
    this.redostack = [];
    if (this.undobutton)
      this.undobutton.setEnabled(true);
    if (this.redobutton)
      this.redobutton.setEnabled(false);
  }

  popUndo()
  {
    if(this.undostack.length === 0)
      return;

    // Remove last action from undo stack and push it to redo stack
    this.redostack.push(this.undostack.pop());
    if (this.undobutton)
      this.undobutton.setEnabled(this.undostack.length > 0);
    if (this.redobutton)
      this.redobutton.setEnabled(true);

    // Restore original
    this.setupCanvas();

    // Reconstruct previous actions with minimum steps
    this.reduceActions(this.undostack).forEach(step =>
    {
      step.comp.applyCanvas(step.props);
    });

    this.fireEvent("undo");
  }

  popRedo()
  {
    if(this.redostack.length === 0)
      return;

    // Remove last action from redo stack and push it to undo stack
    this.undostack.push(this.redostack.pop());
    if (this.redobutton)
      this.redobutton.setEnabled(this.redostack.length > 0);
    if (this.undobutton)
      this.undobutton.setEnabled(true);

    // Restore original
    this.setupCanvas();

    // Reconstruct previous actions with minimum steps
    this.reduceActions(this.undostack).forEach(step =>
    {
      step.comp.applyCanvas(step.props);
    });

    this.fireEvent("redo");
  }

  cloneCanvas(options)
  {
    console.log('Copying canvas');
    var copy = document.createElement("canvas");
    copy.width  = this.canvas.width;
    copy.height = this.canvas.height;

    var ctx = copy.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0);

    if (options && options.clearoriginal)
    {
      console.log('Clearing original');
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    return { canvas: copy, ctx: ctx };
  }
}

ImageSurface.addUndoButton = function(toolbar, surface, options)
{
  var button = new Toolbar.Button(toolbar,
      { label: getTid("tollium:common.actions.undo")
      , icon: toddImages.createImage("tollium:actions/undo", 24, 24, "b")
      , onExecute: surface.popUndo.bind(surface)
      , enabled: false
      });
  toolbar.addButton(button);
  surface.undobutton = button;
  return { button: button };
};

ImageSurface.addRedoButton = function(toolbar, surface, options)
{
  var button = new Toolbar.Button(toolbar,
      { label: getTid("tollium:common.actions.redo")
      , icon: toddImages.createImage("tollium:actions/redo", 24, 24, "b")
      , onExecute: surface.popRedo.bind(surface)
      , enabled: false
      });
  toolbar.addButton(button);
  surface.redobutton = button;
  return { button: button };
};

module.exports = ImageSurface;
