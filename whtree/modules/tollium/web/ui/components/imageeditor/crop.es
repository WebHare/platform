import * as dompack from 'dompack';
import * as movable from 'dompack/browserfix/movable';

import "./imageeditor.lang.json";
import { getTid } from "@mod-tollium/js/gettid";
import { SurfaceTool } from './surfacetool.es';

var Toolbar = require('../toolbar/toolbars');
var SmartCrop = require('./smartcrop.js');
var toddImages = require("@mod-tollium/js/icons");

class PhotoCrop extends SurfaceTool
{
  constructor(surface, options)
  {
    super(surface, options)

    this.crop  = null;
    this.aspect = 0;
    this.draggers = [];
    this.masks = [];
    this.reference = null;
    this.cropbox = null;
    this.gridholder = null;
    this.gridanchor = null;
    this.active = false;
    this.fx = null;
    this.options = { fixedsize: null // { width: 0, height: 0 }
                   , ratiosize: null // { width: 0, height: 0 }
                   , setStatus: null
                   , ...options
                   };

    this.croppanel = new Toolbar.Panel(
        { onClose: this.stop.bind(this)
        , onApply: this.apply.bind(this)
        });
    this.croppanel._imgedittool = "crop";
    this.autobutton = new Toolbar.Button(this.croppanel,
          { label: getTid("tollium:components.imgedit.editor.smartcrop")
          , icon: toddImages.createImage("tollium:actions/resetcrop", 24, 24, "b")
          , onExecute: () => this.smartCrop()
          });
    this.croppanel.addButton(this.autobutton);
  }

  startCropping(toolbar)
  {
    toolbar.activateModalPanel(this.croppanel);
    this.surface.hidePreviewCanvas(true);
    this.start();
  }

  start()
  {
    this.active = false;
    this.fixedsize = this.options.fixedsize || { width: 0, height: 0 };

    var styles = this.surface.canvas.style.cssText;

    this.cropbox = <div class="wh-cropbox" style={styles} />
    this.surface.container.append(this.cropbox);

    let canvaspos = this.surface.canvas.getBoundingClientRect();
    this.reference = { x: canvaspos.left, y: canvaspos.top };



    //viewport (used to display 33% grid)
    this.gridholder = <div class="wh-cropbox-viewport"/>;
    this.cropbox.append(this.gridholder);
    movable.enable(this.gridholder);
    this.gridholder.addEventListener("dompack:move", evt => this.onDragMove(this.gridholder, evt));
    this.gridholder.addEventListener("dompack:end", evt => this.gridanchor = null);

    this.gridholder.append(<div class="vline1" />
                          ,<div class="vline2" />
                          ,<div class="hline1" />
                          ,<div class="hline2" />);

    this.masksize = this.surface.container.getBoundingClientRect();

    //set draggers:
    this.draggers = [];
    this.masks = [];
    for( var c = 0; c < 4; c++ )
    {
      let dragger = <div class="wh-cropbox-dragger" />
      dragger.classList.add(["wh-cropbox-dragger-nw","wh-cropbox-dragger-sw","wh-cropbox-dragger-ne","wh-cropbox-dragger-se"][c]);
      this.cropbox.append(dragger);
      this.draggers.push(dragger);

      var pos = { x : 0, y : 0 };
      if ( c == 1 )
        pos = { x : 0, y : this.surface.canvasdata.csssize.y };
      else if ( c == 2 )
        pos = { x : this.surface.canvasdata.csssize.x, y : 0 };
      else if ( c == 3)
        pos = { x : this.surface.canvasdata.csssize.x, y : this.surface.canvasdata.csssize.y };

      this.draggers[c].wh_pos = pos;
      dompack.setStyles(this.draggers[c], {'top' : pos.y + 'px', 'left' : pos.x + 'px'});

      movable.enable(this.draggers[c]);
      this.draggers[c].addEventListener("dompack:move", evt => this.onDragMove(dragger, evt));


      var mask = <div class="wh-cropbox-mask" style={`width: ${this.masksize.width}px; height: ${this.masksize.height}px`}/>
      this.cropbox.append(mask);
      this.masks.push(mask);
    }

    //initial crop values
    this.crop = [0,1,1,0];

    this.setAspectratio(this.options.ratiosize, function()
    {
      this.active = true;
    }.bind(this));
  }

  onDragMove(dragnode,ev)
  {
    var c;
    var movegrid = dragnode.classList.contains('wh-cropbox-viewport');
    if(movegrid)
    {//get upperleft dragger as reference for grid movement
      dragnode = this.draggers[0];
      for(c = 1; c < this.draggers.length; c++)
      {
        if(this.draggers[c].wh_pos.x < dragnode.wh_pos.x)
          dragnode = this.draggers[c];
        else if(this.draggers[c].wh_pos.y < dragnode.wh_pos.y)
          dragnode = this.draggers[c];
      }

      if(!this.gridanchor)//mouse snap position relative to upperleft dragger
        this.gridanchor = { x : dragnode.wh_pos.x - (ev.detail.pageX - this.reference.x)
                          , y : dragnode.wh_pos.y - (ev.detail.pageY - this.reference.y)
                          , width  : this.crop[1] - this.crop[3]
                          , height : this.crop[2] - this.crop[0]
                          };
    }
    else
    {
      this.gridanchor = null;
    }

    //css w/h canvas
    var w = this.crop[1]*this.surface.canvasdata.csssize.x - this.crop[3]*this.surface.canvasdata.csssize.x;
    var h = this.crop[2]*this.surface.canvasdata.csssize.y - this.crop[0]*this.surface.canvasdata.csssize.y;

    //mouse position relative to upperleft viewport
    var dx = ev.detail.pageX - this.reference.x;
    var dy = ev.detail.pageY - this.reference.y;

    if(this.gridanchor)
    {//if moving whole clipbox, compensate mouse position with (start) grab position
      dx+=this.gridanchor.x;
      dy+=this.gridanchor.y;
    }

    //some bounds checks:
    if(dx < 0)
      dx = 0;
    else if(dx > this.surface.canvasdata.csssize.x)
      dx = this.surface.canvasdata.csssize.x;

    if(dy < 0)
      dy = 0;
    else if(dy > this.surface.canvasdata.csssize.y)
      dy = this.surface.canvasdata.csssize.y;

    //sortout dragnodes in respect to current dragnode
    var hpairednode  = null;
    var vpairednode  = null;
    var diagonalnode = null;
    for(c = 0; c < this.draggers.length; c++)
    {
      if(this.draggers[c] != dragnode)
      {
        if(!hpairednode && this.draggers[c].wh_pos.y == dragnode.wh_pos.y && this.draggers[c].wh_pos.x != dragnode.wh_pos.x)
        {
          hpairednode = this.draggers[c];
        }
        else if(!vpairednode && this.draggers[c].wh_pos.x == dragnode.wh_pos.x && this.draggers[c].wh_pos.y != dragnode.wh_pos.y)
        {
          vpairednode = this.draggers[c];
        }
        else if(!diagonalnode)
        {
          diagonalnode = this.draggers[c];
        }
      }
    }

    if(!hpairednode || !vpairednode)
    {//draggers have all the same position
      hpairednode  = null;//reset
      vpairednode  = null;
      diagonalnode = null;
      //assign directly:
      for(c = 0; c < this.draggers.length; c++)
      {
        if(this.draggers[c] != dragnode)
        {
          if(!hpairednode)
            hpairednode = this.draggers[c];
          else if(!vpairednode)
            vpairednode = this.draggers[c];
          else if(!diagonalnode)
            diagonalnode = this.draggers[c];
        }
      }
    }


    if(!movegrid && this.aspect > 0 && !(this.fixedsize.width > 0 || this.fixedsize.height > 0))
    {
      //use smallest displacement voor ratio correction
      if(Math.abs(dx - dragnode.wh_pos.x) < Math.abs(dy - dragnode.wh_pos.y))
      {
        w = Math.abs(dx - hpairednode.wh_pos.x);
        h = w/this.aspect;

        if(dy < vpairednode.wh_pos.y)
          dy = vpairednode.wh_pos.y - h;
        else if(dy > vpairednode.wh_pos.y)
          dy = vpairednode.wh_pos.y + h;

        if(dy < 0)
          dy = 0;
        else if(dy > this.surface.canvasdata.csssize.y)
          dy = this.surface.canvasdata.csssize.y;
      }
      else
      {
        h = Math.abs(dy - vpairednode.wh_pos.y);
        w = h*this.aspect;

        if(dx < hpairednode.wh_pos.x)
          dx = hpairednode.wh_pos.x - w;
        else if(dx > hpairednode.wh_pos.x)
          dx = hpairednode.wh_pos.x + w;

        if(dx < 0)
          dx = 0;
        else if(dx > this.surface.canvasdata.csssize.x)
          dx = this.surface.canvasdata.csssize.x;
      }
    }

    dragnode.wh_pos = {x:Math.round(dx), y: Math.round(dy)};
    hpairednode.wh_pos.y = Math.round(dy);
    vpairednode.wh_pos.x = Math.round(dx);

    if(movegrid)
    {//moveing clipbox, then keep orginal width/height
      hpairednode.wh_pos.x = Math.round(w + dx);
      vpairednode.wh_pos.y = Math.round(h + dy);
    }

    //handling of dragnodes if fixed width or height is given
    if(!movegrid && (this.fixedsize.width > 0 || this.fixedsize.height > 0))
    {
      var fixedw = this.fixedsize.width;
      var fixedh = this.fixedsize.height;
      if(this.aspect > 0)
      {
        if(fixedw <= 0)
          fixedw = fixedh * this.aspect;
        else if(fixedh <= 0)
          fixedh = fixedw / this.aspect;
      }

      if(fixedw > 0)
      {
        w = fixedw / (this.surface.canvasdata.scale.x * this.surface.imgdata.scale.x);

        if(hpairednode.wh_pos.x < dragnode.wh_pos.x)
        {
          //check bounds
          if(dragnode.wh_pos.x - w < 0)
          {
            dragnode.wh_pos.x = Math.round(w);
            vpairednode.wh_pos.x = dragnode.wh_pos.x;
          }
          hpairednode.wh_pos.x = Math.round(dragnode.wh_pos.x - w);
        }
        else
        {
          hpairednode.wh_pos.x = Math.round(dragnode.wh_pos.x + w);
        }

      }

      if(fixedh > 0)
      {
        h = fixedh / (this.surface.canvasdata.scale.y * this.surface.imgdata.scale.y);
        if(vpairednode.wh_pos.y < dragnode.wh_pos.y)
        {
          //check bounds
          if(dragnode.wh_pos.y - h < 0)
          {
            dragnode.wh_pos.y = Math.round(h);
            hpairednode.wh_pos.y = dragnode.wh_pos.y;
          }
          vpairednode.wh_pos.y = Math.round(dragnode.wh_pos.y - h);
        }
        else
        {
          vpairednode.wh_pos.y = Math.round(dragnode.wh_pos.y + h);
        }
      }

    }

    diagonalnode.wh_pos = {x:hpairednode.wh_pos.x, y: vpairednode.wh_pos.y};

    //sortout positions:
    var toppx   = this.draggers[0].wh_pos.y;
    var rightpx = this.draggers[0].wh_pos.x;
    var bottompx= this.draggers[0].wh_pos.y;
    var leftpx  = this.draggers[0].wh_pos.x;
    for(c = 1; c < this.draggers.length; c++)
    {
      if(this.draggers[c].wh_pos.x > rightpx)
        rightpx = this.draggers[c].wh_pos.x;

      if(this.draggers[c].wh_pos.x < leftpx)
        leftpx = this.draggers[c].wh_pos.x;

      if(this.draggers[c].wh_pos.y < toppx)
        toppx = this.draggers[c].wh_pos.y;

      if(this.draggers[c].wh_pos.y > bottompx)
        bottompx = this.draggers[c].wh_pos.y;
    }

    var d;
    //check if grid is within bounds else correct positions
    if(rightpx > this.surface.canvasdata.csssize.x)
    {
      d = this.surface.canvasdata.csssize.x - rightpx;
      rightpx+=d;
      leftpx+=d;

      for(c = 0; c < this.draggers.length; c++)
        this.draggers[c].wh_pos.x+=d;
    }
    if(bottompx > this.surface.canvasdata.csssize.y)
    {
      d = this.surface.canvasdata.csssize.y - bottompx;
      bottompx+=d;
      toppx+=d;

      for(c = 0; c < this.draggers.length; c++)
        this.draggers[c].wh_pos.y+=d;
    }

    if(rightpx > this.surface.canvasdata.csssize.x)
      rightpx = this.surface.canvasdata.csssize.x;
    if(leftpx < 0)
      leftpx = 0;

    if(bottompx > this.surface.canvasdata.csssize.y)
      bottompx = this.surface.canvasdata.csssize.y;
    if(toppx < 0)
      toppx = 0;

    this.crop[0] = toppx    / this.surface.canvasdata.csssize.y;
    this.crop[1] = rightpx  / this.surface.canvasdata.csssize.x;
    this.crop[2] = bottompx / this.surface.canvasdata.csssize.y;
    this.crop[3] = leftpx   / this.surface.canvasdata.csssize.x;

    //reduce rounding errors of crop size:
    if(this.fixedsize.width > 0)
      this.crop[1] = this.crop[3] + (this.fixedsize.width / this.surface.canvasdata.realsize.x);
    if(this.fixedsize.height > 0)
      this.crop[2] = this.crop[0] + (this.fixedsize.height / this.surface.canvasdata.realsize.y);
    if(movegrid)
    {//moving whole grid
      this.crop[1] = this.crop[3] + this.gridanchor.width;
      this.crop[2] = this.crop[0] + this.gridanchor.height;
    }
    else if(this.aspect > 0)
    {
      if(this.fixedsize.width === 0)
      {
        this.crop[1] = this.crop[3] + ((bottompx - toppx) * this.aspect) / this.surface.canvasdata.csssize.x;
      }
      else
        this.crop[2] = this.crop[0] + (rightpx - leftpx) / (this.aspect * this.surface.canvasdata.csssize.y);
    }

    this.showCrop();
  }

  setAspectratio(aspect, callback)
  {
    var crop = null;
    if(typeof aspect == "object")
    {
      crop = aspect;
      if (!crop || !crop.width || !crop.height)
        aspect = 0;
      else
        aspect = crop.width / crop.height;
    }

    this.aspect = aspect > 0 ? aspect : 0;

    var maxw = this.fixedsize.width  > 0 ? this.fixedsize.width  : crop ? crop.width  : this.surface.canvasdata.realsize.x;
    var maxh = this.fixedsize.height > 0 ? this.fixedsize.height : crop ? crop.height : this.surface.canvasdata.realsize.y;
    var w = maxw;
    var h = maxh;

    if(this.aspect > 0)
    {//set crop to optimal fit
      h = Math.round(w / this.aspect);
      if(h > maxh)
      {
        h = maxh;
        w = Math.round(h*this.aspect);
      }

      if(this.fixedsize.width > 0 || this.fixedsize.height > 0)
        this.fixedsize = { 'width' : w, 'height' : h};
    }

    if (!this.surface.setBusy(true))
      return;

    var options = { width: w || this.surface.canvasdata.realsize.x
                  , height: h || this.surface.canvasdata.realsize.y
                  , debug: dompack.debugflags.isc
                  };
    SmartCrop.crop(this.surface.canvas, options, function(result)
    {
//ADDME:      if (options.debug && result.debugCanvas)
//        this.tmpcanvas.getContext("2d").drawImage(result.debugCanvas, 0, 0, this.tmpcanvas.width, this.tmpcanvas.height);
      this.setClipValues(result.topCrop.x, result.topCrop.y, result.topCrop.y + result.topCrop.height, result.topCrop.x + result.topCrop.width);
      this.showCrop();
      this.surface.setBusy(false);
      if (callback)
        callback({'width' : result.topCrop.width, 'height' : result.topCrop.height});
    }.bind(this));
  }

  smartCrop(callback)
  {
    this.setAspectratio(this.options.ratiosize, callback);
  }

  setClipValues(leftpx, toppx, bottompx, rightpx)
  {
    this.crop[0] = toppx    / this.surface.canvasdata.realsize.y;
    this.crop[1] = rightpx  / this.surface.canvasdata.realsize.x;
    this.crop[2] = bottompx / this.surface.canvasdata.realsize.y;
    this.crop[3] = leftpx   / this.surface.canvasdata.realsize.x;

    //covert to css positions current canvas
    toppx    = Math.round(toppx    / (this.surface.imgdata.scale.y * this.surface.canvasdata.scale.y));
    rightpx  = Math.round(rightpx  / (this.surface.imgdata.scale.x * this.surface.canvasdata.scale.x));
    bottompx = Math.round(bottompx / (this.surface.imgdata.scale.y * this.surface.canvasdata.scale.y));
    leftpx   = Math.round(leftpx   / (this.surface.imgdata.scale.x * this.surface.canvasdata.scale.x));

    this.draggers[0].wh_pos = { x: leftpx,  y: toppx };
    this.draggers[1].wh_pos = { x: leftpx,  y: bottompx };
    this.draggers[2].wh_pos = { x: rightpx, y: toppx };
    this.draggers[3].wh_pos = { x: rightpx, y: bottompx };
  }

  setClipCenterValues(w,h)
  {
    var leftpx   = 0.5*(this.surface.canvasdata.realsize.x - w);
    var toppx    = 0.5*(this.surface.canvasdata.realsize.y - h);
    var bottompx = toppx + h;
    var rightpx  = leftpx + w;
    this.setClipValues(leftpx, toppx, bottompx, rightpx);
  }

  setWidth (w, fixed)
  {
    var inputwidth = Math.round(w);

    if(w > this.surface.canvasdata.realsize.x)
      w = this.surface.canvasdata.realsize.x;
    var h = Math.round(this.crop[2]*this.surface.canvasdata.realsize.y - this.crop[0]*this.surface.canvasdata.realsize.y);

    if(this.aspect > 0 && w > 0)
    {
      //calc maximal width by given aspectratio
      var aw = this.surface.canvasdata.realsize.x;
      var ah = aw / this.aspect;
      if(ah > this.surface.canvasdata.realsize.y)
      {
        ah = this.surface.canvasdata.realsize.y;
        aw = ah*this.aspect;
      }
      if(w > aw)
        w = aw;

      h = w / this.aspect;
    }

    if(w < 0)
      w = 0;

    w = Math.round(w);
    h = Math.round(h);

    var isvalid = inputwidth == w;
    if(isvalid)
    {
      if(fixed)
      {
        if(this.fixedsize.height > 0 && this.fixedsize.height != h)
          this.fixedsize.height = h;
        this.fixedsize.width = w;
      }

      if(w > 0)
      {//resize clip area
        this.setClipCenterValues(w, h);
        this.showCrop();
      }
    }

    return isvalid;
  }

  setHeight (h, fixed)
  {
    var inputheight = Math.round(h);

    if(h > this.surface.canvasdata.realsize.y)
      h = this.surface.canvasdata.realsize.y;
    var w = Math.round(this.crop[1]*this.surface.canvasdata.realsize.x - this.crop[3]*this.surface.canvasdata.realsize.x);

    if(this.aspect > 0 && h > 0)
    {
      //calc maximal height by given aspectratio
      var aw = this.surface.canvasdata.realsize.x;
      var ah = aw / this.aspect;
      if(ah > this.surface.canvasdata.realsize.y)
      {
        ah = this.surface.canvasdata.realsize.y;
        aw = ah*this.aspect;
      }
      if(h > ah)
        h = ah;

      w = h * this.aspect;
    }

    if(h < 0)
      h = 0;

    w = Math.round(w);
    h = Math.round(h);

    var isvalid = inputheight == h;
    if(isvalid)
    {
      if(fixed)
      {
        if(this.fixedsize.width > 0 && this.surface.canvasdata.realsize.x != w)
          this.fixedsize.width = w;
        this.fixedsize.height = h;
      }
      if(h > 0)
      {//resize clip area
        this.setClipCenterValues(w, h);
        this.showCrop();
      }
    }

    return isvalid;
  }

  showCrop()
  {
    var x1 = this.draggers[0].wh_pos.x;
    var y1 = this.draggers[0].wh_pos.y;
    var x2 = x1;
    var y2 = y1;
    for(var c = 0; c < this.draggers.length; c++)
    {
      dompack.setStyles(this.draggers[c], {'top' : this.draggers[c].wh_pos.y + 'px', 'left' : this.draggers[c].wh_pos.x + 'px'});
      if(c > 0)
      {
        if(this.draggers[c].wh_pos.x > x2)
          x2 = this.draggers[c].wh_pos.x;

        if(this.draggers[c].wh_pos.x < x1)
          x1 = this.draggers[c].wh_pos.x;

        if(this.draggers[c].wh_pos.y < y1)
          y1 = this.draggers[c].wh_pos.y;

        if(this.draggers[c].wh_pos.y > y2)
          y2 = this.draggers[c].wh_pos.y;
      }
    }

    dompack.setStyles(this.gridholder, { 'top':    y1 + 'px'
                                       , 'right':  x2 + 'px'
                                       , 'bottom': y2 + 'px'
                                       , 'left':   x1 + 'px'
                                       , 'width':  (x2 - x1) + 'px'
                                       , 'height': (y2 - y1) + 'px'
                                       });

    var canvasscale = Math.max(0, this.surface.canvasdata.realsize.x / this.surface.viewport.x, this.surface.canvasdata.realsize.y / this.surface.viewport.y);
    this.options.setStatus(Math.round((x2 - x1) * canvasscale), Math.round((y2 - y1) * canvasscale), this.surface.canvasdata.realsize.x, this.surface.canvasdata.realsize.y);

    this.masks[0].style.top = (y2 - this.masksize.height) + "px";
    this.masks[0].style.left = (x1 - this.masksize.width) + "px";
    this.masks[1].style.top = (y1 - this.masksize.height) + "px";
    this.masks[1].style.left = x1 + "px";
    this.masks[2].style.top = y1 + "px";
    this.masks[2].style.left = x2 + "px";
    this.masks[3].style.top = y2 + "px";
    this.masks[3].style.left = (x2 - this.masksize.width) + "px";
  }

  stop()
  {
    this.surface.showPreviewCanvas();
    this.cropbox.remove();
    this.refreshSurface();
  }

  apply()
  {
    this.surface.showPreviewCanvas();
    if(this.crop[0] == 0 && this.crop[1] == 1 && this.crop[2] == 1 && this.crop[3] == 0)
      return; //no changes

    this.applyCanvas({crop : this.crop});
    this.surface.pushUndo({action: "crop", comp: this, props: {crop : this.crop}, width:this.surface.canvas.width, height:this.surface.canvas.height, meta: false});
    this.refreshSurface();
  }

  applyCanvas(props)
  { //props is an array with top,right,bottom,left fractions (0..1)
    var newwidth  = Math.round(props.crop[1]*this.surface.canvas.width - props.crop[3]*this.surface.canvas.width);
    var newheight = Math.round(props.crop[2]*this.surface.canvas.height - props.crop[0]*this.surface.canvas.height);

    //crop image
    var idata = this.surface.ctx.getImageData(Math.round(props.crop[3]*this.surface.canvas.width), Math.round(props.crop[0]*this.surface.canvas.height), newwidth, newheight);
    this.surface.canvas.width = newwidth;
    this.surface.canvas.height = newheight;
    this.surface.ctx.putImageData(idata,0,0);

    //correct css styling:
    var canvasscalex = newwidth / this.surface.viewport.x;
    var canvasscaley = newheight / this.surface.viewport.y;
    var canvasscale  = canvasscalex > canvasscaley ? canvasscalex : canvasscaley;
    if(canvasscale < 1)
      canvasscale = 1;//don't scale up
    this.surface.canvasscale = 1 / canvasscale;

    var cssw = Math.round(newwidth / canvasscale);
    var cssh = Math.round(newheight / canvasscale);
    this.surface.canvasdata.csssize = {'x' : cssw, 'y' : cssh};
    this.surface.canvasdata.scale = {'x' : (newwidth/cssw), 'y' : (newheight/cssh)};
    //this.surface.canvasdata.realsize = {'x' : Math.round(props.crop[1]*imgedit.canvasdata.realsize.x - props.crop[3]*imgedit.canvasdata.realsize.x), 'y' : Math.round(props.crop[2]*imgedit.canvasdata.realsize.y - props.crop[0]*imgedit.canvasdata.realsize.y)};

    dompack.setStyles(this.surface.canvas, { 'width'      : this.surface.canvasdata.csssize.x + 'px'
                                           , 'height'     : this.surface.canvasdata.csssize.y + 'px'
                                           , 'margin-left': Math.floor(this.surface.canvasdata.csssize.x*-0.5) + 'px'
                                           , 'margin-top' : Math.floor(this.surface.canvasdata.csssize.y*-0.5) + 'px'
                                           });
    this.surface.showScale();
  }
}

function addImageCropButton(toolbar, surface, options)
{
  var cropper = new PhotoCrop(surface, options);

  var button = new Toolbar.Button(toolbar,
      { label: getTid("tollium:components.imgedit.editor.crop")
      , icon: toddImages.createImage("tollium:actions/crop", 24, 24, "b")
      , onExecute: cropper.startCropping.bind(cropper, toolbar)
      });
  toolbar.addButton(button);

  return { button: button, comp: cropper };
}

exports.addImageCropButton = addImageCropButton;
