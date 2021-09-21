import * as dompack from '../../src/index.es';
import * as dialogapi from '../../api/dialog.es';

export class BasicDialog extends dialogapi.DialogBase
{
  constructor(classname, options)
  {
    super(options);
    this._dialogclass = classname;

    this.contentnode = dompack.create('div', { className: this._dialogclass
                                             });
    this.holdernode = dompack.create('div',
                        { className: this._dialogclass + "__holder"
                        , childNodes: [ this.contentnode ]
                        });
    this.modalitynode = dompack.create('div',
                          { className: this._dialogclass + "__modalbg"
                          , childNodes: [ this.holdernode ]
                          , on: { click: evt => this._onModalityClick(evt) }
                          });

    if(options?.theme)
      this.modalitynode.classList.add(options.theme);
  }

  _openDialog()
  {
    document.body.appendChild(this.modalitynode);
  }

  closeDialog()
  {
    dompack.remove(this.modalitynode);
    super.closeDialog();
  }

  _onModalityClick(evt)
  {
    if(this.holdernode.contains(evt.target))
      return; //event was targetted at our holder

    dompack.stop(evt);
    if(this.options.allowcancel)
      this.resolve(null);
  }

  _onKeyDown(evt)
  {
    if(evt.keyCode == 27 && this.options.allowcancel) //allow escape to cancel the dialog
    {
      dompack.stop(evt);
      this.resolve(null);
    }

    if(this.holdernode.contains(evt.target))
      return; //key events targetted to our dialog are okay

    //FIXME this causes open dialogs to even block reloads etc...
    evt.preventDefault();
    evt.stopPropagation();
  }

  afterShow()
  {
    dompack.registerMissed(this.holdernode);
  }
}

export function createDialog(classname, options)
{
  return new BasicDialog(classname, options);
}
