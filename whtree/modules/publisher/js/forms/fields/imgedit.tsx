/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from 'dompack';
import { isHTMLElement, loadImage } from '@webhare/dompack';
import { getTid } from "@mod-tollium/js/gettid";
import FileEditBase from './fileeditbase';
import './imgedit.css';
import type { UploadedFile } from '@mod-system/js/compat/upload';

// also used in testimgedit.es
export function readBackgroundUrl(imgnode: HTMLElement | null) {
  if (!imgnode)
    return "";
  const prop = getComputedStyle(imgnode).backgroundImage;
  if (prop && prop.match(/url\(.*\)/)) {
    let url = prop.substr(4, prop.length - 5);
    if (url[0] === url[url.length - 1] && (url[0] === "'" || url[0] === '"'))
      url = url.substr(1, url.length - 2);
    return url;
  }
  return "";
}

export default class ImgEditField extends FileEditBase {
  deletebutton?: HTMLElement;

  constructor(node: HTMLElement) {
    super(node);
    this.node.addEventListener('click', evt => this.selectFile(evt));
    this.node.addEventListener("keypress", evt => this.checkForUploadOrClear(evt)); // handle space+enter to active

    this.setupComponent();
    if (window.FileReader) {
      this.node.addEventListener("dragover", evt => evt.preventDefault());
      this.node.addEventListener("dragenter", evt => evt.preventDefault());
      this.node.addEventListener("drop", evt => this.doDrop(evt));
    }
    this._afterConstruction();
  }

  checkForUploadOrClear(evt: KeyboardEvent) {
    // We're only interested when the enter or space key was pressed
    if (evt.keyCode !== 13 && evt.keyCode !== 32)
      return;

    const deletebutton = isHTMLElement(evt.target) && evt.target.closest(".wh-form__imgeditdelete");
    if (deletebutton) {
      dompack.stop(evt);
      this.doDelete(evt);
      return;
    }

    dompack.stop(evt);
    this.selectFile(evt);
  }

  _updateEnabledStatus(nowenabled: boolean) {
    this.node.tabIndex = nowenabled ? 0 : -1;

    if (this.deletebutton) // it is created the first time it's needed
      this.deletebutton.tabIndex = nowenabled ? 0 : -1;

    if (nowenabled)
      this.node.removeAttribute("data-wh-form-disabled");
    else
      this.node.setAttribute("data-wh-form-disabled", "");
  }
  getFieldValueLink() {
    const imgnode = dompack.qS<HTMLImageElement>(this.node, '.wh-form__imgeditimg');
    return readBackgroundUrl(imgnode);
  }
  setupComponent() {
    if (!this.node.querySelector('.wh-form__imgeditimg')) { //we don't have an image to edit
      if (this.deletebutton && this.node.contains(this.deletebutton))
        this.deletebutton.remove();

      this.node.classList.remove('wh-form__imgedit--hasimage');

      // Set the aria-label to a combined label of the field together with the action which activating it through click/enter/space will perform
      this.node.setAttribute("aria-label", getTid("publisher:site.forms.imgedit-groupelement-upload", this.node.dataset.arialabel));

      return;
    }

    this.node.classList.add('wh-form__imgedit--hasimage');

    // Set the aria-label to a combined label of the field together with the action which activating it through click/enter/space will perform
    this.node.setAttribute("aria-label", getTid("publisher:site.forms.imgedit-groupelement-replace", this.node.dataset.arialabel));

    // if we already created the delete button, reinsert it into the DOM
    if (this.deletebutton) {
      this.node.appendChild(this.deletebutton);
      return;
    }


    this.deletebutton =
      <div class="wh-form__imgeditdelete"
        on={{ click: (evt: Event) => this.doDelete(evt) }}
        aria-label={getTid("publisher:site.forms.imgedit-remove")}
        tabindex="0"
        role="button"
      >
      </div>;

    this.node.appendChild(this.deletebutton!);
    dompack.registerMissed(this.node); //allow anyone to pick up the delete button
  }
  doDrop(evt: DragEvent) {
    evt.preventDefault();

    const lock = dompack.flagUIBusy();
    const files = evt.dataTransfer?.files;
    if (files)
      this.uploadFile(files, lock);
  }
  doDelete(evt: Event) {
    dompack.stop(evt);
    if (!this._getEnabled())
      return;

    const imgnode = this.node.querySelector('.wh-form__imgeditimg');
    let changed = false;
    if (imgnode) {
      imgnode.remove();
      changed = true;
    }
    this.setupComponent();
    if (changed)
      dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }
  async handleUploadedFile(result: UploadedFile) {
    //ADDME maxsize? files[0].size....

    /* We MUST work through the server to get proper JPEG rotation fixes. So we
       can't just take a dataurl and preview it immediately (not without parsing EXIF)
       until we'd support image-editor integration */

    if (!result.type || result.type.indexOf("image/") !== 0)
      return;//Not an image

    const imgpreload = await loadImage(result.url);
    if (!imgpreload.naturalWidth || !imgpreload.naturalHeight)
      return;

    const holder = this.node.querySelector('.wh-form__imgeditholder');
    if (!holder)
      throw new Error("Cannot process image, missing wh-form__imgeditholder holder");

    dompack.empty(holder);
    const imgnode = document.createElement("div");
    imgnode.classList.add('wh-form__imgeditimg');
    imgnode.style.backgroundImage = `url('${imgpreload.src}')`;
    holder.appendChild(imgnode);
    this.setupComponent();
    //FIXME this is just a webserver temporary session, need to get URLs with longer persistence
  }
}
