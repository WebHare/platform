/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/no-floating-promises -- Needs thorough review */
import * as dompack from 'dompack';
import ActionForwardBase from './actionforwardbase';
import DownloadManager from '@mod-system/js/compat/download';

import * as toddupload from '@mod-tollium/web/ui/js/upload';
import { requestFile } from "@webhare/upload";
import ImgeditDialogController, { type RefPoint } from '@mod-tollium/web/ui/js/dialogs/imgeditcontroller';
import * as $todd from "@mod-tollium/web/ui/js/support";
import type { ComponentBaseUpdate, ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import type { EnableOnRule } from '@mod-tollium/web/ui/js/types';
import { omit } from '@webhare/std';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("@mod-tollium/web/ui/common.lang.json");
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("@mod-tollium/web/ui/components/imageeditor/imageeditor.lang.json");

type EditImage = {
  url: string;
  name: string;
  type: string;
  source_fsobject: number;
  refpoint?: {
    x: number;
    y: number;
  };
};

interface ActionAttributes extends ComponentStandardAttributes {
  customaction?: string;
  targetname: string;
  frameflags: string[];
  enableons: EnableOnRule[];
  mimetypes: string[];
  multiple: boolean;
  imageaction?: true;
  actiontype?: string;
  imgsize?: ImageSize | null;
  onexecute?: (comp: ObjAction, data: { rule: number }, callback: () => void) => void; //NOTE this is not passed to us by HareScript, only through clientside component building
  source?: string;
  editimage?: { image: EditImage };
}

type ActionUpdate = {
  type: "execute";
  image: EditImage;
} | ComponentBaseUpdate;

interface ImageSize {
  method: string;
  setwidth: number;
  setheight: number;
  format: string;
  bgcolor: string;
  noforce: boolean;
  fixorientation: boolean;
  allowedactions: string[];
}

/****************************************************************************************************************************
 *                                                                                                                          *
 *  ACTION                                                                                                                  *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjAction extends ActionForwardBase<ActionAttributes> {
  imageaction: boolean;
  actiontype;
  mimetypes: string[];
  lastenabled: null | boolean = null;
  pendingdownloads: DownloadManager[] = [];
  customaction?: string;
  target: string;
  frameflags;
  enableons;
  imgsize;
  multiple: boolean;
  _onexecute: ActionAttributes["onexecute"];
  source;
  editimage?: EditImage;

  constructor(parentcomp: ToddCompBase | null, data: ActionAttributes) {
    super(parentcomp, data);
    this.componenttype = "action";

    this.customaction = data.customaction;
    this.target = data.targetname;

    this.frameflags = data.frameflags || [];
    this.enableons = data.enableons || [];
    this.mimetypes = data.mimetypes || [];
    this.multiple = Boolean(!("multiple" in data) || data.multiple);
    this.imageaction = Boolean(data.imageaction);
    this.actiontype = data.actiontype;
    this.imgsize = data.imgsize;
    this._onexecute = data.onexecute;
    this.source = data.source || ""; //for copy action

    /*
    if (this.shortcut)
    {
      var enableonsources = [];
      for (var idx=0; idx<this.enableons.length; idx++)
        enableonsources.push(this.enableons[idx].source);

      console.info(enableonsources.join(","), this.shortcut);
    }
    */


    if (data.editimage) {
      this.editimage = data.editimage.image;
      this.onExecute();
    }
  }

  onExecute({ ignorebusy = false } = {}) {
    const hitrule = this.getHitRule();

    // application already busy?
    if (this.owner.isBusy() && !ignorebusy)
      return false;

    if (hitrule === -1) {//we are not enabled
      this.debugLog("actionenabler", "- Action is explicitly disabled by client");
      return false;
    }

    if (this.isEventUnmasked('upload'))
      void this.executeUploadAction({ rule: hitrule });
    else if (this.isEventUnmasked('download'))
      this.executeDownloadAction({ rule: hitrule });
    else if (this.isEventUnmasked('windowopen'))
      this.executeWindowOpenAction({ rule: hitrule });
    else if (this.isEventUnmasked('copytoclipboard'))
      this.executeCopyToClipboard();
    else if (this.isEventUnmasked('execute'))
      this.queueMessage("execute", { rule: hitrule }, true);
    else if (this._onexecute) {
      const block = this.owner.lockScreen();
      this._onexecute(this, { rule: hitrule }, () => block.release());
    }

    const customaction = this.enableons.length ? this.enableons[hitrule].customaction : this.customaction;
    if (customaction && $todd.customactions[customaction]) {
      $todd.customactions[customaction]({
        action: this.name,
        screen: this.owner
      });
    }
  }

  isEnabled() {
    if (this.lastenabled === null)
      this.checkEnabled();
    return this.lastenabled;
  }

  getHitRule() {
    if (!this.xml_enabled) {
      this.debugLog("actionenabler", "- Action is explicitly disabled by client");
      return -1;
    }

    const checked = this.frameflags.length === 0 || this.owner.isEnabledOn(this.frameflags, 1, 1, "all");
    if (!checked) {
      this.debugLog("actionenabler", "- Action is disabled by frameflags");
      return -1;
    }

    const hitrule = this.owner.getMatchedEnableOnRule(this.enableons);
    this.debugLog("actionenabler", `- hit rule #${hitrule}`);
    return hitrule;
  }

  checkEnabled() {
    this.debugLog("actionenabler", `Checking action ${this.name}`);

    /* An action is enabled when
       - All checkedons constraints (enableons on the frame) are matched
       - Either:
         - No enableons are present
         - Enableons are present.
           - All of the sources exist
           - One of the rules matches:
             - The source is either the frame OR is focused (and its screen is active)
             - The rule has a handler
             - The source selection matches the constraints
       Synchronize the code with HareScript TolliumAction::TolliumClick
    */

    const enabled = this.getHitRule() !== -1;
    this.debugLog("actionenabler", "- Action is " + (enabled ? "enabled" : "disabled"));

    if (this.lastenabled !== enabled) {
      this.lastenabled = enabled;
      this.debugLog("actionenabler", "- Informing any listeners");
      this.owner.broadcastActionUpdated(this);
    }
  }

  private async executeUploadAction(data: { rule: number }): Promise<void> {
    if (this.imageaction) {
      switch (this.actiontype) {
        case "upload": {
          using busylock = dompack.flagUIBusy();
          void busylock;

          const file = await requestFile({ accept: this.mimetypes });
          if (file)
            this.handleImageUploaded(data, file);

          return;
        }
        case "edit":
          {
            if (!this.editimage) {
              console.warn("imageaction edit called without image");
              return;
            }
            // Edit image directly without uploading
            this.handleImageUploaded(data, this.editimage);
            return;
          }
      }
    } else {
      const busylock = dompack.flagUIBusy();
      toddupload.uploadFiles(this, async (files, callback) => {
        busylock.release();
        if (files.length)
          await this.asyncRequest("upload", {
            rule: data.rule,
            items: files.map(i => ({ type: "file", filename: i.filename, token: i.filetoken }))
          });

        callback();
      }, {
        accept: this.mimetypes || undefined,
        multiple: this.multiple
      });
    }
  }

  executeDownloadAction(data: { rule: number }) {
    const fturl = this.getFileTransferURL('asyncdownload');

    const dl = new DownloadManager(fturl.url);
    dl.startDownload().then(result => {
      if (result.started)
        this.onDownloadStarted(dl, fturl.id);
      else
        this.onDownloadFailed(dl, fturl.id);
    });

    this.pendingdownloads.push(dl);
    this.queueMessage('download', { rule: data.rule, ftid: fturl.id }, true);
  }

  executeWindowOpenAction(data: { rule: number }) {
    const fturl = this.getFileTransferURL('asyncwindowopen');

    // If "noopener" is supplied as the third argument, a new window is always opened in Safari instead of a new tab
    // (Setting opener afterwards is functionally equivalent to supplying the "noopener" window feature; the new location is
    // only loaded in the next tick)
    const newwindow = window.open(fturl.url, this.target || "_blank");
    if (newwindow)
      newwindow.opener = null;
    this.queueMessage('windowopen', { rule: data.rule, ftid: fturl.id }, true);
  }

  executeCopyToClipboard() {
    const comp = this.owner.getComponent(this.source);
    if (comp)
      comp.doCopyToClipboard();
  }

  onDownloadStarted(dl: DownloadManager, id: string) {
    this.pendingdownloads = this.pendingdownloads.filter(item => item !== dl); //erase
    this.queueMessage("download-started", { ftid: id }, true);
  }

  onDownloadFailed(dl: DownloadManager, id: string) {
    this.pendingdownloads = this.pendingdownloads.filter(item => item !== dl); //erase
    this.queueMessage("download-failed", { ftid: id }, true);
  }

  onMsgTarget(data: { target: string }) {
    this.target = data.target;
  }

  //We're invoked after upload *OR* with the image record prepared by imgedit.whlib editaction.
  async handleImageUploaded(data: { rule: number }, file: File | { type: string; url?: string; name: string; source_fsobject: number; refpoint?: RefPoint }) {
    if ("refPoint" in file)
      throw new Error("refPoint? from HS we would expect refpoint");

    if (!file || !ImgeditDialogController.checkTypeAllowed(this.owner, file.type))
      return;

    if ("refpoint" in file)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- disable for now until we better align the refpoint/refPoint
      file = { ...omit(file, ["refpoint"]), refPoint: file.refpoint } as any;

    toddupload.handleImageUpload(this, file, async (imgdata: toddupload.ImageUploadCallbackData) => {
      await this.asyncRequest("Upload", {
        rule: data.rule,
        items: [{ type: "file", ...imgdata }]
      });
    }, {
      mimetype: file.type,
      imgsize: this.imgsize,
      action: this.actiontype || ''
    });
  }

  /****************************************************************************************************************************
  * Events
  */

  applyUpdate(data: ActionUpdate) {
    switch (data.type) {
      case "execute":
        {
          this.editimage = data.image;
          this.onExecute({ ignorebusy: true });
          return;
        }
    }
    super.applyUpdate(data);
  }
}
