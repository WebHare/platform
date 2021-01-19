/* import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
*/
import * as dompack from 'dompack';
import * as preload from 'dompack/extra/preload';
import { getTid } from "@mod-tollium/js/gettid";
import FileEditBase from './fileeditbase';
import './imgedit.css';

// also used in testimgedit.es
export function readBackgroundUrl(imgnode)
{
  if (!imgnode)
    return "";
  let prop = getComputedStyle(imgnode).backgroundImage;
  if (prop && prop.match(/url\(.*\)/))
  {
    let url = prop.substr(4, prop.length - 5);
    if (url[0] == url[url.length - 1] && (url[0] == "'" || url[0] == '"'))
      url = url.substr(1, url.length - 2);
    return url;
  }
  return "";
}

export default class ImgEditField extends FileEditBase
{
  constructor(node, options)
  {
    super(node, options);
    this.node.addEventListener('click', evt => this.selectFile(evt));
    this.node.addEventListener("keypress", evt => this.checkForUploadOrClear(evt)); // handle space+enter to active

    this.setupComponent();
    if (window.FileReader)
    {
      this.node.addEventListener("dragover", evt => evt.preventDefault());
      this.node.addEventListener("dragenter", evt => evt.preventDefault());
      this.node.addEventListener("drop", evt => this.doDrop(evt));
    }
    this._afterConstruction();
  }

  checkForUploadOrClear(evt)
  {
    // We're only interested when the enter or space key was pressed
    if (evt.keyCode != 13 && evt.keyCode != 32)
      return;

    let deletebutton = evt.target.closest(".wh-form__imgeditdelete");
    if (deletebutton)
    {
      dompack.stop(evt);
      this.doDelete(evt);
      return;
    }

    evt.preventDefault();
    this.selectFile(evt);
  }

  _updateEnabledStatus(nowenabled)
  {
    this.node.tabIndex = nowenabled ? 0 : -1;

    if (this.deletebutton) // it is created the first time it's needed
      this.deletebutton.tabIndex = nowenabled ? 0 : -1;

    if(nowenabled)
      this.node.removeAttribute("data-wh-form-disabled");
    else
      this.node.setAttribute("data-wh-form-disabled","");
  }
  getFieldValueLink()
  {
    let imgnode = this.node.querySelector('.wh-form__imgeditimg');
    return readBackgroundUrl(imgnode);
  }
  setupComponent()
  {
    if(!this.node.querySelector('.wh-form__imgeditimg')) //we don't have an image to edit
    {
      if(this.deletebutton && this.node.contains(this.deletebutton))
        dompack.remove(this.deletebutton);

      this.node.classList.remove('wh-form__imgedit--hasimage');

      // Set the aria-label to a combined label of the field together with the action which activating it through click/enter/space will perform
      this.node.setAttribute("aria-label", getTid("publisher:site.forms.imgedit-groupelement-upload", this.node.dataset.arialabel));

      return;
    }

    this.node.classList.add('wh-form__imgedit--hasimage');

    // Set the aria-label to a combined label of the field together with the action which activating it through click/enter/space will perform
    this.node.setAttribute("aria-label", getTid("publisher:site.forms.imgedit-groupelement-replace", this.node.dataset.arialabel));

    // if we already created the delete button, reinsert it into the DOM
    if(this.deletebutton)
    {
      this.node.appendChild(this.deletebutton);
      return;
    }


    this.deletebutton =
            <div class="wh-form__imgeditdelete"
                 on={{ click:  evt => this.doDelete(evt) }}
                 aria-label={getTid("publisher:site.forms.imgedit-remove")}
                 tabindex="0"
                 role="button"
                 >
            </div>

    this.node.appendChild(this.deletebutton);
    dompack.registerMissed(this.node); //allow anyone to pick up the delete button
  }
  doDrop(evt)
  {
    evt.preventDefault();

    let lock = dompack.flagUIBusy();
    let files = evt.dataTransfer.files;
    this.uploadFile(files, lock);
  }
  doDelete(evt)
  {
    dompack.stop(evt);
    if(!this._getEnabled())
      return;

    let imgnode = this.node.querySelector('.wh-form__imgeditimg');
    let changed = false;
    if(imgnode)
    {
      dompack.remove(imgnode);
      changed = true;
    }
    this.setupComponent();
    if (changed)
      dompack.dispatchCustomEvent(this.node, 'change', { bubbles: true, cancelable: false });
  }
  async handleUploadedFile(result)
  {
    //ADDME maxsize? files[0].size....

    /* We MUST work through the server to get proper JPEG rotation fixes. So we
       can't just take a dataurl and preview it immediately (not without parsing EXIF)
       until we'd support image-editor integration */

    if( !result.type || result.type.indexOf("image/") != 0 )
      return;//Not an image

    let imgpreload = await preload.promiseImage(result.url);
    if(!imgpreload.width || !imgpreload.height)
      return;

    this.uploadurl = result.url;

    let holder = this.node.querySelector('.wh-form__imgeditholder');
    if(!holder)
      throw new Error("Cannot process image, missing wh-form__imgeditholder holder");

    dompack.empty(holder);
    let imgnode = document.createElement("div");
    imgnode.classList.add('wh-form__imgeditimg');
    imgnode.style.backgroundImage = `url('${imgpreload.node.src}')`;
    holder.appendChild(imgnode);
    this.setupComponent();
    //FIXME this is just a webserver temporary session, need to get URLs with longer persistence
  }
}
