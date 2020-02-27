import * as dompack from 'dompack';
import ActionForwardBase from './actionforwardbase';
import * as feedback from "../../js/feedback";

import { getTid } from "@mod-tollium/js/gettid";
import DownloadManager from '@mod-system/js/compat/download';

import * as toddupload from '@mod-tollium/web/ui/js/upload';
import ImgeditDialogController from '@mod-tollium/web/ui/js/dialogs/imgeditcontroller';
var $todd = require('@mod-tollium/web/ui/js/support');
require("@mod-tollium/web/ui/common.lang.json");
require("@mod-tollium/web/ui/components/imageeditor/imageeditor.lang.json");

/****************************************************************************************************************************
 *                                                                                                                          *
 *  ACTION                                                                                                                  *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjAction extends ActionForwardBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "action";
    this.lastenabled = null;
    this.pendingdownloads = [];

    this.customaction = data.customaction;
    this.target = data.targetname;

    this.frameflags = data.frameflags||[];
    this.enableons = data.enableons || [];
    this.mimetypes = data.mimetypes || [];
    this.multiple = !("multiple" in data) || data.multiple;
    this.imageaction = !!data.imageaction;
    this.actiontype = data.actiontype;
    this.imgsize = data.imgsize;
    this._onexecute = data.onexecute;
    this.source = data.source; //for copy action

    /*
    if (this.shortcut)
    {
      var enableonsources = [];
      for (var idx=0; idx<this.enableons.length; idx++)
        enableonsources.push(this.enableons[idx].source);

      console.info(enableonsources.join(","), this.shortcut);
    }
    */


    if (data.editimage)
    {
      this.editimage = data.editimage.image;
      this.onExecute();
    }
  }

  onExecute(options)
  {
    options = { ignorebusy: false, ...(options || {}) };
    var hitrule = this.getHitRule();

    // application already busy?
    if (this.owner.isBusy() && !options.ignorebusy )
      return false;

    if(hitrule == -1) //we are not enabled
    {
      this.debugLog("actionenabler", "- Action is explicitly disabled by client");
      return false;
    }

    if(this.isEventUnmasked('upload'))
      this.executeUploadAction({rule:hitrule});
    else if(this.isEventUnmasked('download'))
      this.executeDownloadAction({rule:hitrule});
    else if(this.isEventUnmasked('windowopen'))
      this.executeWindowOpenAction({rule:hitrule});
    else if(this.isEventUnmasked('handlefeedback'))
      this.executeHandleFeedback({rule:hitrule});
    else if(this.isEventUnmasked('copytoclipboard'))
      this.executeCopyToClipboard({rule:hitrule});
    else if(this.isEventUnmasked('execute'))
      this.queueMessage("execute", {rule:hitrule}, true);
    else if (this._onexecute)
    {
      var block = this.owner.displayapp.getBusyLock('action');
      this._onexecute(this, { rule:hitrule }, block.release.bind(block));
    }

    var customaction = this.enableons.length ? this.enableons[hitrule].customaction : this.customaction;
    if(customaction && $todd.customactions[customaction])
    {
      $todd.customactions[customaction]({ action: this.name
                                        , screen: this.owner
                                        });
    }
  }

  isEnabled()
  {
    if (this.lastenabled === null)
      this.checkEnabled();
    return this.lastenabled;
  }

  getHitRule()
  {
    if (!this.xml_enabled)
    {
      this.debugLog("actionenabler", "- Action is explicitly disabled by client");
      return -1;
    }

    var checked = this.frameflags.length == 0 || this.owner.enabledOn(this.frameflags, 1, 1, "all");
    if(!checked)
    {
      this.debugLog("actionenabler", "- Action is disabled by frameflags");
      return -1;
    }

    let hitrule = this.owner.getMatchedEnableOnRule(this.enableons);
    this.debugLog("actionenabler", `- hit rule #${hitrule}`);
    return hitrule;
  }

  checkEnabled()
  {
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

    var enabled = this.getHitRule() != -1;
    this.debugLog("actionenabler", "- Action is "+(enabled?"enabled":"disabled"));

    if(this.lastenabled !== enabled)
    {
      this.lastenabled = enabled;
      this.debugLog("actionenabler", "- Informing any listeners");
      this.owner.broadcastActionUpdated(this);
    }
  }

  executeUploadAction(data)
  {
    if (this.imageaction)
    {
      switch (this.actiontype)
      {
        case "upload":
        {
          let busylock = dompack.flagUIBusy();
          toddupload.receiveFiles(this, { mimetypes: this.mimetypes
                                        , multiple: this.multiple
                                        }).then(files =>
          {
            if (files.length)
              this.handleImageUploaded(data, files[0]);
          }).finally(() => busylock.release());
          return;
        }
        case "edit":
        {
          if (!this.editimage)
          {
            console.warn("imageaction edit called without image");
            return;
          }
          // Edit image directly without uploading
          this.handleImageUploaded(data, this.editimage);
          return;
        }
      }
    }
    else
    {
      let busylock = dompack.flagUIBusy();
      toddupload.uploadFiles(this, function(files, callback)
        {
          busylock.release();
          if (!files.length)
          {
            callback();
            return;
          }
          data.items = files.map(function(i) { return { type: "file", filename: i.filename, token: i.filetoken }; });
          this.asyncMessage("upload", data).then(callback);
        }.bind(this), { mimetypes: this.mimetypes
                      , multiple: this.multiple
                      });
    }
  }

  executeDownloadAction(data)
  {
    var fturl = this.getFileTransferURL('asyncdownload');

    var dl = new DownloadManager(fturl.url, {});
    dl.startDownload().then(result =>
    {
      if (result.started)
        this.onDownloadStarted(dl, fturl.id);
      else
        this.onDownloadFailed(dl, fturl.id);
    });

    this.pendingdownloads.push(dl);
    this.queueMessage('download', { rule: data.rule, ftid: fturl.id }, true);
  }

  executeWindowOpenAction(data)
  {
    var fturl = this.getFileTransferURL('asyncwindowopen');

    window.open(fturl.url, this.target || "_blank");
    this.queueMessage('windowopen', { rule: data.rule, ftid: fturl.id }, true);
  }

  executeHandleFeedback(data)
  {
    feedback.run();
  }

  executeCopyToClipboard(data)
  {
    let comp = this.owner.getComponent(this.source);
    if(comp)
      comp.doCopyToClipboard();
  }

  onDownloadStarted(dl, id)
  {
    this.pendingdownloads = this.pendingdownloads.filter(item => item != dl); //erase
    this.queueMessage("download-started", { ftid: id }, true);
  }

  onDownloadFailed(dl, id)
  {
    this.pendingdownloads = this.pendingdownloads.filter(item => item != dl); //erase
    this.queueMessage("download-failed", { ftid: id }, true);
  }

  onMsgTarget(data)
  {
    this.target = data.target;
  }

  handleImageReset()
  {
    return new Promise(function(resolve)
    {
      $todd.createMessageBox(this.owner.displayapp,
          { title: getTid("tollium:components.imgedit.editor.title")
          , text: getTid("tollium:components.imgedit.messages.confirmreset")
          , icon: "question"
          , buttons: [ { name: "yes", title: getTid("tollium:common.actions.yes") }
                     , { name: "no", title: getTid("tollium:common.actions.no") }
                     ]
          , onclose:function(result)
            {
              if (result == "yes")
                this.queueMessage("resend", {}, true);
              resolve(result);
            }.bind(this)
          });
    }.bind(this));
  }

  async handleImageUploaded(data, file)
  {
    if (!file || !ImgeditDialogController.checkTypeAllowed(this.owner, file.type))
      return;

    var options = { mimetype: file.type
                  , imgsize: this.imgsize
                  , action: this.actiontype
                  , resetImage: file.source_fsobject ? this.handleImageReset.bind(this) : null
                  };

    let imageeditdialog = new ImgeditDialogController(this.owner, options);
    let settings = { refpoint: file.refpoint
                   , filename: file.name
                   };

    if (file.url)
      imageeditdialog.loadImageSrc(file.url, settings);
    else
      imageeditdialog.loadImageBlob(file, settings);

    let done = await imageeditdialog.defer.promise;

    // Note: settings is null when the image wasn't edited after upload
    if (done.blob)
    {
      toddupload.uploadBlobs(this, [done.blob], (files, uploadcallback) =>
      {
        // Only called when a file is actually uploaded
        var filename = toddupload.ensureExtension(file.name, files[0].fileinfo.extension);

        var extradata = { imageeditor: { source_fsobject: parseInt(file.source_fsobject) || 0
                                       , refpoint: done.settings && done.settings.refpoint
                                       }};
        data.items = [{ type: "file", name: filename, token: files[0].filetoken, extradata: extradata }];
        this.asyncMessage("upload", data).then( () =>
        {
          uploadcallback();
          done.editcallback();
        });
      });
    }
    else
    {
      // Nothing to upload, we're done
      done.editcallback();
    }
  }

/****************************************************************************************************************************
* Events
*/

  applyUpdate(data)
  {
    switch(data.type)
    {
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
