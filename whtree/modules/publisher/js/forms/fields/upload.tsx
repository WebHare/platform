/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from 'dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "../internal/form.lang.json";
import { FileEditElement as FileEditElementBase } from './fileeditbase';
import './upload.css';


function getLabelText(node: HTMLElement) {
  let label;
  if (node.id !== "") {
    const labelnode = document.querySelector(`label[for="${node.id}"]`);
    if (labelnode)
      label = labelnode.textContent;

    return label;
  }

  return "";
}

//FIXME nicer class name? eg add form or field to these (and imgedit) class names?
export class FileUploadFormElement extends FileEditElementBase {
  replacement;
  private _filenameinput;
  private _filenamefield;
  private _deletebutton;
  private _uploadbutton;
  declare node: FileUploadFormElement;

  constructor() {
    super();

    const label = getLabelText(this.node);

    this.node.addEventListener("click", e => this.selectFile(e)); //we still need to intercept clicks, even if we're hiding it
    this.node.addEventListener('dompack:takefocus', evt => this._takeFocus(evt));
    this.replacement = <div class="wh-form__uploadfield" on={{ click: (e: MouseEvent) => this.selectFile(e) }}>
      {this._filenameinput =
        <span class="wh-form__uploadfieldinputholder">
          {this._filenamefield =
            <input class="wh-form__uploadfieldfilename" type="text"
              placeholder={getTid("publisher:site.forms.upload-emptytext")}
              aria-label={label}
              disabled
            />
          }
          {this._deletebutton =
            <span class="wh-form__uploadfielddelete"
              aria-label={getTid("publisher:site.forms.upload-remove")}
              tabindex="0"
              role="button"
              on={{ click: (evt: Event) => this._doDelete(evt), keypress: (evt: KeyboardEvent) => this._checkForDelete(evt) }}
            />
          }
        </span>
      }
      {this._uploadbutton = <button type="button" class="wh-form__uploadfieldselect wh-form__button"><span class="wh-form__buttonlabel">{getTid("publisher:site.forms.selectfile")}</span></button>}
    </div>;

    dompack.before(this.node, this.replacement);

    this.refresh();
    this._afterConstruction();
  }
  _updateEnabledStatus(nowenabled: boolean) {
    this._uploadbutton.disabled = !nowenabled;
  }
  _takeFocus(evt: Event) {
    evt.preventDefault();
    dompack.focus(this.replacement.querySelector("button"));
  }

  // check whether the delete button was activated through a keypress
  _checkForDelete(evt: KeyboardEvent) {
    // We only interested when the enter or space key was pressed
    if (evt.keyCode !== 13 && evt.keyCode !== 32)
      return;

    this._doDelete(evt);
  }

  _doDelete(evt: Event) {
    dompack.stop(evt);
    if (!this._getEnabled())
      return;

    this.node.dataset.whFilename = '';
    this.node.dataset.whFileurl = '';
    this.refresh();
    dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }
  uploadHasChanged() {
    this.refresh();
    dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }
  isSet() {
    return Boolean(this.hasChanged ? this.uploadedFile : this.node.dataset.whFilename);
  }
  refresh() {
    this._filenamefield.value = (this.hasChanged ? this.uploadedFile?.name : this.node.dataset.whFilename) || '';
    this.replacement.classList.toggle("wh-form__uploadfield--hasfile", this.isSet());
  }
  getFieldValueLink() {
    return this.node.dataset.whFileurl || null;
  }
}

//////// Legacy version. We expect existing users to migrate to the version above

export default class UploadField {
  constructor(node: HTMLElement) {
    if (!customElements.get("wh-form-upload"))
      customElements.define("wh-form-upload", FileUploadFormElement);
  }
}
