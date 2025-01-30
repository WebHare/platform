import * as $todd from "@mod-tollium/web/ui/js/support";
import * as dompack from 'dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "../../common.lang.json";
import type { ApplicationBase } from "../application";

interface SimpleScreenSettings {
  text: string;
  title?: string;
  /** List of buttonw */
  buttons: Array<{
    name: string;
    title: string;
  }>;
  defaultbutton?: string;
  icon?: "confirmation" | "error" | "information" | "question" | "unrecoverable" | "warning";
  wordWrap?: boolean;
  /** Called when a buttons is clicked. Signature: function (buttonname) */
  onclose?: (buttonname: string) => void;
}

/** Create a message box
    @param app - Parent application
    @param options - Options
*/
export async function runSimpleScreen(app: ApplicationBase, options: SimpleScreenSettings) { //TODO move API closer to tollium's RunSimpleScreen
  using busylock = app.getTopScreen()?.lockScreen() ?? dompack.flagUIBusy();
  void busylock;

  const defer = Promise.withResolvers();
  try {
    await app.promiseComponentTypes(['panel', 'button', 'action', 'text']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no clean way yet to specify an inline Tollium dialog
    const dialog: Record<string, any> =
    {
      frame: {
        bodynode: 'root',
        specials: [],
        allowresize: false,
        title: options.title || getTid("tollium:shell.messagebox.defaulttitle"),
        defaultbutton: options.defaultbutton ? 'button_' + options.defaultbutton : '',
        width: options?.wordWrap ? '100x' : '',
      },

      root: {
        type: 'panel',
        lines: [
          { layout: "block", items: [{ item: "body" }], height: '1pr' },
          { layout: "block", items: [{ item: "footer" }] }
        ],
        height: '1pr',
        width: '1pr'
      },
      body: {
        type: 'panel',
        lines: [{ title: '', layout: 'left', items: [{ item: 'text' }] }],
        height: '1pr',
        spacers: { top: true, bottom: true, left: true, right: true },
        width: '1pr'
      },
      footer: {
        type: 'panel',
        lines: [{ items: [], layout: 'right' }],
        spacers: { top: true, bottom: true, left: true, right: true },
        isfooter: true,
        width: '1pr'
      },
      text: { type: 'text', value: options.text, wordwrap: options?.wordWrap, width: '1pr' }
    };

    if (options.icon) {
      dialog.body.lines[0].items.unshift({ item: 'icon' });
      dialog.icon = {
        type: 'image',
        settings: { imgname: "tollium:messageboxes/" + options.icon, width: 32, height: 32, color: "b" },
        width: "32px", height: "32px"
      };
    }

    options.buttons.forEach(button => {
      dialog['action_' + button.name] = { type: 'action', hashandler: true, unmasked_events: ['execute'] };
      dialog['button_' + button.name] = { type: 'button', title: button.title, action: 'action_' + button.name };
      dialog.frame.specials.push('action_' + button.name);
      dialog.footer.lines[0].items.push({ item: 'button_' + button.name });
    });

    const newscreen = app.createNewScreenObject('dialog', 'frame', $todd.componentsToMessages(dialog));
    options.buttons.forEach(button => {
      newscreen.setMessageHandler("action_" + button.name, "execute", function (data: unknown, callback: () => void) {
        //ADDME if (! onclick or something like that i think) ?
        newscreen.terminateScreen();
        if (options.onclose)
          options.onclose(button.name);

        defer.resolve(button.name);
        callback(); //finalize the action
      });
    });

    return defer.promise;
  } finally {
    //probably no more finally needed now that we have using?
  }
}
