var $todd = require("../support");
import * as dompack from 'dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "../../common.lang.json";

/** Create a message box
    @param app Parent application
    @param options Options
    @cell options.text
    @cell options.icon "confirmation", "error", "information", "question", "unrecoverable", "warning"
    @cell options.onclose Called when a buttons is clicked. Signature: function(buttonname)
    @cell options.buttons List of buttons
    @cell options.buttons.name Name of button
    @cell options.buttons.title Title of button
*/
export async function runSimpleScreen(app, options) //TODO move API closer to tollium's RunSimpleScreen
{
  let busylock;
  if(app)
    busylock = app.getBusyLock(); //as we may be loading components, lock just to be sasfe

  let defer = dompack.createDeferred();
  try
  {
    await app.promiseComponentTypes(['panel','button','action','text']);

    var dialog =
      { frame:       { bodynode: 'root'
                     , specials: []
                     , allowresize: false
                     , title: options.title || getTid("tollium:shell.messagebox.defaulttitle")
                     , defaultbutton: 'loginbutton'
                     }

      , root:        { type: 'panel', lines: [{items: [ {item:"body"} ], height:'1pr' }
                                             ,{items: [ {item:"footer"} ]}
                                             ]
                     , height:'1pr'
                     }
      , body:        { type: 'panel', lines: [{title: '', layout: 'left', items:[{item:'text'}]}]
                     , height: '1pr'
                     , spacers: { top:true, bottom:true, left:true, right:true }
                     , width:'1pr'
                     }
      , footer:      { type: 'panel'
                     , lines: [{items: [],layout:'right'}]
                     , spacers: { top:true, bottom:true, left:true, right:true }
                     , isfooter: true
                     , width:'1pr'
                     }
      , text:        { type: 'text', value: options.text }
      };

    if (options.icon)
    {
      dialog.body.lines[0].items.unshift({item:'icon'});
      dialog.icon = { type: 'image'
                    , settings: { imgname: "tollium:messageboxes/" + options.icon, width: 32, height: 32, color: "b" }
                    , width: "32px", height: "32px"
                    };
    }

    options.buttons.forEach(button =>
    {
      dialog['action_' + button.name] = { type: 'action', hashandler: true, unmasked_events: ['execute'] };
      dialog['button_' + button.name] = { type: 'button', title: button.title, action: 'action_' + button.name };
      dialog.frame.specials.push('action_' + button.name);
      dialog.footer.lines[0].items.push({item:'button_' + button.name});
    });

    var newscreen = app.createNewScreenObject('dialog', 'frame', $todd.componentsToMessages(dialog));
    options.buttons.forEach(button =>
    {
      newscreen.setMessageHandler("action_" + button.name, "execute", function(data, callback)
      {
        //ADDME if (! onclick or something like that i think) ?
        newscreen.terminateScreen();
        if(options.onclose)
          options.onclose(button.name);

        defer.resolve(button.name);
        callback(); //finalize the action
      });
    });

    return defer.promise;
  }
  finally
  {
    if(busylock)
      busylock.release();
  }
}
