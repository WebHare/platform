WARNING: this documentation was written when dompack was a separate module and may be out of date

# dompack dialog API and base dialog

## Integration

Using the builtin (black on white) dialog:

JavaScript:
```javascript
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));
```

SCSS:
```scss
@import "~dompack/components/dialog/mixins";

.mydialog
{
  @include dompack-dialog;
  background: white;
  padding: 20px;
}
```

You can also extend this dialog class: the code below creates an 'UTDialog'
with a custom afterShow() handler.

```javascript
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/extra/dialogapi';

export class UTDialog extends dialog.BasicDialog
{
  constructor(options)
  {
    super('utdialog',options);
  }


  afterShow()
  {
    //basic animation
    this.contentnode.clientHeight;//force css update
    this.contentnode.classList.add("utdialog--aftershow");
  }
}

dialogapi.setupDialogs(options => new UTDialog(options));
```
You can use the SCSS code as above, but with `utdialog` instead of `mydialog`

Alternatively, you can decide to only load `dompack/components/dialog`, and
derive your own dialog class from `dialogapi.DialogBase`

## Invoking a dialog
```javascript
async function myDialogFunction() // 'await' in this example requires the function to be async
{
  // Create dialog
  let dialog = dialogapi.createDialog();

  // Put something into the dialog.contentnode. Your event handlers should invoke
  // 'dialog.resolve(...)' to close the dialog
  let button = dompack.create('button', { className: 'mybutton'
                                        , textContent: 'do not press this button'
                                        , type: 'button'
                                        , on: { click: event => dialog.resolve( { boom: true } )
                                              }
                                        });
  dialog.contentnode.appendChild(button);

  // Show the dialog. runModal returns a promise that will resolve to the dialog result
  let result = await dialog.runModal();

  // result will be {boom:true} if the user pressed the button, and null if the
  // user pressed escape or clicked outside the dialog.
}
```

## Running a message box
`await dialogapi.runMessageBox(question, choices, options)`
