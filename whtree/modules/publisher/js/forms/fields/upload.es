/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from 'dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "../internal/form.lang.json";
import FileEditBase from './fileeditbase';
import './upload.css';


function getLabelText(node)
{
  let label;
  if (node.id != "")
  {
    let labelnode = document.querySelector(`label[for="${node.id}"]`);
    if (labelnode)
      label = labelnode.innerText;

    return label;
  }

  return "";
}


export default class UploadField extends FileEditBase
{
  constructor(node, options)
  {
    super(node, options);
    if(!this.node)
      return; //init cancelled

    let label = getLabelText(this.node);

    this.node.addEventListener("click", e => this.selectFile(e)); //we still need to intercept clicks, even if we're hiding it
    this.node.addEventListener('dompack:takefocus', evt => this._takeFocus(evt));
    this.replacement = <div class="wh-form__uploadfield" on={{click: e => this.selectFile(e) }}>
                         { this._filenameinput =
                           <span class="wh-form__uploadfieldinputholder">
                             { this._filenamefield =
                                      <input class="wh-form__uploadfieldfilename" type="text"
                                             placeholder={getTid("publisher:site.forms.upload-emptytext")}
                                             aria-label={label}
                                             readonly="true"
                                             />
                             }
                             { this._deletebutton =
                                      <span class="wh-form__uploadfielddelete"
                                            aria-label={getTid("publisher:site.forms.upload-remove")}
                                            tabindex="0"
                                            on={{ click: evt => this._doDelete(evt), keypress: evt => this._checkForDelete(evt) }}
                                            />
                             }
                           </span>
                         }
                         { this._uploadbutton = <button type="button" class="wh-form__uploadfieldselect wh-form__button"><span class="wh-form__buttonlabel">{getTid("publisher:site.forms.selectfile")}</span></button> }
                       </div>;

    dompack.before(this.node, this.replacement);

    this.refresh();
    this._afterConstruction();
  }
  _updateEnabledStatus(nowenabled)
  {
    this.node.disabled = false; //we'll now manually handle disabled status
    this._uploadbutton.disabled = !nowenabled;
  }
  _takeFocus(evt)
  {
    evt.preventDefault();
    dompack.focus(this.replacement.querySelector("button"));
  }

  // check whether the delete button was activated through a keypress
  _checkForDelete(evt)
  {
    // We only interested when the enter or space key was pressed
    if (evt.keyCode != 13 && evt.keyCode != 32)
      return;

    this._doDelete(evt);
  }

  _doDelete(evt)
  {
    dompack.stop(evt);
    if(!this._getEnabled())
      return;

    this.node.dataset.whFilename='';
    this.node.dataset.whFileurl='';
    this.refresh();
    dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }
  refresh()
  {
    let filename = this.node.dataset.whFilename || '';
    let hasfile = !!this.node.dataset.whFileurl;

    this._filenamefield.value = filename;
    dompack.toggleClass(this.replacement, "wh-form__uploadfield--hasfile", hasfile);
  }
  getFieldValueLink()
  {
    return this.node.dataset.whFileurl;
  }
  async handleUploadedFile(result)
  {
    this.node.dataset.whFileurl = result.url;
    //this.filesize = result.size; - size is there if we need it, but not using it yet
    this.refresh();
  }
}
