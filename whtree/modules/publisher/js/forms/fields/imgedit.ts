/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from '@webhare/dompack';
import { FileEditElement } from './fileeditbase';
import { emplace } from '@webhare/std';
import { getTid } from '@webhare/gettid';
import { getFileAsDataURL } from '@webhare/upload';
import { setFieldError } from '@mod-publisher/js/forms';

let revoker: FinalizationRegistry<string> | undefined;
const cachedURLs = new WeakMap<File, string>();

function createFileURL(file: File): string {
  return emplace(cachedURLs, file, {
    insert: () => {
      const newurl = URL.createObjectURL(file);
      //setup a finalizer to revoke object urls
      revoker ||= new FinalizationRegistry<string>((oldurl) => URL.revokeObjectURL(oldurl));
      //as soon as file is lost to us
      revoker.register(file, newurl);
      return newurl;
    }
  });
}

async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const img = await dompack.loadImage(await getFileAsDataURL(file));
  return { width: img.naturalWidth, height: img.naturalHeight };
}

interface ImgEditTexts {
  explainUpload?: string;
}

export class ImgEditElement extends FileEditElement {
  static observedAttributes = ["min-width", "max-width", "min-height", "max-height"];

  private static texts: ImgEditTexts | null = null;

  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;

  constructor() {
    super();
    // this.addEventListener("keypress", evt => this.checkForUploadOrClear(evt)); // handle space+enter to active

    this.maindiv.classList.add("images");

    this.minWidth = parseInt(this.getAttribute("min-width") || "0") || 0;
    this.maxWidth = parseInt(this.getAttribute("max-width") || "0") || 0;
    this.minHeight = parseInt(this.getAttribute("min-height") || "0") || 0;
    this.maxHeight = parseInt(this.getAttribute("max-height") || "0") || 0;

    this.refresh();
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    const value = parseInt(newValue);
    if (isNaN(value))
      return;
    switch (name) {
      case "min-width": {
        this.minWidth = value;
        break;
      }
      case "max-width": {
        this.maxWidth = value;
        break;
      }
      case "min-height": {
        this.minHeight = value;
        break;
      }
      case "max-height": {
        this.maxHeight = value;
        break;
      }
    }
  }

  static setTexts(textupdate: ImgEditTexts) {
    if (!ImgEditElement.texts)
      ImgEditElement.texts = {};

    Object.assign(ImgEditElement.texts, textupdate);
    dompack.qSA<ImgEditElement>("wh-imgedit").forEach(node => node.refresh()); //update any existing nodes
  }

  async _check() {
    const error = await super._check();
    if (!error && this.isSet() && (this.minWidth || this.maxWidth || this.minHeight || this.maxHeight)) {
      for (const file of this.currentFiles) {
        if (file.file) {
          const size = await getImageDimensions(file.file);
          if (this.minWidth && size.width < this.minWidth)
            setFieldError(this, getTid("publisher:site.forms.commonerrors.minwidth", size.width, this.minWidth), { reportimmediately: false });
          else if (this.maxWidth && size.width > this.maxWidth)
            setFieldError(this, getTid("publisher:site.forms.commonerrors.maxwidth", size.width, this.maxWidth), { reportimmediately: false });
          else if (this.minHeight && size.height < this.minHeight)
            setFieldError(this, getTid("publisher:site.forms.commonerrors.minheight", size.height, this.minHeight), { reportimmediately: false });
          else if (this.maxHeight && size.height > this.maxHeight)
            setFieldError(this, getTid("publisher:site.forms.commonerrors.maxheight", size.height, this.maxHeight), { reportimmediately: false });
        }
      }
    }
    return error;
  }

  refresh() {
    const nodes = [];
    for (const [idx, file] of this.currentFiles.entries()) {
      const imgholder = dompack.create("div", { class: "image", part: "image" });
      const img = dompack.create("img", { class: 'image__img', src: file.link ?? createFileURL(file.file) });

      const deletebutton = dompack.create("button", { part: "button deletebutton", class: "deletebutton image__deletebutton" });
      this.setupDeleteButton(deletebutton, idx);

      imgholder.append(img, deletebutton);
      nodes.push(imgholder);
    }

    if (this.currentFiles.length < this.maxFiles) {
      //add an extra 'image' which is the placeholder for additional uploads
      const imgholder = dompack.create("div", { class: "image image--placeholder", part: "image placeholder" });
      const contentwrapper = dompack.create("div", { class: "image__content" });
      const uploadicon = dompack.create("div", { class: "image__uploadicon", part: "uploadicon" });
      const explain = dompack.create("div", {
        class: "image__explain",
        textContent: ImgEditElement.texts?.explainUpload || getTid("publisher:site.forms.imgedit-explain-upload")
      });
      imgholder.append(contentwrapper);
      contentwrapper.append(uploadicon, explain);
      imgholder.tabIndex = 0;
      this.setupUploadButton(imgholder);
      nodes.push(imgholder);
    }

    /* FIXME aria label, currently set at group level, should be per image?

          // Set the aria-label to a combined label of the field together with the action which activating it through click/enter/space will perform
          this.node.setAttribute("aria-label", getTid("publisher:site.forms.imgedit-groupelement-upload", this.node.dataset.arialabel));

                    // Set the aria-label to a combined label of the field together with the action which activating it through click/enter/space will perform
          this.node.setAttribute("aria-label", getTid("publisher:site.forms.imgedit-groupelement-replace", this.node.dataset.arialabel));
*/

    this.maindiv.replaceChildren(...nodes);
  }
}

//////// Legacy version. We expect existing users to migrate to the version above

export default class ImgEditField {
  constructor(node: HTMLElement) {
    if (!customElements.get("wh-imgedit"))
      customElements.define("wh-imgedit", ImgEditElement);
  }
}
