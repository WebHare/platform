var Toolbar = require('../toolbar/toolbars');
var getTid = require("@mod-tollium/js/gettid").getTid;
require("./imageeditor.lang.json");
var toddImages = require("@mod-tollium/js/icons");
import { SurfaceTool } from './surfacetool.es';

class PhotoRotate extends SurfaceTool
{
  constructor(surface, options)
  {
    super(surface, options);

    this.angle = 0;
    this.scale = {x:1, y:1};
    this.active = false;
    this.canvasscale = 1;

    this.options = { setStatus: null
                   , ...options
                   };

    this.scalepanel = new Toolbar.Panel(
        { onClose: this.stop.bind(this)
        , onApply: this.apply.bind(this)
        });
    this.scalepanel._imgedittool = "rotate";
    this.scalepanel.addButton(new Toolbar.Button(this.scalepanel,
        { label: getTid("tollium:components.imgedit.editor.rotateleft")
        , icon: toddImages.createImage("tollium:actions/rotateleft", 24, 24, "b")
        , onExecute: this.rotate.bind(this, -90)
        }));
    this.scalepanel.addButton(new Toolbar.Button(this.scalepanel,
        { label: getTid("tollium:components.imgedit.editor.rotateright")
        , icon: toddImages.createImage("tollium:actions/rotateright", 24, 24, "b")
        , onExecute: this.rotate.bind(this, 90)
        }));
    this.scalepanel.addButton(new Toolbar.Separator(this.scalepanel));
    this.scalepanel.addButton(new Toolbar.Button(this.scalepanel,
        { label: getTid("tollium:components.imgedit.editor.fliphorizontal")
        , icon: toddImages.createImage("tollium:actions/fliphorizontal", 24, 24, "b")
        , onExecute: this.fliphorizontal.bind(this)
        }));
    this.scalepanel.addButton(new Toolbar.Button(this.scalepanel,
        { label: getTid("tollium:components.imgedit.editor.flipvertical")
        , icon: toddImages.createImage("tollium:actions/flipvertical", 24, 24, "b")
        , onExecute: this.flipvertical.bind(this)
        }));
  }

  startScaling(toolbar)
  {
    toolbar.activateModalPanel(this.scalepanel);
    this.surface.hidePreviewCanvas();
    this.start();
  }

  start()
  {

    //initial values
    this.angle = 0;
    this.scale = {x:1,y:1};

    //what scale to use to fit image on canvas in current position
    var canvasscalex = this.surface.canvas.width / this.surface.viewport.x;
    var canvasscaley = this.surface.canvas.height / this.surface.viewport.y;
    this.canvasscale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;

    //what scale if rotated 90deg.:
    var canvasscalexr = this.surface.canvas.width / this.surface.viewport.y;
    var canvasscaleyr = this.surface.canvas.height / this.surface.viewport.x;
    this.canvasscale = canvasscalexr > this.canvasscale ? canvasscalexr : this.canvasscale;
    this.canvasscale = canvasscaleyr > this.canvasscale ? canvasscaleyr : this.canvasscale;
    if(this.canvasscale < 1)
      this.canvasscale = 1;//don't scale up
    this.surface.showScale(1 / this.canvasscale);

    this.active = true;

    //resize canvas so it fits if rotated
    var cssw = Math.round(this.surface.canvas.width / this.canvasscale);
    var cssh = Math.round(this.surface.canvas.height / this.canvasscale);
    this.surface.canvasdata.csssize = {'x' : cssw, 'y' : cssh};
    this.surface.canvasdata.scale = {'x' : (this.surface.canvas.width/cssw), 'y' : (this.surface.canvas.height/cssh)};

    dompack.setStyles(this.surface.canvas, { 'width'      : this.surface.canvasdata.csssize.x + 'px'
                                           , 'height'     : this.surface.canvasdata.csssize.y + 'px'
                                           , 'margin-left': Math.ceil(this.surface.canvasdata.csssize.x*-0.5) + 'px'
                                           , 'margin-top' : Math.ceil(this.surface.canvasdata.csssize.y*-0.5) + 'px'
                                           });
    this.surface.updateMaskCanvas();

    this.setStatus();
  }

  stop()
  {
    this.surface.showPreviewCanvas();

    this.scale = {x:1,y:1};
    this.angle = 0;
    this.rotate(0);

    //what scale to use to fit image on canvas in current position
    var canvasscalex = this.surface.canvas.width / this.surface.viewport.x;
    var canvasscaley = this.surface.canvas.height / this.surface.viewport.y;
    this.canvasscale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
    if(this.canvasscale < 1)
      this.canvasscale = 1;//don't scale up

    this.active = false;
    //resize canvas so it fits if rotated

    var cssw = Math.round(this.surface.canvas.width / this.canvasscale);
    var cssh = Math.round(this.surface.canvas.height / this.canvasscale);
    this.surface.canvasdata.csssize = {'x' : cssw, 'y' : cssh};
    this.surface.canvasdata.scale = {'x' : (this.surface.canvas.width/cssw), 'y' : (this.surface.canvas.height/cssh)};

    dompack.setStyles(this.surface.canvas, { 'width'      : this.surface.canvasdata.csssize.x + 'px'
                                           , 'height'     : this.surface.canvasdata.csssize.y + 'px'
                                           , 'margin-left': Math.ceil(this.surface.canvasdata.csssize.x*-0.5) + 'px'
                                           , 'margin-top' : Math.ceil(this.surface.canvasdata.csssize.y*-0.5) + 'px'
                                           });
    this.surface.updateMaskCanvas();
    this.refreshSurface();
  }

  apply()
  {
    this.surface.showPreviewCanvas();
    this.active = false;

    if(this.angle == 0 && this.scale.x == 1 && this.scale.y == 1)
      return;//no changes

    var newprops = {angle : this.angle, scale : this.scale};
    this.applyCanvas(newprops);

    this.surface.pushUndo({action: "rotate", comp: this, props: newprops, meta: false});

    //and setback initial values:
    this.scale = {x:1,y:1};
    this.angle = 0;
    this.rotate(0);
  }

  applyCanvas(props)
  {
    var neww = this.surface.canvas.width;
    var newh = this.surface.canvas.height;
    if(Math.round(Math.cos(props.angle*Math.PI/180)*100) == 0)
    {//rotated 90 or 270 deg.
      neww = this.surface.canvas.height;
      newh = this.surface.canvas.width;

      //switch scalefactors
      var scalex = this.surface.imgdata.scale.x;
      this.surface.imgdata.scale.x = this.surface.imgdata.scale.y;
      this.surface.imgdata.scale.y = scalex;

      var rx = this.surface.canvasdata.realsize.x;
      this.surface.canvasdata.realsize.x = this.surface.canvasdata.realsize.y;
      this.surface.canvasdata.realsize.y = rx;
    }
    else if(Math.round(Math.sin(props.angle*Math.PI/180)*100) == 0)
    {//rotated 0 or 360 deg.
      //no change in dimensions
    }
    else
    {//arbitrary angle
      //FIXME?
    }

    var copy;
    if(neww != this.surface.canvas.width)
    {//resize canvas to fit image
      //Copy image

      var idata = this.surface.ctx.getImageData(0, 0, this.surface.canvas.width, this.surface.canvas.height);
      this.surface.ctx.clearRect(0, 0, this.surface.canvas.width, this.surface.canvas.height);

      var prevw = this.surface.canvas.width;
      var prevh = this.surface.canvas.height;

      //set needed canvas size to fit rotation
      var max = newh > neww ? newh : neww;
      this.surface.canvas.width = max;
      this.surface.canvas.height = max;
      this.surface.ctx.putImageData(idata,Math.floor(0.5*(max - prevw)), Math.floor(0.5*(max - prevh)), 0, 0, prevw, prevh);

      copy = this.surface.cloneCanvas({ clearoriginal: true });

      //Rotate and or flip canvas
      this.surface.ctx.save();
      this.surface.ctx.setTransform(1,0,0,1,0,0);
      this.surface.ctx.translate(this.surface.canvas.width / 2, this.surface.canvas.height / 2);
      this.surface.ctx.scale(props.scale.x,props.scale.y);//scaling is -1 or 1 (flip vertical/horizontal)
      this.surface.ctx.rotate(props.angle*Math.PI/180);

//        this.surface.ctx.globalCompositeOperation = 'copy';//disabled because of bug in webkit
// as far we use steps of 90deg. this is no problem because we crop the image after rotation
// will be an issue if we use free rotation
      this.surface.ctx.drawImage(copy.canvas, -this.surface.canvas.width/2, -this.surface.canvas.height/2);
      this.surface.ctx.restore();

      //crop the transparent parts
      idata = this.surface.ctx.getImageData(Math.floor(0.5*(max - neww)), Math.floor(0.5*(max - newh)), neww, newh);
      this.surface.ctx.clearRect(0, 0, this.surface.canvas.width, this.surface.canvas.height);

      this.surface.canvas.width = neww;
      this.surface.canvas.height = newh;
      this.surface.ctx.putImageData(idata,0,0);
    }
    else
    {
      copy = this.surface.cloneCanvas({ clearoriginal: true });

      this.surface.ctx.save();
      this.surface.ctx.setTransform(1,0,0,1,0,0);
      this.surface.ctx.translate(this.surface.canvas.width / 2, this.surface.canvas.height / 2);
      this.surface.ctx.scale(props.scale.x,props.scale.y);//scaling is -1 or 1 (flip vertical/horizontal)
      this.surface.ctx.rotate(props.angle*props.scale.x*props.scale.y*Math.PI/180);//to rotate correct direction, multiply with scaling which is -1 or 1 (flip vertical/horizontal)

      this.surface.ctx.drawImage(copy.canvas, -this.surface.canvas.width/2, -this.surface.canvas.height/2);
      this.surface.ctx.restore();
    }

    if(!this.active)
    {//used if direct call from history
      //what scale to use to fit image on canvas in current position
      var canvasscalex = this.surface.canvas.width / this.surface.viewport.x;
      var canvasscaley = this.surface.canvas.height / this.surface.viewport.y;
      this.canvasscale = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
      if(this.canvasscale < 1)
        this.canvasscale = 1;//don't scale up
    }
    this.surface.canvasscale = 1 / this.canvasscale;

    //correct css position/dimensions
    var cssw = Math.round(this.surface.canvas.width / this.canvasscale);
    var cssh = Math.round(this.surface.canvas.height / this.canvasscale);

    this.surface.canvasdata.csssize = {'x' : cssw, 'y' : cssh};
    this.surface.canvasdata.scale = {'x' : (this.surface.canvas.width/cssw), 'y' : (this.surface.canvas.height/cssh)};

    dompack.setStyles(this.surface.canvas, { 'width'      : this.surface.canvasdata.csssize.x + 'px'
                                           , 'height'     : this.surface.canvasdata.csssize.y + 'px'
                                           , 'margin-left': Math.ceil(this.surface.canvasdata.csssize.x*-0.5) + 'px'
                                           , 'margin-top' : Math.ceil(this.surface.canvasdata.csssize.y*-0.5) + 'px'
                                           });
    this.surface.updateMaskCanvas();
    this.surface.showScale();
    this.refreshSurface();
  }

  fliphorizontal()
  {
    this.scale.x*=-1;
    this.rotate(0);
  }

  flipvertical()
  {
    this.scale.y*=-1;
    this.rotate(0);
  }

  rotate(degrees)
  {
    this.angle+=degrees;
    this.angle-=Math.floor(this.angle / 360) * 360;//keep range between 0 and 360

    this.surface.canvas.style.transform = 'scale('+this.scale.x+','+this.scale.y+') rotate('+this.angle+'deg)';

    this.setStatus();
  }

  setStatus()
  {
    if (!this.active)
      return;
    var neww = this.surface.canvas.width;
    var newh = this.surface.canvas.height;
    if(Math.round(Math.cos(this.angle*Math.PI/180)*100) === 0)
    {//rotated 90 or 270 deg.
      neww = this.surface.canvas.height;
      newh = this.surface.canvas.width;
      this.surface.updateMaskCanvas({ left: Math.floor((this.surface.maskcanvas.width - this.surface.canvasdata.csssize.y) / 2)
                                    , top: Math.floor((this.surface.maskcanvas.height - this.surface.canvasdata.csssize.x) / 2)
                                    , width: this.surface.canvasdata.csssize.y
                                    , height: this.surface.canvasdata.csssize.x
                                    });
    }
    else
      this.surface.updateMaskCanvas();
    //ADDME: scaling?
    this.options.setStatus(neww, newh);
  }
}

function addImageRotateButton(toolbar, surface, options)
{
  var rotator = new PhotoRotate(surface, options);

  var button = new Toolbar.Button(toolbar,
      { label: getTid("tollium:components.imgedit.editor.rotate")
      , icon: toddImages.createImage("tollium:actions/rotate", 24, 24, "b")
      , onExecute: rotator.startScaling.bind(rotator, toolbar)
      });
  toolbar.addButton(button);

  return { button: button, comp: rotator };
}

exports.addImageRotateButton = addImageRotateButton;
