import * as dompack from '../../index';
import * as dialogapi from '../../api/dialog';

interface DialogOptions extends dialogapi.DialogOptions {
  theme?: string;
}

export class BasicDialog extends dialogapi.DialogBase {
  private _dialogclass: string;
  holdernode: Element;
  modalitynode: Element;

  constructor(classname: string, options?: DialogOptions) {
    super(options);
    this._dialogclass = classname;

    this.contentnode = dompack.create('div', { className: this._dialogclass });
    this.holdernode = dompack.create('div',
      {
        className: this._dialogclass + "__holder",
        childNodes: [this.contentnode]
      });
    this.modalitynode = dompack.create('div',
      {
        className: this._dialogclass + "__modalbg",
        childNodes: [this.holdernode],
        on: {
          click: (evt: MouseEvent) => this._onModalityClick(evt),
          wheel: (evt: WheelEvent) => dompack.stop(evt) //prevent scrolling modal-covered site using mousewheel
        }
      });

    if (options?.theme)
      this.modalitynode.classList.add(options.theme);
  }

  _openDialog() {
    document.body.appendChild(this.modalitynode);
  }

  closeDialog() {
    this.modalitynode.remove();
    super.closeDialog();
  }

  _onModalityClick(evt: MouseEvent) {
    if (this.holdernode.contains(evt.target as Node))
      return; //event was targetted at our holder

    dompack.stop(evt);
    if (this.options.allowcancel)
      this.resolve(null);
  }

  afterShow() {
    dompack.registerMissed(this.holdernode);
  }
}

export function createDialog(classname: string, options?: DialogOptions) {
  return new BasicDialog(classname, options);
}
