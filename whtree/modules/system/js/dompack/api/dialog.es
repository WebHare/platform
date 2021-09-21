/* @import * as dialogapi from 'dompack/api/dialog'

   Dialogapi offers an API to which dialog providers cannot connect. It does
   not implement the dialogs themselves
*/

import * as dompack from 'dompack';

let dialogstack;
let havekeyhandler;
let dialogconstructor = null;
let dialogoptions = null;

function dialogKeyDownHandler(event)
{
  if(!dialogstack.length)
    return;

  let currentdialog = dialogstack[dialogstack.length-1];
  if(event.keyCode == 27) //TODO this will break at some point once dialogs contain controls that need Esc to work
  {
    dompack.stop(event);
    if(currentdialog.options.allowcancel)
      currentdialog.resolve(null);
    return;
  }

  if(currentdialog.holdernode.contains(event.target))
    return; //key events targetted to our dialog are okay

  dompack.stop(event);
}

export class DialogBase
{
  constructor(options)
  {
    this.options = { allowcancel: true
                   , borrow: null
                   , ...options
                   };

    if(this.options.borrow && typeof this.options.borrow == 'string')
    {
      let borrow = document.querySelector(this.options.borrow);
      if(!borrow)
        throw new Error("Invalid 'borrow' selectior: " + this.options.borrow);
      this.options.borrow = borrow;
    }

    if(this.options.borrow)
    {
      this._borrowedfrom = this.options.borrow.parentNode;
      this._borrowednext = this.options.borrow.nextSibling;
    }
    this.contentnode = null;
    this._deferred = dompack.createDeferred();
    this.open = false;
  }

  async runModal()
  {
    if(!dialogstack)
      dialogstack = [];

    if(!havekeyhandler)
    {
      havekeyhandler = true;
      document.addEventListener("keydown", dialogKeyDownHandler, true);
    }

    this._openDialog();

    this.open = true;
    dialogstack.push(this);

    try
    {
      this.afterShow();
      return await this._deferred.promise;
    }
    finally
    {
      if(this.open)
        this.closeDialog();
    }
  }

  _openDialog()
  {
    throw new Error("_openDialog not overridden by dialog class");
  }

  //close the dialog. this may be invoked even when inside runModal to ensure synchronous dialog cleanup
  closeDialog()
  {
    if(!this.open)
      return;

    let myoffset = dialogstack.indexOf(this);
    if(myoffset >= 0)
      dialogstack.splice(myoffset,1);

    this.open = false;
    if(this.options.borrow)
      if(this._borrowedfrom)
        this._borrowedfrom.insertBefore(this.options.borrow, this._borrowednext);
      else
        dompack.remove(this._borrowednext);

    if(this.options.focusonclose)
      dompack.focus(this.options.focusonclose);
  }

  //resolve the dialog with the specified answer
  resolve(response)
  {
    if(this.open)
      this.closeDialog();
    this._deferred.resolve(response);
  }

  afterShow()
  {
  }
}

export function setupDialogs(newdialogconstructor, options)
{
  if(dialogconstructor)
  {
    console.error("Duplicate setupDialogs call!");
    return;
  }

  dialogconstructor = newdialogconstructor;
  dialogoptions = { messageboxclassbase: 'dompack-messagebox__', ...options };
}

/** Create a dialog */
export function createDialog(options)
{
  if(!dialogconstructor)
    throw new Error("Cannot create dialog, no dialog class defined");

  let dialog = dialogconstructor(options);
  if(dialog.options.borrow)
    dialog.contentnode.appendChild(dialog.options.borrow);
  return dialog;
}

/** @param question - if a string, will be wrapped as textContent into a <p> and presented as the question
                    - if a html node, will appear as the question (allowing you to insert html)
                    - if an array of nodes, all these nodes will be inserted
    @param choices
    @cell choices.title Title for the choice
    @cell choices.result Override result to return if clicked (otherwise you'll just receive the title)
    @cell(boolean) options.allowcancel Allow the dialog to be cancelled by clicking outside the dialog. Defaults to true if no choices are specified
    @cell(object) options.focusonclose Element to focus on closing the dialog
    @cell(string) options.theme Additional class to set on the dialog
*/
export async function runMessageBox(question, choices, options)
{
  choices = choices || [];
  options = { allowcancel: choices.length == 0, ...options};

  let dialog = createDialog(options);
  let choicebuttons = choices.map(choice =>
        dompack.create("button", { type: "button"
                                 , className: dialogoptions.messageboxclassbase + "button " + (choice.className||'')
                                 , textContent: choice.title
                                 , on: { click: evt=> dialog.resolve(choice.result || choice.title) }
                                 , dataset: { messageboxResult: choice.result || choice.title }
                                 }));

  if(typeof question == 'string')
    question = dompack.create("p", { textContent: question });

  if(Array.isArray(question))
    dialog.contentnode.append(...question);
  else
    dialog.contentnode.append(question);

  if(dialog.buttonsnode) //this dialog has a separte node for the button area
    dialog.buttonsnode.append(...choicebuttons);
  else
    dialog.contentnode.append(dompack.create("div", { className: dialogoptions.messageboxclassbase + "buttongroup"
                                                    , childNodes: choicebuttons
                                                    }));

  return dialog.runModal();
}
