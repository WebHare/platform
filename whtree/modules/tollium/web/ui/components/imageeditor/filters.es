import * as dompack from 'dompack';
var Toolbar = require('../toolbar/toolbars');
var getTid = require("@mod-tollium/js/gettid").getTid;
require("./imageeditor.lang.json");
var toddImages = require("@mod-tollium/js/icons");
import { SurfaceTool } from './surfacetool.es';

var CCV, faceCascade;
//ADDME: Uncomment these to activate face recognition filter
//CCV = require('./ccv.js');
//faceCascade = require('./face.js');

class PhotoFilters extends SurfaceTool
{
  constructor(surface, options)
  {
    super(surface, options);

    this.filterdata = null;
    this.filtertime = 0;
    this.previewdata = null;
    this.options = { resourcebase: ""
                   , setProgress: null
                   , setStatus: null
                   , createScreen: null
                   , getAllowedFilters: null
                   , setModalLayerOpacity: null
                   , ...options
                   };


    this.filterpanel = new Toolbar.Panel(
        { onClose: this.stop.bind(this)
        , onApply: this.apply.bind(this)
        });
    this.filterpanel._imgedittool = "filters";
    this.grayscalebutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.grayscale")
        , icon: toddImages.createImage("tollium:actions/grayscale", 24, 24, "b")
        , onExecute: this.grayscale.bind(this)
        });
    this.filterpanel.addButton(this.grayscalebutton);
    this.invertbutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.invert")
        , icon: toddImages.createImage("tollium:actions/invert", 24, 24, "b")
        , onExecute: this.invert.bind(this)
        });
    this.filterpanel.addButton(this.invertbutton);
    this.sharpenbutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.sharpen")
        , icon: toddImages.createImage("tollium:actions/sharpen", 24, 24, "b")
        , onExecute: this.sharpen.bind(this)
        });
    this.filterpanel.addButton(this.sharpenbutton);
    this.blurbutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.blur")
        , icon: toddImages.createImage("tollium:actions/blur", 24, 24, "b")
        , onExecute: this.blur.bind(this)
        });
    this.filterpanel.addButton(this.blurbutton);
    this.brightnesscontrastbutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.brightnesscontrast")
        , icon: toddImages.createImage("tollium:actions/brightnesscontrast", 24, 24, "b")
        , onExecute: this.brightnessContrast.bind(this)
        });
    this.filterpanel.addButton(this.brightnesscontrastbutton);
    this.autocontrastbutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.autocontrast")
        , icon: toddImages.createImage("tollium:actions/autocontrast", 24, 24, "b")
        , onExecute: this.autocontrast.bind(this)
        });
    this.filterpanel.addButton(this.autocontrastbutton);
    this.coloradjustbutton = new Toolbar.Button(this.filterpanel,
        { label: getTid("tollium:components.imgedit.editor.coloradjust")
        , icon: toddImages.createImage("tollium:actions/colors", 24, 24, "b")
        , onExecute: this.colorAdjust.bind(this)
        });
    this.filterpanel.addButton(this.coloradjustbutton);
    if (dompack.debugflags.ixf)
    {
      this.filterpanel.addButton(new Toolbar.Separator(this.filterpanel));
      this.filterpanel.addButton(new Toolbar.Button(this.filterpanel,
          { label: getTid("tollium:components.imgedit.editor.sepia")
          , icon: toddImages.createImage("tollium:actions/sepia", 24, 24, "b")
          , onExecute: this.sepia.bind(this)
          }));
      this.filterpanel.addButton(new Toolbar.Button(this.filterpanel,
          { label: getTid("tollium:components.imgedit.editor.posterize")
          , icon: toddImages.createImage("tollium:actions/posterize", 24, 24, "b")
          , onExecute: this.posterize.bind(this)
          }));
      if (typeof CCV == "object")
      {
        this.filterpanel.addButton(new Toolbar.Button(this.filterpanel,
            { label: getTid("tollium:components.imgedit.editor.findfaces")
            , icon: toddImages.createImage("tollium:actions/findfaces", 24, 24, "b")
            , onExecute: this.findFaces.bind(this)
            }));
      }
    }
  }

  updateFilterButtons()
  {
    var allowedfilters = this.options.getAllowedFilters();
    var allallowed = allowedfilters.indexOf("all") >= 0;
    this.grayscalebutton.node.style.display = allallowed || allowedfilters.indexOf("grayscale") >= 0 ? "" : "none";
    this.invertbutton.node.style.display = allallowed || allowedfilters.indexOf("invert") >= 0 ? "" : "none";
    this.sharpenbutton.node.style.display = allallowed || allowedfilters.indexOf("sharpen") >= 0 ? "" : "none";
    this.blurbutton.node.style.display = allallowed || allowedfilters.indexOf("blur") >= 0 ? "" : "none";
    this.brightnesscontrastbutton.node.style.display = allallowed || allowedfilters.indexOf("brightnesscontrast") >= 0 ? "" : "none";
    this.autocontrastbutton.node.style.display = allallowed || allowedfilters.indexOf("autocontrast") >= 0 ? "" : "none";
    this.coloradjustbutton.node.style.display = allallowed || allowedfilters.indexOf("coloradjust") >= 0 ? "" : "none";
  }

  startFiltering(toolbar)
  {
    this.updateFilterButtons();
    toolbar.activateModalPanel(this.filterpanel);
    this.surface.hidePreviewCanvas();

    this.worker = new Worker(this.options.resourcebase + "components/imageeditor/filters-worker.js");
    this.worker.addEventListener("message", evt => this.onFilterResult(evt));

    this.start();
  }

  start()
  {
    this.filterbox = <div class="wh-filterbox" style={this.surface.canvas.style.cssText} />;
    this.surface.container.append(this.filterbox);

    this.tmpcanvas = <canvas class="wh-filterbox-img" width={this.surface.canvas.width} height={this.surface.canvas.height}/>;
    this.filterbox.append(this.tmpcanvas);
    var tmpctx = this.tmpcanvas.getContext('2d');
    tmpctx.drawImage(this.surface.canvas, 0, 0, this.surface.canvas.width, this.surface.canvas.height);

    this.options.setStatus(this.surface.canvas.width, this.surface.canvas.height);

    this.filterdata = null;
  }

  stop()
  {
    this.worker.terminate();
    this.worker = null;

    this.surface.showPreviewCanvas();
    this.filterbox.remove();
    this.refreshSurface();
  }

  apply()
  {
    this.surface.showPreviewCanvas();
    if(!this.filterdata)
      return; //no changes

    this.applyCanvas({filterdata : this.filterdata});
    this.surface.pushUndo({action: "filters", comp: this, props: {filterdata : this.filterdata}, meta: false});
    this.refreshSurface();
  }

  applyCanvas(props)
  {
    var pixels = this.getPixels(this.surface.canvas);
    for (var i = 0; i < props.filterdata.length; ++i)
      pixels.data[i] = props.filterdata[i];
    this.setPixels(this.surface.canvas, pixels);
  }

  grayscale()
  {
    this.runFilter("grayscale");
  }

  sepia()
  {
    this.runFilter("sepiaTone");
  }

  posterize()
  {
    var components =
        { level: { type: "slider", title: getTid("tollium:components.imgedit.filters.level")
                 , min: 2, max: 256, step: 1, value: 4
                 , width: "1pr" }
        };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.posterize"), components, values =>
    {
      var level = parseInt(values.level);
      this.runFilter("posterize", level);
    });
  }

  invert()
  {
    this.runFilter("invert");
  }

  colorAdjust()
  {
    var components =
        { /*advanced: { type: "checkbox", title: "", label: "advanced" }
        , */red:   { type: "slider", title: getTid("tollium:components.imgedit.filters.red")
                 , min: 0, max: 100, step: 1, value: 100
                 , width: "1pr" }
        , green: { type: "slider", title: getTid("tollium:components.imgedit.filters.green")
                 , min: 0, max: 100, step: 1, value: 100
                 , width: "1pr" }
        , blue:  { type: "slider", title: getTid("tollium:components.imgedit.filters.blue")
                 , min: 0, max: 100, step: 1, value: 100
                 , width: "1pr" }
        };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.coloradjust"), components, values =>
    {
      var redfraction = parseInt(values.red) / 100
        , greenfraction = parseInt(values.green) / 100
        , bluefraction = parseInt(values.blue) / 100;

      // Run the filter
      this.runFilter("adjustColors", redfraction, greenfraction, bluefraction);
    });
  }

  brightnessContrast()
  {
    //ADDME: Currently using linear brightness/contrast adjustment (which Photoshop calls 'legacy'), maybe switch to
    //       non-linear adjustment using histogram curves?
    var components =
        { brightness: { type: "slider", title: getTid("tollium:components.imgedit.filters.brightness")
                      , min: -100, max: 100, step: 1, value: 0
                      , width: "1pr" }
        , contrast:   { type: "slider", title: getTid("tollium:components.imgedit.filters.contrast")
                      , min: -50, max: 100, step: 1, value: 0
                      , width: "1pr" }
        };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.brightnesscontrast"), components, values =>
    {
      // Brightness has range -1..0..1, with -1 resulting in black and 1 resulting in white
      // We'll map the -100..0..100 input range to -0.5..0..0.5
      var brightness = parseInt(values.brightness) / 200;
      // Contrast has range 0..1..127, with 0 resulting in gray
      // We'll map the -50..0..100 input range to about ~0.05..1..~21 using ((x/100)+1)^4.4 (which maps -100 to 0, 0 to 1
      // and 200 to ~126).
      var contrast = Math.pow(((parseInt(values.contrast) / 100) + 1), 4.4);

      // Run the filter
      this.runFilter("brightnessContrast", brightness, contrast);
    });
  }

  autocontrast()
  {
    //this.runFilter("equalizeHistogram");
    var components =
        { level: { type: "slider", title: getTid("tollium:components.imgedit.filters.level")
                 , min: 1, max: 50, step: 1, value: 5
                 , width: "1pr" }
        };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.autocontrast"), components, values =>
    {
      var level = parseInt(values.level);
      this.runFilter("autoContrast", level);
    });
  }

  sharpen()
  {
    this.runFilter("convolve",
        [  0, -1,  0
        , -1,  5, -1
        ,  0, -1,  0
        ]);
  }

  blur()
  {
    var components =
        { radius: { type: "slider", title: getTid("tollium:components.imgedit.filters.radius")
                  , min: 1, max: 100, step: 1, value: 1
                  , width: "1pr" }
        };
    this.runFilterDialog(getTid("tollium:components.imgedit.filters.blur"), components, values =>
    {
      var radius = parseInt(values.radius);
      this.runFilter("gaussianBlur", radius);
    });
  }

  findFaces()
  {
    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d");
    canvas.width = this.surface.canvas.width;
    canvas.height = this.surface.canvas.height;
    context.drawImage(this.surface.canvas, 0, 0);

    var starttime = Date.now();
    var options = { "canvas": CCV.grayscale(canvas)
                  , "cascade": faceCascade
                  , "interval": 5
                  , "min_neighbors": 1
                  //, "async": true
                  //, "worker": 1
                  };
    var result = CCV.detect_objects(options);
    console.info("detection-time", Math.round(Date.now() - starttime));
    console.info("num-faces", result.length.toString());
    for (var i = 0; i < result.length; i++)
      console.info("face #"+i+": "+result[i].width+"x"+result[i].height+" @"+result[i].x+"."+result[i].y);
    /*
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(230,87,0,0.8)';
    // Draw detected area
    for (var i = 0; i < result.length; i++) {
      ctx.beginPath();
      ctx.arc((result[i].x + result[i].width * 0.5) * scale, (result[i].y + result[i].height * 0.5) * scale,
          (result[i].width + result[i].height) * 0.25 * scale * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    */
  }

  getPixels(canvas)
  {
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  setPixels(canvas, pixels)
  {
    canvas.getContext("2d").putImageData(pixels, 0, 0);
  }

  runFilter(filter, var_args)
  {
    if (!this.surface.setBusy(true))
      return; // Already busy

    this.filtertime = Date.now();

    var args = Array.prototype.slice.apply(arguments);
    // When previewing, the previewdata property will contain the unfiltered data
    args[0] = this.previewdata || this.getPixels(this.tmpcanvas); // Replace 'filter' argument with the image data (first argument to filter functions)
    var output = this.tmpcanvas.getContext("2d").createImageData(this.tmpcanvas.width, this.tmpcanvas.height);

    console.log("Starting filter", filter, "with arguments", args, "and output", output);
    this.worker.postMessage({ name: filter, args: args, output: output });
  }

  onFilterResult(event)
  {
    var data = event.data;
    if (data)
    {
      switch (data.type)
      {
        case "result":
        {
          if (this.options.setProgress)
          {
            this.options.setProgress(0, 0);
          }
          else if (this.progress)
          {
            this.progress.remove();
            this.progress = null;
          }

          requestAnimationFrame(function()
          {
            this.filterdata = data.result.data;
            this.setPixels(this.tmpcanvas, data.result);

            console.log("Got filter result in " + (Date.now() - this.filtertime) + "ms");
            this.surface.setBusy(false);
          }.bind(this));

          break;
        }
        case "progress":
        {
          if (this.options.setProgress)
          {
            this.options.setProgress(data.progress, 100);
          }
          else
          {
            if (!this.progress)
            {
              this.progress = <progress style={{width: "50%", height:"20px", position:"absolute",top:"50%",left:"25%",marginTop:"-10px",zIndex:1}} max="100" value="0"/>
              this.filterbox.append(this.progress);
            }
            this.progress.value = data.progress;
          }
          break;
        }
        case "debug":
        {
          console.info(data.debug);
          break;
        }
      }
    }
  }

  // @param title Dialog title
  // @param components Filter-specific components, { name: spec, name: spec } object (each object is rendered on its own line
  //                   within the dialog body, 'spec' is a createScreen-compatible component description)
  // @param runfilter The function that actually runs the filter, which is supplied a { name: value, name: value } object
  //                  with the getValue() value for each component from components
  runFilterDialog(title, components, runfilter)
  {
    var curdata = this.filterdata;
    var curpixels = this.getPixels(this.tmpcanvas);
    var previewed = false;

    // This will automatically run the dialog
    new FilterDialogController(
        { title: title
        , components: components
        , createScreen: this.options.createScreen
        , onButton: result =>
          {
            // Apply the filter if previewing, or if the 'ok' button is pressed and the filter is not yet previewed
            if (result.button == "preview" || (result.button == "ok" && !previewed))
            {
              previewed = result.button == "preview";

              // Use the initial canvas for running the filter (prevent re-applying the filter on multiple previews)
              this.previewdata = curpixels;

              // Run the filter
              runfilter(result.values);
            }
            // Reset the filterdata and canvas if the 'cancel' button is pressed and the filter has been previewed
            else if (result.button == "cancel" && previewed)
            {
              this.filterdata = curdata;
              this.setPixels(this.tmpcanvas, curpixels);
            }
            // Clear the preview initial canvas
            if (result.button != "preview")
            {
              this.previewdata = null;
            }
          }
        });
    // Make modal layer fully transparent, so the actual image is visible
    this.options.setModalLayerOpacity(0);
  }
}

class FilterDialogController
{ constructor(options)
  {
    this.options = { title: null
                   , components: null
                   , createScreen: null
                   , ...options
                   };
    this.options.components = {...this.options.components};
    this._createDialog();
  }

  _createDialog()
  {
    var dialog =
        { frame:        { bodynode: 'root'
                        , specials: ['previewaction','okaction','cancelaction']
                        , title: this.options.title
                        , defaultbutton: "okbutton"
                        , allowclose: true
                        }
        , root:         { type: 'panel', lines: [{ layout: "block", items: [ {item:"body"} ], width: "1pr", height: "1pr"}
                                                ,{ layout: "block", items: [ {item:"footer"} ]}
                                                ]
                        }
        , body:         { type: 'panel'
                        , lines: []
                        , spacers: { top:true, bottom:true, left:true, right:true }
                        , width: "1pr", height: "1pr"
                        }
        , footer:       { type: 'panel'
                        , lines: [{items: [ {item:"previewbutton"}
                                          , {item:"spacer"}
                                          , {item:"okbutton"}
                                          , {item:"cancelbutton"}
                                          ]}
                                 ]
                        , spacers: { top:true, bottom:true, left:true, right:true }
                        , isfooter: true
                        , width:'1pr'
                        }
        , previewaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        , previewbutton: { type: 'button', title: getTid("tollium:components.imgedit.filters.preview"), action: 'previewaction' }
        , spacer:       { type: 'text', width: "1pr", value: "" }
        , okaction:     { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        , okbutton:     { type: 'button', title: getTid("tollium:common.actions.ok"), action: 'okaction' }
        , cancelaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        , cancelbutton: { type: 'button', title: getTid("tollium:common.actions.cancel"), action: 'cancelaction' }
        , ...this.options.components
        };

    Object.keys(this.options.components).forEach(key =>
    {
      dialog.body.lines.push({ title: this.options.components[key].title, items: [ { item: key } ] });
    });

    this.dialog = this.options.createScreen(dialog);

    this.dialog.setMessageHandler("previewaction", "execute", this._onFilterPreviewButton.bind(this));
    this.dialog.setMessageHandler("okaction", "execute", this._onFilterOkButton.bind(this));
    this.dialog.setMessageHandler("cancelaction", "execute", this._onFilterCancelButton.bind(this));
    this.dialog.setMessageHandler("frame", "close", this._onFilterCancelButton.bind(this));
  }

  _closeDialog()
  {
    // Close editor dialog if still present
    if (this.dialog)
      this.dialog.terminateScreen();
    this.dialog = null;

    // Close busylock if still present
    if (this.busylock)
      this.busylock.release();
    this.busylock = null;
  }

  _getComponentValues()
  {
    var values = {};

    Object.keys(this.options.components).forEach(key =>
    {
      values[key] = this.dialog.getComponent(key).getValue();
    });
    return values;
  }

  _onFilterPreviewButton(data, callback)
  {
    callback();
    this.options.onButton({ button: "preview", values: this._getComponentValues() });
  }

  _onFilterOkButton(data, callback)
  {
    callback();
    this.options.onButton({ button: "ok", values: this._getComponentValues() });
    this._closeDialog();
  }

  _onFilterCancelButton(data, callback)
  {
    callback();
    this.options.onButton({ button: "cancel" });
    this._closeDialog();
  }
};

function addFiltersButton(toolbar, surface, options)
{
  var filters = new PhotoFilters(surface, options);

  var button = new Toolbar.Button(toolbar,
      { label: getTid("tollium:components.imgedit.editor.filters")
      , icon: toddImages.createImage("tollium:misc/levers", 24, 24, "b")
      , onExecute: filters.startFiltering.bind(filters, toolbar)
      });
  toolbar.addButton(button);

  return { button: button, comp: filters };
}

exports.addFiltersButton = addFiltersButton;
