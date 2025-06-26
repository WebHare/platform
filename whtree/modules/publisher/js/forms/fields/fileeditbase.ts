/* eslint-disable @typescript-eslint/no-floating-promises -- FIXME: needs API rework */

import * as dompack from 'dompack';
import { requestFile } from "@webhare/upload";

import { getTid } from "@webhare/gettid";
import { setFieldError } from '@mod-publisher/js/forms/internal/customvalidation';
import { getFieldDisplayName } from '@webhare/forms/src/domsupport';
import { JSFormElement } from '@webhare/forms/src/jsformelement';
import type { FormFileValue } from '@webhare/forms/src/types';
import "@mod-publisher/js/forms/internal/form.lang.json"; //we need eg publisher:site.forms.selectfile

function isAcceptableType(fileType: string, masks: string[]) {
  if (masks.includes(fileType))
    return true;

  const basetype = fileType.split('/')[0];
  if (['image', 'video', 'audio'].includes(basetype) && masks.includes(basetype + '/*'))
    return true;

  return false;
}


export abstract class FileEditElement extends JSFormElement<FormFileValue[]> {
  root;
  maindiv;
  readonly group: HTMLElement | null;

  /** The current uploaded files */
  protected currentFiles = new Array<FormFileValue>;
  /** Maximum number of files */
  protected maxFiles;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open', delegatesFocus: true });
    this.maindiv = document.createElement("div");
    this.maindiv.inert = this.disabled;

    const csslink = document.createElement("link");
    csslink.rel = "stylesheet";
    csslink.href = "/.wh/ea/p/forms/controls.css";
    this.root.append(csslink, this.maindiv);

    this.group = this.closest<HTMLElement>(".wh-form__fieldgroup");
    this.whFormsApiChecker = async () => { await this._check(); };
    this.maxFiles = parseInt(this.getAttribute("max-files")!) || 1;
    if (this.getAttribute("value"))
      this.#setValue(JSON.parse(this.getAttribute("value")!));

    if (this.group) {
      this.group.addEventListener("dragover", evt => evt.preventDefault());
      this.group.addEventListener("dragenter", evt => evt.preventDefault());
      this.group.addEventListener("drop", evt => this.doDrop(evt));
    }
  }
  abstract refresh(): void;
  isSet(): boolean {
    return this.currentFiles.length > 0;
  }
  async _check() {
    const error = this.required && !this.isSet();
    if (error)
      setFieldError(this, getTid("publisher:site.forms.commonerrors.required"), { reportimmediately: false });
    else
      setFieldError(this, "", { reportimmediately: false });
    return error;
  }

  protected refreshState() {
    this.maindiv.inert = this.disabled;
  }

  get value(): FormFileValue[] {
    return this.currentFiles;
  }

  set value(value: FormFileValue[]) {
    this.#setValue(value);
    this.refresh();
  }

  #setValue(value: Array<Partial<FormFileValue>>) { //taking a partial so we can do a better job at fixing missing fields from incorrect callers
    //updates the value but does not fire events/refresh()
    const toset: FormFileValue[] = [];

    for (const row of value) {
      if (row?.file) {
        if (!this._isAcceptableType(row.file.type))
          throw new Error(`File type ${row.file.type} is not acceptable for ${getFieldDisplayName(this)}`);
        toset.push({ fileName: row.fileName || row.file.name, file: row.file, link: null });
      } else if (row?.link) {
        toset.push({ fileName: row.fileName || "", file: null, link: row.link });
      } else {
        throw new Error(`Incorrect value type received for ${getFieldDisplayName(this)} - expect 'file' or 'link' to be set`);
      }

      if (toset.length >= this.maxFiles)
        break;
    }
    this.currentFiles = toset;
  }

  _isAcceptableType(mimetype: string) {
    const accept = this.getAttribute("accept")?.split(',').map(mask => mask.trim()) ?? [];
    return !accept.length || isAcceptableType(mimetype, accept);
  }

  private doDrop(evt: DragEvent) {
    //FIXME check 'accept' - or can the drag handlers do that?
    evt.preventDefault();

    const files = evt.dataTransfer?.files;
    if (files)
      this.processUpload(files[0]);
  }

  async uploadFile(evt: Event) {
    evt.preventDefault();

    if (this.disabled || this.currentFiles.length >= this.maxFiles)
      return; //should not even have been offered?

    const accept = this.getAttribute("accept")?.split(',') ?? [];
    using lock = dompack.flagUIBusy();
    void (lock);

    const file = await requestFile({ accept });
    if (!file)
      return;

    await this.processUpload(file);
  }

  private async processUpload(file: File) {
    if (this.disabled || this.currentFiles.length >= this.maxFiles)
      return; //should not even have been offered?

    if (!this._isAcceptableType(file.type)) {
      //TODO tell server it can destroy the file immediately (should have told uploadsession at the start?
      const msg = this.dataset.whAccepterror || getTid("publisher:site.forms.commonerrors.badfiletype");
      setFieldError(this, msg, { reportimmediately: true });
      return;
    }

    this.currentFiles.push({ fileName: file.name, file: file, link: null });
    this.refresh();
    dompack.dispatchCustomEvent(this, 'change', { bubbles: true, cancelable: false });
  }

  protected deleteFile(evt: Event, idx: number) {
    if (evt)
      dompack.stop(evt);

    this.currentFiles.splice(idx, 1);
    this.refresh();
    dompack.dispatchCustomEvent(this, 'change', { bubbles: true, cancelable: false });
  }

  protected setupUploadButton(button: HTMLElement) {
    button.addEventListener("click", evt => void this.uploadFile(evt));
  }

  protected setupDeleteButton(button: HTMLElement, idx: number) {
    button.addEventListener("click", evt => this.deleteFile(evt, idx));
    button.ariaLabel = getTid("publisher:site.forms.imgedit-remove");
  }
}
