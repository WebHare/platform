/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from 'dompack';
import { isHTMLElement, loadImage } from '@webhare/dompack';
import { getTid } from "@mod-tollium/js/gettid";
import FileEditBase from './fileeditbase';
import './imgedit.css';
import { wrapSerialized } from '@webhare/std';

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
  /** Hold the last created image URL so we can revoke it */
  private currentImgUrl = '';
  deletebutton?: HTMLElement;

  constructor(node: HTMLElement) {
    super(node);
    this.node.addEventListener('click', evt => this.selectFile(evt));
    this.node.addEventListener("keypress", evt => this.checkForUploadOrClear(evt)); // handle space+enter to active

    this.setupComponent();
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
  doDelete(evt: Event) {
    dompack.stop(evt);
    if (!this._getEnabled())
      return;

    this.setValue(null);
    dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }

  private updateImgUrl(newurl: string) {
    if (this.currentImgUrl === newurl)
      return;
    if (this.currentImgUrl)
      URL.revokeObjectURL(this.currentImgUrl);
    this.currentImgUrl = newurl;
  }

  protected uploadHasChanged = wrapSerialized(async () => {
    const imgnode = this.node.querySelector('.wh-form__imgeditimg');

    if (!this.uploadedFile || !this.uploadedFile.type.startsWith("image/")) {
      //looks like we're deleted
      imgnode?.remove();
      this.updateImgUrl("");
      this.setupComponent();
    } else { //a new image to show
      const url = URL.createObjectURL(this.uploadedFile);
      const imgpreload = await loadImage(url);
      if (!imgpreload.naturalWidth || !imgpreload.naturalHeight) {
        URL.revokeObjectURL(url);
        return;
      }

      const holder = this.node.querySelector('.wh-form__imgeditholder');
      if (!holder)
        throw new Error("Cannot process image, missing wh-form__imgeditholder holder");

      //FIXME why aren't we just putting the <img> we created above into the DOM? but might not be an easy change anymore now..
      const imgholder = document.createElement("div");
      imgholder.classList.add('wh-form__imgeditimg');
      imgholder.style.backgroundImage = `url('${imgpreload.src}')`;
      holder.replaceChildren(imgholder);
      this.setupComponent();
      this.updateImgUrl(url);
    }

    dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }, { coalesce: true });
}
