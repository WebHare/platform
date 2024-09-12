import * as dompack from 'dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "../internal/form.lang.json";
import { FileEditElement as FileEditElementBase } from './fileeditbase';
import './upload.css';
import { isFile } from '@webhare/std';



//FIXME nicer class name? eg add form or field to these (and imgedit) class names?
export class FileUploadFormElement extends FileEditElementBase {
  constructor() {
    super();
    this.refresh();
  }

  #constructFileHolder() {
    const fileholder = document.createElement("div");
    fileholder.classList.add('file');
    return fileholder;
  }

  refresh() {
    const nodes = [];

    for (const [idx, file] of this.currentFiles.entries()) {
      const fileholder = this.#constructFileHolder();

      // const label = getLabelText(this.node);
      // aria-label={label}
      const filename = isFile(file) ? file.name : file.fileName;
      /* for ease of 'form like' presentation, we're currently using an <input>. but quite hacky, eg. we need readonly to have it not interfere with clicks. */
      const filenamefield =
        <input part="filename" class="file__name" type="text" value={filename} readonly />;

      const deletebutton = <button part="button deletebutton" class="deletebutton file__deletebutton" />;
      this.setupDeleteButton(deletebutton, idx);

      fileholder.append(filenamefield, deletebutton);
      nodes.push(fileholder);
    }

    if (this.currentFiles.length < this.maxFiles) {
      const fileholder = this.#constructFileHolder();
      fileholder.classList.add('file--placeholder');

      const filenamefield =
        <input part="filename" class="file__name" type="text" value="" placeholder={getTid("publisher:site.forms.upload-emptytext")} disabled readonly />;

      const uploadbutton = <button part="button selectbutton" type="button" class="wh-form__uploadfieldselect wh-form__button"><span class="wh-form__buttonlabel">{getTid("publisher:site.forms.selectfile")}</span></button>;
      this.setupUploadButton(fileholder);
      fileholder.append(filenamefield, uploadbutton);
      nodes.push(fileholder);
    }

    this.maindiv.replaceChildren(...nodes);
  }
}

//////// Legacy version. We expect existing users to migrate to the version above

export default class UploadField {
  constructor(node: HTMLElement) {
    if (!customElements.get("wh-form-upload"))
      customElements.define("wh-form-upload", FileUploadFormElement);
  }
}
