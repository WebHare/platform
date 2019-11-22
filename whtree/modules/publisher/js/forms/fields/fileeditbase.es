import * as dompack from 'dompack';
import * as upload from '@mod-system/js/compat/upload';
import * as formservice from '../internal/form.rpc.json';
import "../internal/form.lang.json";
import { getTid } from "@mod-tollium/js/gettid";
import FormBase from '../formbase';

function isAcceptableType(filetype, masks)
{
  if(masks.includes(filetype))
    return true;

  let basetype = filetype.split('/')[0];
  if(['image','video','audio'].includes(basetype) && masks.includes(basetype + '/*'))
    return true;

  return false;
}


export default class FileEditBase
{
  constructor(node, options)
  {
    let formnode = dompack.closest(node, 'form');
    if(formnode && !formnode.dataset.whFormId) //doesn't look like a RPC form
      return; //then don't replace it!

    this.node = node;
    //FIXME properly cooperate with required... but parsley will insist on validating if required is set
    this.isrequired = node.required || node.hasAttribute("data-wh-form-required");
    node.required = false;
    this.node.whFormsApiChecker = () => this._check();
    this.node.whUseFormGetValue=true;
    this.node.addEventListener('wh:form-getvalue', evt => this.getValue(evt));
    this.busy = false;
    this.deferredvalues = [];

    this.node.addEventListener('wh:form-enable', evt => this._handleEnable(evt));
    this.node.addEventListener('wh:form-require', evt => this._handleRequire(evt));
  }
  _afterConstruction() //all derived classes must invoke this at the end of their constructor
  {
    this._updateEnabledStatus(this._getEnabled()); //set current status, might already be disabled
  }
  _check()
  {
    if(this.isrequired && !this.getFieldValueLink())
      FormBase.setFieldError(this.node, getTid("publisher:site.forms.commonerrors.required"), { reportimmediately: false });
    else
      FormBase.setFieldError(this.node, "", { reportimmediately: false });
  }
  _handleEnable(evt)
  {
    dompack.stop(evt);
    this._updateEnabledStatus(evt.detail.enabled);
  }
  _handleRequire(evt)
  {
    dompack.stop(evt);
    this.isrequired = evt.detail.required;
  }
  _getEnabled()
  {
    return !this.node.disabled && !this.node.hasAttribute("data-wh-form-disabled");
  }
  _updateEnabledStatus(nowenabled)
  {
  }
  getValue(evt)
  {
    evt.preventDefault();
    evt.stopPropagation();

    this.deferredvalues.push(evt.detail.deferred);
    if(!this.busy)
      this.finishGetValue();
  }
  finishGetValue()
  {
    let valuelink = this.getFieldValueLink();
    let value = valuelink
        ? { link: valuelink, filename: this.node.dataset.whFilename, mimetype: this.node.dataset.whFiletype }
        : null;

    let toresolve = this.deferredvalues;
    this.deferredvalues = [];
    toresolve.forEach(deferred => deferred.resolve(value));
  }
  getFieldValueLink()
  {
    throw new Error("Derived classes must implement getFieldValueLink");
  }
  async selectFile(evt)
  {
    if(!this._getEnabled())
      return;

    evt.preventDefault();
    let lock = dompack.flagUIBusy();
    let files = await upload.selectFiles();
    this.uploadFile(files, lock);
  }
  _isAcceptableType(mimetype)
  {
    return !this.node.dataset.whAccept
           || isAcceptableType(mimetype, this.node.dataset.whAccept.split(','));
  }
  async uploadFile(files, lock)
  {
    if(files.length==0)
    {
      lock.release();
      return;
    }

    let uploadingcontrol = dompack.closest(this.node,".wh-form__fieldgroup");
    if(uploadingcontrol)
      uploadingcontrol.classList.add("wh-form--uploading");

    this.busy = true;
    try
    {
      let uploader = new upload.UploadSession(files);//ADDME - should identify us as permitted to upload eg , { params: { edittoken: ...} });
      let res = await uploader.upload();

      if(!this._isAcceptableType(res[0].type))
      {
        //TODO tell server it can destroy the file immediately (should have told uploadsession at the start?
        let msg = this.node.dataset.whAccepterror || getTid("publisher:site.forms.commonerrors.badfiletype");
        FormBase.setFieldError(this.node, msg, { reportimmediately: true });
        return;
      }

      res[0].url = await formservice.getUploadedFileFinalURL(res[0].url);

      this.node.dataset.whFilename = res[0].name;
      this.node.dataset.whFiletype = res[0].type;
      //this.filesize = result.size;
      await this.handleUploadedFile(res[0]);

      //FIXME this is just a webserver temporary session, need to get URLs with longer persistence
      dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
      this._check();
    }
    finally
    {
      this.busy = false;
      this.finishGetValue();
      lock.release();
      if(uploadingcontrol)
        uploadingcontrol.classList.remove("wh-form--uploading");
    }
  }
}
