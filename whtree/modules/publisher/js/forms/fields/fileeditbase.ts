import * as dompack from 'dompack';
import { SingleFileUploader, requestFile } from "@webhare/upload";

import "../internal/form.lang.json";
import { getTid } from "@mod-tollium/js/gettid";
import { FormBase, setFieldError } from '@mod-publisher/js/forms';
import { isFormControl } from '@webhare/dompack';

function isAcceptableType(fileType: string, masks: string[]) {
  if (masks.includes(fileType))
    return true;

  const basetype = fileType.split('/')[0];
  if (['image', 'video', 'audio'].includes(basetype) && masks.includes(basetype + '/*'))
    return true;

  return false;
}


export default abstract class FileEditBase {
  readonly node: HTMLElement;
  readonly group: HTMLElement | null;
  hasChanged = false;
  isrequired: boolean;
  busy = false;

  /** The current uploaded file. May not contain a useful value if hasChanged === false */
  uploadedFile: File | null = null;

  constructor(node: HTMLElement) {
    this.node = node;
    this.group = this.node.closest<HTMLElement>(".wh-form__fieldgroup");

    this.isrequired = (isFormControl(node) && node.required) || node.hasAttribute("data-wh-form-required");
    //@ts-ignore does forms even pick up on this?
    node.required = false;
    this.node.whFormsApiChecker = () => this._check();
    this.node.whUseFormGetValue = true;
    this.node.addEventListener('wh:form-getvalue', evt => this.getValue(evt));

    this.node.addEventListener('wh:form-enable', evt => this._handleEnable(evt));
    this.node.addEventListener('wh:form-require', evt => this._handleRequire(evt));

    if (this.group) {
      this.group.addEventListener("dragover", evt => evt.preventDefault());
      this.group.addEventListener("dragenter", evt => evt.preventDefault());
      this.group.addEventListener("drop", evt => this.doDrop(evt));
    }
  }
  _afterConstruction() { //all derived classes must invoke this at the end of their constructor
    this._updateEnabledStatus(this._getEnabled()); //set current status, might already be disabled
  }
  isSet() {
    return this.uploadedFile !== null;
  }
  _check() {
    if (this.isrequired && !this.isSet())
      setFieldError(this.node, getTid("publisher:site.forms.commonerrors.required"), { reportimmediately: false });
    else
      setFieldError(this.node, "", { reportimmediately: false });
  }
  _handleEnable(evt: CustomEvent<{ enabled: boolean }>) {
    dompack.stop(evt);
    this._updateEnabledStatus(evt.detail.enabled);
  }
  _handleRequire(evt: CustomEvent<{ required: boolean }>) {
    dompack.stop(evt);
    this.isrequired = evt.detail.required;
  }
  _getEnabled() {
    return !(isFormControl(this.node) && this.node.disabled) && !this.node.hasAttribute("data-wh-form-disabled");
  }
  _updateEnabledStatus(nowenabled: boolean) {
  }
  getValue(evt: CustomEvent<{ deferred: PromiseWithResolvers<unknown> }>) {
    dompack.stop(evt);
    evt.preventDefault();
    evt.stopPropagation();
    evt.detail.deferred.resolve(this.hasChanged ? this.uploadedFile || { token: "" } : null);
  }

  _isAcceptableType(mimetype: string) {
    return !this.node.dataset.whAccept
      || isAcceptableType(mimetype, this.node.dataset.whAccept.split(','));
  }

  private doDrop(evt: DragEvent) {
    //FIXME check 'accept' - or can the drag handlers do that?
    evt.preventDefault();

    const files = evt.dataTransfer?.files;
    if (files)
      this.processUpload(new SingleFileUploader(files[0]));
  }

  async selectFile(evt: Event) {
    if (!this._getEnabled())
      return;

    evt.preventDefault();

    const accept = this.node.dataset.whAccept?.split(',') ?? [];
    using lock = dompack.flagUIBusy();
    void (lock);

    const uploader = await requestFile({ accept });
    if (!uploader)
      return;

    await this.processUpload(uploader);
  }

  /** Allow derived classes to update their UI after the `uploadedFile` has changed. */
  protected uploadHasChanged() {
  }

  private async processUpload(uploader: SingleFileUploader) {
    const formNode = this.node.closest('form');
    const form = formNode ? FormBase.getForNode(formNode) : null;
    if (!form)
      throw new Error(`Upload control is missing its form`);

    if (!this._isAcceptableType(uploader.file.type)) {
      //TODO tell server it can destroy the file immediately (should have told uploadsession at the start?
      const msg = this.node.dataset.whAccepterror || getTid("publisher:site.forms.commonerrors.badfiletype");
      setFieldError(this.node, msg, { reportimmediately: true });
      return;
    }

    this.hasChanged = true;
    this.uploadedFile = uploader.file;
    this.node.dataset.whFilename = uploader.file.name;
    this.node.dataset.whFiletype = uploader.file.type;

    await this.uploadHasChanged();
  }
}
