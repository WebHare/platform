/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from 'dompack';
import { FileEditElement } from './fileeditbase';
import './imgedit.css';
import { emplace } from '@webhare/std';

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

export class ImgEditElement extends FileEditElement {
  constructor() {
    super();
    // this.addEventListener("keypress", evt => this.checkForUploadOrClear(evt)); // handle space+enter to active

    this.refresh();
  }

  #constructImgHolder() {
    const imgholder = document.createElement("div");
    imgholder.classList.add('image');
    //@ts-ignore TS thinks part is readonly, but it references https://developer.mozilla.org/en-US/docs/Web/API/Element/part which even has an example changing 'part' TODO report to https://github.com/microsoft/TypeScript-DOM-lib-generator
    imgholder.part = "image";
    return imgholder;
  }

  refresh() {
    const nodes = [];
    for (const [idx, file] of this.currentFiles.entries()) {
      const imgholder = this.#constructImgHolder();
      const img = document.createElement("img");
      img.className = 'image__img';
      img.src = file.link ?? createFileURL(file.file);

      const deletebutton = <div class="image__deletebutton" />;
      this.setupDeleteButton(deletebutton, idx);

      imgholder.append(img, deletebutton);
      nodes.push(imgholder);
    }

    if (this.currentFiles.length < this.maxFiles) {
      //add an extra 'image' which is the placeholder for additional uploads
      const imgholder = this.#constructImgHolder();
      imgholder.classList.add('image--placeholder');
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
    if (!customElements.get("wh-form-imgedit"))
      customElements.define("wh-form-imgedit", ImgEditElement);
  }
}
