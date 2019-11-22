var Toolbar = require('../toolbar/toolbars');
require('./imageeditor.css');
var ImageSurface = require('./surface');
var Crop = require('./crop');
var Scaling = require('./scaling');
var Refpoint = require('./refpoint');
var Filters = require('./filters');
var getTid = require("@mod-tollium/js/gettid").getTid;
require("./imageeditor.lang.json");
var toddImages = require("@mod-tollium/js/icons");
import * as dompack from 'dompack';

// Impose some limits on image sizes
//ADDME: Should these be different for other platforms, e.g. mobile?
var MAX_IMAGE_LENGTH = 32767; // Max length of one size
var MAX_IMAGE_AREA = 15000000; // Max number of pixels

/*
Supported debug flags:
  isc Set SmartCrop debug flag
  ixf Enable experimental filters
*/

class ImageEditor
{
  constructor(el,options)
  {
    this.el = null;
    this.toolbar = null;
    this.surface = null;
    this.cropper = null;
    this.rotator = null;
    this.mimetype = "";
    this.filename = "";
    this.orgblob = null;
    this.cropsize = null; // { width: 0, height: 0 }
    this.cropratio = null; // { width: 0, height: 0 }
    this.fixorientation = true;
    this.allowedactions = [];
    this.allowedfilters = [];
    this.previewing = false;
    this.dirty = false;
    this.options = { width: 640
                   , height: 320 //ADDME default toolbar height!
                   , toolbarheight: 72
                   , imgsize: null
                   , resourcebase: ""
                   , getBusyLock: null
                   , setStatus: null
                   , createScreen: null
                   , setModalLayerOpacity: null
                   , editorBackground: ""
                   , maxLength: 0
                   , maxArea: 0
                   , ...options
                   , maxLength: MAX_IMAGE_LENGTH
                   , maxArea: MAX_IMAGE_AREA
                   };

    this.el = el;

    this.toolbar = new Toolbar({ applyicon: toddImages.createImage("tollium:actions/apply", 24, 24, "b")
                               , applylabel: getTid("tollium:common.actions.apply")
                               , closeicon: toddImages.createImage("tollium:actions/cancel", 24, 24, "b")
                               , closelabel: getTid("tollium:common.actions.cancel")
                               });
    this.surface = new ImageSurface(this.el, this.toolbar, options);
    this.el.addEventListener("tollium-imageeditor:ready", evt => this.onLoad(evt));
    this.el.addEventListener("tollium-imageeditor:refresh", evt => this.previewImgSize(evt) );
    this.el.addEventListener("tollium-imageeditor:undo", evt => this.previewImgSize(evt) );
    this.el.addEventListener("tollium-imageeditor:redo", evt => this.previewImgSize(evt) );

    dompack.empty(this.el);
    this.el.appendChild(this.toolbar.toElement());
    this.el.appendChild(this.surface.toElement());
    this.setSize(this.options.width, this.options.height);

    // Add toolbar buttons
    this.undobutton = ImageSurface.addUndoButton(this.toolbar, this.surface).button;
    this.redobutton = ImageSurface.addRedoButton(this.toolbar, this.surface).button;
    if (this.options.resetImage)
    {
      this.toolbar.addButton(new Toolbar.Button(this.toolbar,
          { label: getTid("tollium:common.actions.reset")
          , icon: toddImages.createImage("tollium:actions/reset", 24, 24, "b")
          , onExecute: this.resetImage.bind(this)
          }));
    }
    this.toolbar.addButton(new Toolbar.Separator(this.toolbar));

    this.cropper = Crop.addImageCropButton(this.toolbar, this.surface,
        { fixedsize: this.cropsize
        , ratiosize: this.cropratio
        , setStatus: this.setStatus.bind(this)
        });
    this.rotator = Scaling.addImageRotateButton(this.toolbar, this.surface,
        { setStatus: this.setStatus.bind(this)
        });
    this.filters = Filters.addFiltersButton(this.toolbar, this.surface,
        { resourcebase: this.options.resourcebase
        , setStatus: this.setStatus.bind(this)
        , setProgress: options.setProgress
        , createScreen: this.options.createScreen
        , getAllowedFilters: this.getAllowedFilters.bind(this)
        , setModalLayerOpacity: this.options.setModalLayerOpacity
        });
    this.pointer = Refpoint.addRefPointButton(this.toolbar, this.surface,
        { setStatus: this.setStatus.bind(this)
        });
    if (this.options.imgsize)
    {
      this.previewing = true;
      this.applyImgSize();
    }
  }
  onLoad(event)
  {
    this.previewImgSize();
    this.surface.fireEvent("load", { target: this, width: event.detail.size.x, height: event.detail.size.y }); //who was listening ??
  }
  setSize(w,h)
  {
    this.toolbar.setSize(w, this.options.toolbarheight);
    this.surface.setSize(w, h-this.options.toolbarheight);
    this.previewImgSize();
  }
  setImg(img, options)
  {
    this.mimetype = options.mimetype;
    this.filename = options.filename;
    this.orgblob = options.orgblob;
    this.surface.setImg(img, options);
  }
  getImageAsBlob(callback)
  {
    if(!this.surface.ctx)
    {
      setTimeout(function()
      {
        callback(null); //not ready yet
      }, 1);
      return;
    }

    var canvas = this.surface.canvas;
    var mimetype = this.mimetype;

    var settings = { refpoint: this.surface.refpoint ? { x: Math.round(this.surface.refpoint.x)
                                                       , y: Math.round(this.surface.refpoint.y)
                                                       } : null};
    if (this.options.imgsize)
    {
      // If the image didn't actually change, we can return the original blob directly
      if (!this.surface.isModified() && !ImageEditor.resizeMethodApplied(this.options.imgsize, canvas.width, canvas.height, mimetype))
      {
        // Call callback after a delay; maybe the caller doesn't expect the callback to be called directly
        var blob = this.orgblob;
        setTimeout(function()
        {
          callback(blob, settings);
        }, 1);
        return;
      }
      var res = resizeCanvasWithMethod(canvas, this.options.imgsize, this.surface.refpoint || this.isRefpointAllowed(), true);
      if (res)
      {
        if (res.rect && res.rect.refpoint)
          settings.refpoint = { x: Math.round(res.rect.refpoint.x)
                              , y: Math.round(res.rect.refpoint.y)
                              };
        canvas = res.canvas;
      }
      mimetype = this.options.imgsize.format || mimetype;
    }

    canvas.toBlob(function(blob)
    {
      callback(blob, settings);
    }, mimetype, 0.85);
  }
  stop()
  {
    this.surface.stop();
  }
  isDirty()
  {
    return this.dirty || this.surface.isDirty();
  }
  applyImgSize()
  {
    if (this.options.imgsize)
    {
      if (this.options.imgsize.setwidth > 0 && this.options.imgsize.setheight > 0)
      {
        this.cropratio = { width: this.options.imgsize.setwidth
                         , height: this.options.imgsize.setheight
                         };
        if (this.cropper)
          this.cropper.comp.options.ratiosize = this.cropratio;
      }

      this.fixorientation = this.options.imgsize.fixorientation;
      this.allowedactions = this.options.imgsize.allowedactions;
      this.allowedfilters = this.options.imgsize.allowedfilters;
    }
    else
    {
      this.allowedactions = [];
      this.allowedfilters = [];
    }

    this.updateActionButtons();
    this.previewImgSize();
  }
  previewImgSize(event)
  {
    if(!this.surface.ctx)
      return; //not ready yet

    if (event && event.norefresh)
      return;

    var canvas = this.surface.canvas;
    if (this.previewing && this.options.imgsize)
    {
      var resized = resizeCanvasWithMethod(canvas, this.options.imgsize, this.surface.refpoint || this.isRefpointAllowed());
      if (resized)
      {
        this.surface.setPreviewCanvas(resized.canvas, resized.rect);
        this.setStatus(resized.rect ? resized.rect.width : resized.canvas.width,
                       resized.rect ? resized.rect.height : resized.canvas.height,
                       canvas.width, canvas.height);
      }
      else
      {
        this.surface.setPreviewCanvas(null);
        this.setStatus(canvas.width, canvas.height);
      }
      this.previewing = true;
    }
  }
  setStatus(width, height, orgwidth, orgheight)
  {
    var status = (this.filename ? this.filename + ": " : "")
               + width + "\u00d7" + height
               + (orgwidth && orgheight ? " (" + orgwidth + "\u00d7" + orgheight + ")" : "");
    var minwarning = (orgwidth > 0 && orgwidth < width) || (orgheight > 0 && orgheight < height);
    var maxwarning = (orgwidth > 0 || orgheight > 0)
                     && this.surface.imagelimited
                     && !this.surface.undostack.some(function(item) { return item.action == "crop"; });
    this.options.setStatus(status, minwarning ? "min" : maxwarning ? "max" : null);
  }
  updateActionButtons()
  {
    var allallowed = this.allowedactions.indexOf("all") >= 0;
    this.cropper.button.node.style.display = allallowed || this.allowedactions.indexOf("crop") >= 0 ? "" : "none";
    this.rotator.button.node.style.display = allallowed || this.allowedactions.indexOf("rotate") >= 0 ? "" : "none";
    this.filters.button.node.style.display = allallowed || this.allowedactions.indexOf("filters") >= 0 ? "" : "none";
    this.pointer.button.node.style.display = this.isRefpointAllowed() ? "" : "none";
  }
  isRefpointAllowed()
  {
    // Setting the reference point only makes sense if the image is not resized (it may be resized in the image cache using
    // the reference point) or if the resize method is fill (which actually crops the image). It is not enabled when 'all'
    // actions are allowed; it has to be enabled explicitly.
    var method_refpoint = !this.options.imgsize || this.options.imgsize.method == "none" || this.options.imgsize.method == "fill";
    return method_refpoint && this.allowedactions.indexOf("refpoint") >= 0;
  }
  getAllowedFilters()
  {
    return this.allowedfilters;
  }
  resetImage()
  {
    this.options.resetImage().then(function(result)
    {
      this.dirty = this.dirty || result == "yes";
    }.bind(this));
  }
}

function resizeCanvasWithMethod(canvas, imgsize, refpoint, forupload)
{
  let resizemethod = imgsize.method;
  if (resizemethod === "")
    return;

  if (resizemethod === "none")
  {
    // Use 'fill' method for previewing refpoint when method is 'none'
    if (refpoint && !forupload)
      resizemethod = "fill";
    else
      return;
  }

  var canvaswidth = imgsize.setwidth;
  var canvasheight = imgsize.setheight;
  if (canvaswidth || canvasheight)
  {
    var imagewidth = canvas.width;
    var imageheight = canvas.height;
    var imagetop = 0;
    var imageleft = 0;
    if (!canvaswidth)
    {
      // If only height is restricted, scale width proportionally
      canvaswidth = Math.round(canvasheight * imagewidth / imageheight);
    }
    else if (!canvasheight)
    {
      // If only width is restricted, scale height proportionally
      canvasheight = Math.round(canvaswidth * imageheight / imagewidth);
    }

    if (resizemethod == "stretch")
    {
      // Just stretch to canvas
      imagewidth = canvaswidth;
      imageheight = canvasheight;
    }
    else if (resizemethod.indexOf("fit") === 0 && imagewidth <= canvaswidth && imageheight <= canvasheight)
    {
      // Don't resize
      if (resizemethod == "fit")
      {
        canvaswidth = imagewidth;
        canvasheight = imageheight;
      }
    }
    else if (canvaswidth / canvasheight > imagewidth / imageheight)
    {
      // canvas is more wide than image
      if (resizemethod.indexOf("scale") === 0
          || (resizemethod.indexOf("fit") === 0 && imageheight > canvasheight))
      {
        // Scale width proportionally, keep height
        imagewidth = Math.round(canvasheight * imagewidth / imageheight);
        imageheight = canvasheight;
        // If not scaling to canvas, only keep image width
        if (resizemethod.indexOf("canvas") < 0)
          canvaswidth = imagewidth;
      }
      else if (resizemethod == "fill")
      {
        // Scale height proportionally, keep width
        imageheight = Math.round(canvaswidth * imageheight / imagewidth);
        imagewidth = canvaswidth;
      }
    }
    else
    {
      // canvas is more tall than image
      if (resizemethod.indexOf("scale") === 0
          || (resizemethod.indexOf("fit") === 0 && imagewidth > canvaswidth))
      {
        // Scale height proportionally, keep width
        imageheight = Math.round(canvaswidth * imageheight / imagewidth);
        imagewidth = canvaswidth;
        // If not scaling to canvas, only keep image height
        if (resizemethod.indexOf("canvas") < 0)
          canvasheight = imageheight;
      }
      else if (resizemethod == "fill")
      {
        // Scale width proportionally, keep height
        imagewidth = Math.round(canvasheight * imagewidth / imageheight);
        imageheight = canvasheight;
      }
    }

    // Center image
    imagetop = Math.round((canvasheight - imageheight) / 2);
    imageleft = Math.round((canvaswidth - imagewidth) / 2);

    var rect = null;
    if (resizemethod == "fill")
    {
      // When filling, either top or left is 0, the other is <0
      rect = { left: Math.abs(imageleft)
             , top: Math.abs(imagetop)
             , offsetx: 0
             , offsety: 0
             , width: canvaswidth
             , height: canvasheight
             , refpoint: null // Refpoint relative to resized image
             };
      if (refpoint && refpoint !== true)
      {
        if (!rect.left)
        {
          var curtop = rect.top;
          var scalex = imagewidth / canvas.width;
          rect.top = (refpoint.y * scalex / imageheight) * (imageheight - canvasheight);
          rect.offsety = rect.top - curtop;
          rect.refpoint = { x: refpoint.x * scalex
                          , y: refpoint.y * scalex - rect.top
                          };
        }
        else if (!rect.top)
        {
          var curleft = rect.left;
          var scaley = imageheight / canvas.height;
          rect.left = (refpoint.x * scaley / imagewidth) * (imagewidth - canvaswidth);
          rect.offsetx = rect.left - curleft;
          rect.refpoint = { x: refpoint.x * scaley - rect.left
                          , y: refpoint.y * scaley
                          };
        }
      }

      if (!forupload)
      {
        canvaswidth = imagewidth;
        canvasheight = imageheight;
        imagetop = 0;
        imageleft = 0;
      }
      else
      {
        imagetop -= rect.offsety;
        imageleft -= rect.offsetx;
      }
    }

    // Create the resized canvas
    var resized = <canvas width={canvaswidth} height={canvasheight}/>
    var ctx = resized.getContext("2d");
    // Set background color, if specified
    if (imgsize.bgcolor !== "" && imgsize.bgcolor != "transparent")
    {
      ctx.fillStyle = imgsize.bgcolor;
      ctx.fillRect(0, 0, canvaswidth, canvasheight);
    }
    // Draw (and possibly resize) the editor image onto the resized canvas
    ctx.drawImage(canvas, imageleft, imagetop, imagewidth, imageheight);
    return { canvas: resized, rect: rect };
  }
}

// Check if the given resize method is applied for an image with given widht, height and MIME type
ImageEditor.resizeMethodApplied = function(imgsize, width, height, mimetype)
{
  // If preserveifunchanged is not set (unless resize method is "none"), the method is applied
  if (!imgsize.noforce && imgsize.method != "none")
    return true;

  // If the image doesn't have the expected MIME type, the method is applied
  if (imgsize.format !== "" && mimetype != imgsize.format)
    return true;

  switch (imgsize.method)
  {
    case "none":
    {
      // The image would not be resized, skip editor
      return false;
    }
    case "fill":
    case "fitcanvas":
    case "scalecanvas":
    case "stretch":
    {
      // Image method is applied if the image doesn't match both the set width and height exactly
      //ADDME: If image has transparency, only skip editor if conversionbackground is transparent
      return width != imgsize.setwidth || height != imgsize.setheight;
    }
    case "fit":
    {
      // Image method is applied if the image is bigger than to the set width and/or height
      return (imgsize.setwidth > 0 && width > imgsize.setwidth)
          || (imgsize.setheight > 0 && height > imgsize.setheight);
    }
    case "scale":
    {
      // Image method is applied if the image size has an incorrect width and/or height
      return (imgsize.setwidth > 0 && width != imgsize.setwidth)
          || (imgsize.setheight > 0 && height != imgsize.setheight);
    }
  }
  // Don't know, assume it's applied
  return true;
};

module.exports = ImageEditor;
