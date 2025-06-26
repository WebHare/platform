/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import ExifParser from "exif-parser";

import * as whintegration from '@mod-system/js/wh/integration';
import { getTid } from "@webhare/gettid";
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import type Frame from '@mod-tollium/webdesigns/webinterface/components/frame/frame';

import { ImageEditor, resizeMethodApplied, type ImageEditorOptions, type RefPoint, type Size } from "../../components/imageeditor";

import "../../common.lang.json";
import "../../components/imageeditor/imageeditor.lang.json";
import type { ImageSurfaceSettings } from "../../components/imageeditor/surface";

export { type RefPoint } from "../../components/imageeditor";

export type ImageSettings = {
  refPoint: Size | null;
  fileName: string;
};

// http://www.nixtu.info/2013/06/how-to-upload-canvas-data-to-server.html
function dataURItoBlob(dataURI) {
  // convert base64 to raw binary data held in a string
  // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
  const byteString = atob(dataURI.split(',')[1]);

  // separate out the mime component
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to an ArrayBuffer
  const ab = new ArrayBuffer(byteString.length);
  const dw = new DataView(ab);
  for (let i = 0; i < byteString.length; i++) {
    dw.setUint8(i, byteString.charCodeAt(i));
  }

  // write the ArrayBuffer to a blob, and you're done
  return new Blob([ab], { type: mimeString });
}


class ImgeditDialogController {
  defer = Promise.withResolvers<{
    blob: Blob | null;
    settings: { refPoint: RefPoint } | null;
    editcallback: () => void;
  }>();
  screen: Frame;
  busylock: Disposable | null = null;
  editor: ImageEditor | null = null;
  dialog: Frame | null;
  options;

  constructor(screen: Frame, options?) {
    this.screen = screen;
    this.dialog = null;
    this.imageurl = null;
    this.editorsize = null;
    this.activetool = null;
    this.options =
    {
      imgsize: null,
      action: 'upload',
      ...options
    };

    const desktopsize = screen.displayapp.container.getBoundingClientRect();
    this.editorsize = {
      x: parseInt(0.7 * desktopsize.width),
      y: parseInt(0.9 * desktopsize.height)
    };
  }

  loadImageBlob(blob: File, settings: ImageSettings) {
    if ("refpoint" in settings)
      throw new Error("refpoint? should be refPoint"); //TODO remove once imageedit typings are complete
    if (this.busylock)
      throw new Error("Recursive LoadImage call");

    // Take a busy lock during loading
    this.busylock = this.screen.lockScreen();

    this._readImageFile(blob, settings);
  }

  loadImageSrc(src, settings: ImageSettings) {
    if ("refpoint" in settings)
      throw new Error("refpoint? should be refPoint"); //TODO remove once imageedit typings are complete
    if (this.busylock)
      throw new Error("Recursive LoadImage call");

    // Take a busy lock during loading. This locks the *parent* screen of our soon appearing image edit screen
    this.busylock = this.screen.lockScreen();

    if (src.indexOf("data:") === 0) {
      //console.log("Convert image data from data URL to blob");
      const blob = dataURItoBlob(src);
      this._readImageFile(blob, settings);
    } else {
      const request = new XMLHttpRequest();
      request.onload = () => {
        //console.log("Received image file as Blob");
        const mimeType = request.getResponseHeader("Content-Type");
        const blob = new Blob([request.response], { type: mimeType });
        this._readImageFile(blob, settings);
      };
      request.open("GET", src, true);
      request.responseType = "blob";
      //console.log("Load image file as Blob");
      request.send();
    }
  }

  _readImageFile(file: Blob, settings: ImageSettings) {
    const reader = new FileReader();
    const fixorientation = this.editor ? this.editor.fixorientation : this.options.imgsize ? this.options.imgsize.fixorientation : true;

    // Read the image as ArrayBuffer, so we can read its EXIF data
    reader.onload = () => {
      let exifdata;
      try {
        if (fixorientation) {
          const parser = ExifParser.create(reader.result);
          exifdata = parser.parse();
        }
      } catch (e) { }
      //console.log("Parsed EXIF data", exifdata);

      const objecturl = URL.createObjectURL(file);
      const options = {
        orientation: exifdata && exifdata.tags.Orientation,
        mimetype: file.type,
        filename: "",
        ...settings
      };
      options.orgblob = file;
      this._loadImageUrl(objecturl, options);
    };
    //console.log("Read image file as ArrayBuffer");
    reader.readAsArrayBuffer(file);
  }

  _loadImageUrl(url, options: ImageSurfaceSettings) {
    const img = new Image(); //FIXME error handler
    img.addEventListener("load", () => {
      URL.revokeObjectURL(url);

      if (this.editor) {
        // The editor dialog is already opened, load the image into the editor
        //console.log("Load image into editor using object URL");
        this.editor.setImg(img, options);
      } else {
        // If this is an uploaded image which would not be changed by the image resize method, upload it directly
        if (this._skipEditor(img.width, img.height, options.mimetype)) {
          //console.log("Fire 'done' event to upload the blob");
          this._closeImageEditor(options.orgblob, null);
        } else {
          //console.log("Create image editor dialog with object URL");
          this._createDialog();
          // This above _createDialog releases the applock as our parent screen is busy, not this new one! so we'll take a new lock
          this.busylock?.[Symbol.dispose]();
          this.busylock = this.dialog.lockScreen();

          // Set image in a delay, so it's set after the relayout when showing the dialog, preventing an initial image resize
          setTimeout(() => this.editor.setImg(img, options), 1);
        }
      }
    });

    img.addEventListener("error", e => {
      console.error("Error loading image in imgeditor <img> element", e);
      if (this.busylock)
        this.busylock.release();
      this.busylock = null;

      runSimpleScreen(this.screen.displayapp, {
        title: getTid("tollium:components.imgedit.editor.title"),
        text: getTid("tollium:components.imgedit.messages.corruptimage"),
        icon: "warning",
        buttons: [{ name: "close", title: getTid("~close") }]
      });
    });
    img.src = url;
  }

  _skipEditor(width, height, mimetype) {
    //console.log(this.options.action,this.options.imgsize,width,height,mimetype);
    // When editing, show editor
    if (this.options.action === "edit")
      return false;

    return !resizeMethodApplied(this.options.imgsize, width, height, mimetype);
  }

  private _createDialog() {
    this.dialog = this.screen.displayapp.createScreen({
      frame: {
        bodynode: 'root',
        specials: ['okaction', 'cancelaction'],
        title: getTid("tollium:components.imgedit.editor.title"),
        defaultbutton: "okbutton",
        //, allowresize: true
        allowclose: true,
        width: this.editorsize.x + "px", height: this.editorsize.y + "px"
      },
      root: {
        type: 'panel', lines: [
          { layout: "block", items: [{ item: "body" }], width: "1pr", height: "1pr" },
          { layout: "block", items: [{ item: "footer" }] }
        ]
      },
      body: {
        type: 'panel',
        lines: [{ layout: "block", title: "", items: [{ item: "imageeditor" }], width: "1pr", height: "1pr" }],
        width: "1pr", height: "1pr"
      },
      footer: {
        type: 'panel',
        lines: [
          {
            items: [
              { item: "minsizewarning" },
              { item: "maxsizewarning" },
              { item: "status" },
              { item: "progress" },
              { item: "okbutton" },
              { item: "cancelbutton" }
            ]
          }
        ],
        spacers: { top: true, bottom: true, left: true, right: true },
        isfooter: true,
        width: '1pr'
      },
      minsizewarning: {
        type: 'image', width: "16px", height: "16px", hint: getTid("tollium:components.imgedit.messages.minsizewarning"),
        imgwidth: 16, imgheight: 16, settings: { imgname: "tollium:status/warning", width: 16, height: 16, color: "b" },
        visible: false
      },
      maxsizewarning: {
        type: 'image', width: "16px", height: "16px", hint: getTid("tollium:components.imgedit.messages.maxsizewarning"),
        imgwidth: 16, imgheight: 16, settings: { imgname: "tollium:status/warning", width: 16, height: 16, color: "b" },
        visible: false
      },
      status: { type: 'text', width: "1pr", ellipsis: true, value: "" },
      progress: { type: 'progress', width: "150px", max: 0, value: 0, visible: false },
      okaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      okbutton: { type: 'button', title: getTid("~save"), action: 'okaction' },
      cancelaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
      cancelbutton: { type: 'button', title: getTid("~cancel"), action: 'cancelaction' },
      imageeditor: { type: 'customhtml', width: "1pr", height: "1pr" }
    });
    this.modallayer = this.dialog.node.querySelector(".modallayer");

    this.dialog.setMessageHandler("okaction", "execute", this._onEditorOkButton.bind(this));
    this.dialog.setMessageHandler("cancelaction", "execute", this._onEditorCancelButton.bind(this, false));
    this.dialog.setMessageHandler("frame", "close", this._onEditorCancelButton.bind(this, true));

    // Initialize the image editor - ADDME can't we promote the imageeditor or its wrapper to a 'real' tollium element instead of the customhtml hack?
    const containercomp = this.dialog.getComponent("imageeditor");
    const container = containercomp.getContainer();
    container.addEventListener("tollium:resized", evt => this._onEditorResized(evt.detail));

    const options: ImageEditorOptions = {
      width: container.offsetWidth,
      height: container.offsetHeight,
      imgSize: this.options.imgsize,
      getBusyLock: () => this.dialog!.lockScreen(),
      setStatus: this._setStatus.bind(this),
      setModalLayerOpacity: this._setModalLayerOpacity.bind(this),
      editorBackground: "#ffffff url(" + whintegration.config.obj.checkered_background + ") top left"
    };

    this.editor = new ImageEditor(container, options);
    container.addEventListener("tollium-imageeditor:load", () => this._onEditorReady());
    this.editor.toolbar.node.addEventListener("modal-opened", this._onEditorOpenTool.bind(this));
    this.editor.toolbar.node.addEventListener("modal-closed", this._onEditorCloseTool.bind(this));
  }

  _relayoutDialog() {
    const frame = this.dialog.getComponent("frame");
    frame.recalculateDimensions();
    frame.relayout();
  }

  _closeDialog() {
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

  _setStatus(status, warning) {
    this.dialog.getComponent("minsizewarning").setVisible(warning === "min");
    this.dialog.getComponent("maxsizewarning").setVisible(warning === "max");
    this.dialog.getComponent("status").setValue(status);
    this._relayoutDialog();
  }

  _setProgress(value, max) {
    this.dialog.getComponent("progress").onMsgSetValMax({ value: value, max: max });
    this.dialog.getComponent("progress").setVisible(Boolean(max));
    this._relayoutDialog();
  }

  _setModalLayerOpacity(opacity) {
    this.modallayer.style.opacity = opacity;
  }

  // sendblob true: retrieve image from editor
  // sendblob not null: send sendblob
  // sendblob null: don't send blob
  _closeImageEditor(sendblob, callback?) {
    if (sendblob === true) {
      // Retrieve the image from the editor and close the dialog
      this.busylock = this.screen.lockScreen();
      this.editor.getImageAsBlob((blob: Blob | null, settings: { refPoint: RefPoint }) => {
        if ("refpoint" in settings)
          throw new Error("refpoint? should be refPoint"); //TODO remove once imageedit typings are complete
        this.defer.resolve({
          blob: blob,
          settings: settings,
          editcallback: () => {
            if (callback)
              callback();
            this._closeDialog();
          }
        });
      });
    } else {
      // Upload the given blob and close the dialog
      this.defer.resolve({
        blob: sendblob,
        settings: null,
        editcallback: () => {
          if (callback)
            callback();
          this._closeDialog();
        }
      });
    }
  }

  _onEditorReady() {
    if (this.busylock)
      this.busylock.release();
    this.busylock = null;
  }

  _onEditorResized(data) {
    this.editorsize = { x: data.x, y: data.y };
    if (this.editor)
      this.editor.setSize(this.editorsize.x, this.editorsize.y);
  }

  _onEditorOpenTool(event) {
    this.activetool = event.detail;
    this.dialog.getComponent("okbutton").setTitle(getTid("~ok"));

    const title = this.activetool.panel.imageEditTool === "refpoint" ? getTid("tollium:components.imgedit.editor.refpoint")
      : this.activetool.panel.imageEditTool === "crop" ? getTid("tollium:components.imgedit.editor.crop")
        : "";
    this.dialog.getComponent("frame").setTitle(title);
    this._relayoutDialog();
  }

  _onEditorCloseTool() {
    this.activetool = null;
    this.dialog.getComponent("okbutton").setTitle(getTid("~save"));
    this.dialog.getComponent("frame").setTitle(getTid("tollium:components.imgedit.editor.title"));
    this._relayoutDialog();
  }

  _onEditorOkButton(_data, callback) {
    if (this.activetool) {
      // Apply the active tool
      this.activetool.apply();
      callback();
    } else {
      this._closeImageEditor(true, callback, null);
    }
  }

  async _onEditorCancelButton(frameclose, _data, callback) {
    if (this.activetool) {
      // Closing the window when a tool is active
      if (frameclose) {
        const dialog = runSimpleScreen(this.screen.displayapp,
          {
            title: getTid("tollium:components.imgedit.editor.title"),
            text: getTid("tollium:components.imgedit.messages.confirmdiscardtool"),
            icon: "warning",
            buttons: [
              { name: "yes", title: getTid("~yes") },
              { name: "no", title: getTid("~no") }
            ]
          });
        callback();

        if (await dialog === 'yes')
          this._closeImageEditor();

        return;
      }

      // Cancel the active tool
      this.activetool.cancel();
      callback();
    } else {
      // Closing the window when the image is edited
      if (this.editor.isDirty()) {
        const dialog = runSimpleScreen(this.screen.displayapp,
          {
            title: getTid("tollium:components.imgedit.editor.title"),
            text: getTid("tollium:components.imgedit.messages.confirmdiscardchanges"),
            icon: "warning",
            buttons: [
              { name: "yes", title: getTid("~yes") },
              { name: "no", title: getTid("~no") },
              { name: "cancel", title: getTid("~cancel") }
            ]
          });

        callback();

        if (await dialog === 'yes')
          this._closeImageEditor(true);
        else if (await dialog === 'no')
          this._closeImageEditor();

        return;
      }

      this._closeImageEditor(null, callback);
    }
  }

  static checkTypeAllowed(screen, type) {
    const allowed_mimetypes = ["image/jpeg", "image/png", "image/gif"];
    if (!allowed_mimetypes.includes(type)) {
      runSimpleScreen(screen.displayapp,
        {
          title: getTid("tollium:components.imgedit.editor.title"),
          text: getTid("tollium:components.imgedit.messages.unsupportedtype"),
          icon: "warning",
          buttons: [{ name: "close", title: getTid("~close") }]
        });
      return false;
    }
    return true;
  }
};

export default ImgeditDialogController;
