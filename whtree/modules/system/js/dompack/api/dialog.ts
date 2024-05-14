/* Dialogapi offers an API to which dialog providers cannot connect. It does
   not implement the dialogs themselves
*/

import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
import KeyboardHandler from "dompack/extra/keyboard";

export type DialogOptions =
  {
    /**  Allow the dialog to be cancelled by clicking outside the dialog. Defaults to true if no choices are specified */
    allowcancel?: boolean;
    /**  Element to focus on closing the dialog */
    focusonclose?: HTMLElement;
    /**  An AbortSignal which if set will close the dialog and resolve it with a null response */
    signal?: EventTarget;
    /**  Additional class to set on the dialog */
    messageboxclassbase?: string;

    borrow?: Element | string;
  };
type DialogConstructor = (options?: DialogOptions) => DialogBase;

const dialogstack: DialogBase[] = [];
let keyhandler: KeyboardHandler | null = null;
let dialogconstructor: DialogConstructor | null = null;
let dialogoptions: DialogOptions | null = null;

function onEscape(event: KeyboardEvent) {
  if (!dialogstack.length)
    return;

  dompack.stop(event);
  if (dialogstack[dialogstack.length - 1].options.allowcancel)
    dialogstack[dialogstack.length - 1].resolve(null);
}

function onTab(event: KeyboardEvent, direction: number) {
  if (!dialogstack.length)
    return;

  dompack.stop(event);

  const focusable = domfocus.getFocusableComponents(dialogstack[dialogstack.length - 1].contentnode, true);
  const el = domfocus.getCurrentlyFocusedElement();
  const tofocusidx = el ? focusable.indexOf(el) + direction : -1;
  const tofocus = tofocusidx < 0 ? focusable[focusable.length - 1] : tofocusidx >= focusable.length ? focusable[0] : focusable[tofocusidx];
  if (tofocus)
    dompack.focus(tofocus);
}

export class DialogBase {
  options: DialogOptions;
  private _borrowedfrom: Element | null = null;
  private _borrowednext: Element | null = null;
  contentnode: Element | null; //FIXME a successor to DialogBase should not allow these to be | null. have our child inform us through super() about the contentnode and buttonsnode so we can ensure it's set
  buttonsnode: Element | null = null;
  private _deferred: PromiseWithResolvers<string | null>;
  open: boolean;
  private _previousfocus: Element | null = null;

  constructor(options?: DialogOptions) {
    this.options = {
      allowcancel: true,
      ...options
    };

    if (this.options.borrow && typeof this.options.borrow === 'string') {
      const borrow = document.querySelector(this.options.borrow);
      if (!borrow)
        throw new Error("Invalid 'borrow' selectior: " + this.options.borrow);
      this.options.borrow = borrow;
    }
    // At this point, if this.options.borrow was a string, it's been resolved to an Element

    if (this.options.borrow) {
      this._borrowedfrom = (this.options.borrow as Element).parentElement;
      this._borrowednext = (this.options.borrow as Element).nextElementSibling;
    }

    if (this.options.signal)
      this.options.signal.addEventListener("abort", () => { this.resolve(null); });

    this.contentnode = null;
    this._deferred = Promise.withResolvers();
    this.open = false;
  }

  async runModal() {
    if (this.open)
      throw new Error("Attempting to re-open already opened dialog");

    if (!keyhandler)
      keyhandler = new KeyboardHandler(window, {
        "Escape": (evt: KeyboardEvent) => onEscape(evt),
        "Tab": (evt: KeyboardEvent) => onTab(evt, +1),
        "Shift+Tab": (evt: KeyboardEvent) => onTab(evt, -1)
      }, { captureunsafekeys: true, listenoptions: { capture: true } });

    this._previousfocus = domfocus.getCurrentlyFocusedElement();
    this._openDialog();

    this.open = true;
    dialogstack.push(this);

    try {
      this.afterShow();
      this._checkFocus();
      return await this._deferred.promise;
    } finally {
      if (this.open)
        this.closeDialog();
    }
  }

  _openDialog() {
    throw new Error("_openDialog not overridden by dialog class");
  }

  _checkFocus() {
    const focusable = domfocus.getFocusableComponents(this.contentnode, true);
    if (focusable.length !== 0)
      dompack.focus(focusable[0]);
    else
      dompack.focus(document.body);
  }

  //close the dialog. this may be invoked even when inside runModal to ensure synchronous dialog cleanup
  closeDialog() {
    if (!this.open)
      return;

    const myoffset = dialogstack.indexOf(this);
    if (myoffset >= 0)
      dialogstack.splice(myoffset, 1);

    this.open = false;
    if (this.options.borrow)
      if (this._borrowedfrom)
        this._borrowedfrom.insertBefore(this.options.borrow as Element, this._borrowednext);
      else
        this._borrowednext?.remove();

    if (this.options.focusonclose)
      dompack.focus(this.options.focusonclose);
    else if (this._previousfocus)
      dompack.focus(this._previousfocus as HTMLElement);

    if (dialogstack.length === 0 && keyhandler) {
      keyhandler.destroy();
      keyhandler = null;
    }
  }

  /**
   * resolve the dialog with the specified answer
   *
   * @param response - Response (or choice) to return. null if the dialog was simply cancelled
   */
  resolve(response: string | null) {
    if (this.open)
      this.closeDialog();
    this._deferred.resolve(response);
  }

  afterShow() {
    // supposed to be empty but extenders can override
  }
}

export function setupDialogs(newdialogconstructor: DialogConstructor, options?: DialogOptions) {
  if (dialogconstructor) {
    console.error("Duplicate setupDialogs call!");
    return;
  }

  dialogconstructor = newdialogconstructor;
  dialogoptions = { messageboxclassbase: 'dompack-messagebox__', ...options };
}

/** Verify whether the dialog api is initialized */
export function isCreateDialogAvailable(): boolean {
  return Boolean(dialogconstructor);
}

/**
 * Create a dialog
 *
 * @param options - dialog settings
 */
export function createDialog(options?: DialogOptions) {
  if (!dialogconstructor)
    throw new Error("Cannot create dialog, no dialog class defined");

  const dialog = dialogconstructor(options);
  if (dialog.options.borrow)
    dialog.contentnode?.appendChild(dialog.options.borrow as Element);
  return dialog;
}

type DialogChoice =
  {
    /** Title for the choice */
    title: string;
    /** Override result to return if clicked (otherwise you'll just receive the title) */
    result?: string;
    className?: string;
  };


/**
                     @param question - if a string, will be wrapped as textContent into a <p> and presented as the question
                    - if a html node, will appear as the question (allowing you to insert html)
                    - if an array of nodes, all these nodes will be inserted
    @param choices - Buttons (choices) the message box will offer, eg Ok and Cancel
    @param options - Dialog options
 */
export async function runMessageBox(question: string | HTMLElement | HTMLElement[], choices: DialogChoice[], options?: DialogOptions) {
  choices = choices || [];
  options = { allowcancel: choices.length === 0, ...options };

  const dialog = createDialog(options);
  const choicebuttons = choices.map(choice =>
    dompack.create("button", {
      type: "button",
      className: dialogoptions ? dialogoptions.messageboxclassbase + "button " + (choice.className || "") : "",
      textContent: choice.title,
      on: { click: () => dialog.resolve(choice.result || choice.title) },
      dataset: { messageboxResult: choice.result || choice.title }
    }));

  if (typeof question === 'string')
    question = dompack.create("p", { textContent: question });

  if (Array.isArray(question))
    dialog.contentnode?.append(...question);
  else
    dialog.contentnode?.append(question);

  if (dialog.buttonsnode) //this dialog has a separte node for the button area
    dialog.buttonsnode.append(...choicebuttons);
  else
    dialog.contentnode?.append(dompack.create("div", {
      className: dialogoptions ? dialogoptions.messageboxclassbase + "buttongroup" : "",
      childNodes: choicebuttons
    }));

  return dialog.runModal();
}
