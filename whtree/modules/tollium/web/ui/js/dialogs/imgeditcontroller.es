/* globals webkitURL */
require("../../common.lang.json");
require("../../components/imageeditor/imageeditor.lang.json");
import * as whintegration from '@mod-system/js/wh/integration';
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';

import * as dompack from 'dompack';
var ExifParser = require("exif-parser");

var getTid = require("@mod-tollium/js/gettid").getTid;

var $todd = require("../support");
var ImageEditor = require("../../components/imageeditor");

// http://www.nixtu.info/2013/06/how-to-upload-canvas-data-to-server.html
function dataURItoBlob(dataURI)
{
  // convert base64 to raw binary data held in a string
  // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
  var byteString = atob(dataURI.split(',')[1]);

  // separate out the mime component
  var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to an ArrayBuffer
  var ab = new ArrayBuffer(byteString.length);
  var dw = new DataView(ab);
  for(var i = 0; i < byteString.length; i++)
  {
    dw.setUint8(i, byteString.charCodeAt(i));
  }

  // write the ArrayBuffer to a blob, and you're done
  return new Blob([ ab ], { type: mimeString });
};


class ImgeditDialogController
{
  constructor (screen, options)
  {
    this.screen = null;
    this.dialog = null;
    this.editor = null;
    this.busylock = null;
    this.imageurl = null;
    this.editorsize = null;
    this.activetool = null;
    this.options =
        { imgsize: null
        , action: 'upload'
        , resetImage: null
        , ...options
        };

    this.defer = dompack.createDeferred();
    this.screen = screen;

    var desktopsize = screen.displayapp.container.getBoundingClientRect();
    this.editorsize = { x: parseInt(0.7 * desktopsize.width)
                      , y: parseInt(0.9 * desktopsize.height)
                      };
  }

  loadImageBlob(blob, settings)
  {
    if (this.busylock)
      return;

    // Take a busy lock during loading
    this.busylock = this.screen.displayapp.getBusyLock();

    this._readImageFile(blob, settings);
  }

  loadImageSrc(src, settings)
  {
    if (this.busylock)
      return;

    // Take a busy lock during loading
    this.busylock = this.screen.displayapp.getBusyLock();

    if (src.indexOf("data:") == 0)
    {
      //console.log("Convert image data from data URL to blob");
      var blob = dataURItoBlob(src);
      this._readImageFile(blob, settings);
    }
    else
    {
      var request = new XMLHttpRequest();
      request.onload = evt =>
      {
        //console.log("Received image file as Blob");
        var mimeType = request.getResponseHeader("Content-Type");
        var blob = new Blob([ request.response ], { type: mimeType });
        this._readImageFile(blob, settings);
      };
      request.open("GET", src, true);
      request.responseType = "blob";
      //console.log("Load image file as Blob");
      request.send();
    }
  }

  _readImageFile(file, settings)
  {
    var reader = new FileReader();
    var fixorientation = this.editor ? this.editor.fixorientation : this.options.imgsize ? this.options.imgsize.fixorientation : true;

    // Read the image as ArrayBuffer, so we can read its EXIF data
    reader.onload = () =>
    {
      var exifdata;
      try
      {
        if (fixorientation)
        {
          var parser = ExifParser.create(reader.result);
          exifdata = parser.parse();
        }
      }
      catch (e) {}
      //console.log("Parsed EXIF data", exifdata);

      var objecturl = (URL || webkitURL).createObjectURL(file);
      var options = { orientation: exifdata && exifdata.tags.Orientation
                    , mimetype: file.type
                    , refpoint: null
                    , filename: ""
                    , ...settings
                    }
      options.orgblob = file;
      this._loadImageUrl(objecturl, options);
    };
    //console.log("Read image file as ArrayBuffer");
    reader.readAsArrayBuffer(file);
  }

  _loadImageUrl(url, options)
  {
    var img = new Image(); //FIXME error handler
    img.addEventListener("load", (function()
    {
      (URL || webkitURL).revokeObjectURL(url);

      if (this.editor)
      {
        // The editor dialog is already opened, load the image into the editor
        //console.log("Load image into editor using object URL");
        this.editor.setImg(img, options);
      }
      else
      {
        // If this is an uploaded image which would not be changed by the image resize method, upload it directly
        if (this._skipEditor(img.width, img.height, options.mimetype))
        {
          //console.log("Fire 'done' event to upload the blob");
          this._closeImageEditor(options.orgblob, null);
        }
        else
        {
          //console.log("Create image editor dialog with object URL");
          this._createDialog();

          // Set image in a delay, so it's set after the relayout when showing the dialog, preventing an initial image resize
          setTimeout(() => this.editor.setImg(img, options),1);
        }
      }
    }).bind(this));

    img.addEventListener("error", e =>
    {
      console.error("Error loading image in imgeditor <img> element", e);
      if (this.busylock)
        this.busylock.release();
      this.busylock = null;

      runSimpleScreen(this.screen.displayapp,
          { title: getTid("tollium:components.imgedit.editor.title")
          , text: getTid("tollium:components.imgedit.messages.corruptimage")
          , icon: "warning"
          , buttons: [ { name: "close", title: getTid("tollium:common.actions.close") }
                     ]
          });
    });
    img.src = url;
  }

  _skipEditor(width, height, mimetype)
  {
    //console.log(this.options.action,this.options.imgsize,width,height,mimetype);
    // When editing, show editor
    if (this.options.action == "edit")
      return false;

    return !ImageEditor.resizeMethodApplied(this.options.imgsize, width, height, mimetype);
  }

  _createDialog()
  {
    this.dialog = this.screen.displayapp.createScreen(
        { frame:        { bodynode: 'root'
                        , specials: ['okaction','cancelaction']
                        , title: getTid("tollium:components.imgedit.editor.title")
                        , defaultbutton: "okbutton"
                        //, allowresize: true
                        , allowclose: true
                        , width: this.editorsize.x + "px", height: this.editorsize.y + "px"
                        }
        , root:         { type: 'panel', lines: [{items: [ {item:"body"} ], width: "1pr", height: "1pr"}
                                                ,{items: [ {item:"footer"} ]}
                                                ]
                        }
        , body:         { type: 'panel'
                        , lines: [ { title: "", items: [{item:"imageeditor"}], width: "1pr", height: "1pr" }
                                 ]
                        , width: "1pr", height: "1pr"
                        }
        , footer:       { type: 'panel'
                        , lines: [{items: [ {item:"minsizewarning"}
                                          , {item:"maxsizewarning"}
                                          , {item:"status"}
                                          , {item:"progress"}
                                          , {item:"okbutton"}
                                          , {item:"cancelbutton"}
                                          ]}
                                 ]
                        , spacers: { top:true, bottom:true, left:true, right:true }
                        , isfooter: true
                        , width:'1pr'
                        }
        , minsizewarning: { type: 'image', width: "16px", height: "16px", hint: getTid("tollium:components.imgedit.messages.minsizewarning")
                          , imgwidth: 16, imgheight: 16, settings: { imgname: "tollium:status/warning", width: 16, height: 16, color: "b" }
                          , visible: false
                          }
        , maxsizewarning: { type: 'image', width: "16px", height: "16px", hint: getTid("tollium:components.imgedit.messages.maxsizewarning")
                          , imgwidth: 16, imgheight: 16, settings: { imgname: "tollium:status/warning", width: 16, height: 16, color: "b" }
                          , visible: false
                          }
        , status:       { type: 'text', width: "1pr", ellipsis: true, value: "" }
        , progress:     { type: 'progress', width: "150px", max: 0, value: 0, visible: false }
        , okaction:     { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        , okbutton:     { type: 'button', title: getTid("tollium:common.actions.save"), action: 'okaction' }
        , cancelaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        , cancelbutton: { type: 'button', title: getTid("tollium:common.actions.cancel"), action: 'cancelaction' }
        , imageeditor:  { type: 'customhtml', width: "1pr", height: "1pr" }
        });
    this.modallayer = this.dialog.node.querySelector(".modallayer");

    this.dialog.setMessageHandler("okaction", "execute", this._onEditorOkButton.bind(this));
    this.dialog.setMessageHandler("cancelaction", "execute", this._onEditorCancelButton.bind(this, false));
    this.dialog.setMessageHandler("frame", "close", this._onEditorCancelButton.bind(this, true));

    // Initialize the image editor - ADDME can't we promote the imageeditor or its wrapper to a 'real' tollium element instead of the customhtml hack?
    var containercomp = this.dialog.getComponent("imageeditor");
    var container = containercomp.getContainer();
    container.addEventListener("tollium:resized", evt => this._onEditorResized(evt.detail));

    var options = { width: container.offsetWidth
                  , height: container.offsetHeight
                  , imgsize: this.options.imgsize
                  , resourcebase: $todd.resourcebase
                  , getBusyLock: this.screen.displayapp.getBusyLock.bind(this.screen.displayapp)
                  , setStatus: this._setStatus.bind(this)
                  , setProgress: this._setProgress.bind(this)
                  , createScreen: this.screen.displayapp.createScreen.bind(this.screen.displayapp)
                  , setModalLayerOpacity: this._setModalLayerOpacity.bind(this)
                  , editorBackground: "#ffffff url(" + whintegration.config.obj.checkered_background + ") top left"
                  };

    if (this.options.action == "edit")
    {
      if (this.options.resetImage)
        options.resetImage = this.options.resetImage;
      //ADDME: Drag-n-drop file upload in image editor?
    }

    this.editor = new ImageEditor(container, options);
    container.addEventListener("tollium-imageeditor:load", () => this._onEditorReady());
    this.editor.toolbar.toElement().addEventListener("modal-opened", this._onEditorOpenTool.bind(this));
    this.editor.toolbar.toElement().addEventListener("modal-closed", this._onEditorCloseTool.bind(this));
  }

  _relayoutDialog()
  {
    var frame = this.dialog.getComponent("frame");
    frame.recalculateDimensions();
    frame.relayout();
  }

  _closeDialog()
  {
    // Close editor dialog if still present
    if (this.dialog)
      this.dialog.terminateScreen();
    this.dialog = null;

    if (this.editor)
      this.editor.stop();
    this.editor = null;

    // Close busylock if still present
    if (this.busylock)
      this.busylock.release();
    this.busylock = null;
  }

  _setStatus(status, warning)
  {
    this.dialog.getComponent("minsizewarning").setVisible(warning === "min");
    this.dialog.getComponent("maxsizewarning").setVisible(warning === "max");
    this.dialog.getComponent("status").setValue(status);
    this._relayoutDialog();
  }

  _setProgress(value, max)
  {
    this.dialog.getComponent("progress").onMsgSetValMax({ value: value, max: max });
    this.dialog.getComponent("progress").setVisible(!!max);
    this._relayoutDialog();
  }

  _setModalLayerOpacity(opacity)
  {
    this.modallayer.style.opacity = opacity;
  }

  // sendblob true: retrieve image from editor
  // sendblob not null: send sendblob
  // sendblob null: don't send blob
  _closeImageEditor(sendblob, callback)
  {
    if (sendblob === true)
    {
      // Retrieve the image from the editor and close the dialog
      this.busylock = this.screen.displayapp.getBusyLock();
      this.editor.getImageAsBlob((blob, settings) =>
      {
        this.defer.resolve({ blob: blob, settings: settings, editcallback: () =>
        {
          if (callback)
            callback();
          this._closeDialog();
        }});
      });
    }
    else
    {
      // Upload the given blob and close the dialog
      this.defer.resolve({ blob: sendblob, settings: null, editcallback: () =>
      {
        if (callback)
          callback();
        this._closeDialog();
      }});
    }
  }

  _onEditorReady()
  {
    if (this.busylock)
      this.busylock.release();
    this.busylock = null;
  }

  _onEditorResized(data)
  {
    this.editorsize = { x: data.x, y: data.y };
    if (this.editor)
      this.editor.setSize(this.editorsize.x, this.editorsize.y);
  }

  _onEditorOpenTool(event)
  {
    this.activetool = event.detail;
    this.dialog.getComponent("okbutton").setTitle(getTid("tollium:common.actions.ok"));
    this.dialog.getComponent("frame").setTitle(getTid("tollium:components.imgedit.editor." + this.activetool.panel._imgedittool));
    this._relayoutDialog();
  }

  _onEditorCloseTool()
  {
    this.activetool = null;
    this.dialog.getComponent("okbutton").setTitle(getTid("tollium:common.actions.save"));
    this.dialog.getComponent("frame").setTitle(getTid("tollium:components.imgedit.editor.title"));
    this._relayoutDialog();
  }

  _onEditorOkButton(data, callback)
  {
    if (this.activetool)
    {
      // Apply the active tool
      this.activetool.apply();
      callback();
    }
    else
    {
      this._closeImageEditor(true, callback, null);
    }
  }

  async _onEditorCancelButton(frameclose, data, callback)
  {
    if (this.activetool)
    {
      // Closing the window when a tool is active
      if (frameclose)
      {
        let dialog = runSimpleScreen(this.screen.displayapp,
            { title: getTid("tollium:components.imgedit.editor.title")
            , text: getTid("tollium:components.imgedit.messages.confirmdiscardtool")
            , icon: "warning"
            , buttons: [ { name: "yes", title: getTid("tollium:common.actions.yes") }
                       , { name: "no", title: getTid("tollium:common.actions.no") }
                       ]
            });
        callback();

        if(await dialog == 'yes')
          this._closeImageEditor();

        return;
      }

      // Cancel the active tool
      this.activetool.cancel();
      callback();
    }
    else
    {
      // Closing the window when the image is edited
      if (this.editor.isDirty())
      {
        let dialog = runSimpleScreen(this.screen.displayapp,
            { title: getTid("tollium:components.imgedit.editor.title")
            , text: getTid("tollium:components.imgedit.messages.confirmdiscardchanges")
            , icon: "warning"
            , buttons: [ { name: "yes", title: getTid("tollium:common.actions.yes") }
                       , { name: "no", title: getTid("tollium:common.actions.no") }
                       , { name: "cancel", title: getTid("tollium:common.actions.cancel") }
                       ]
            });

        callback();

        if(await dialog == 'yes')
          this._closeImageEditor(true);
        else if(await dialog == 'no')
          this._closeImageEditor();

        return;
      }

      this._closeImageEditor(null, callback);
    }
  }
}

ImgeditDialogController.checkTypeAllowed = function(screen, type)
{
  let allowed_mimetypes = [ "image/jpeg", "image/png", "image/gif" ];
  if (!allowed_mimetypes.includes(type))
  {
    runSimpleScreen(screen.displayapp,
        { title: getTid("tollium:components.imgedit.editor.title")
        , text: getTid("tollium:components.imgedit.messages.unsupportedtype")
        , icon: "warning"
        , buttons: [ { name: "close", title: getTid("tollium:common.actions.close") }
                   ]
        });
    return false;
  }
  return true;
};

export default ImgeditDialogController;
