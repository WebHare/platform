import * as dompack from "@webhare/dompack";
import getTid from "@mod-tollium/js/gettid";
import { createImage } from "@mod-tollium/js/icons";
import { runSimpleScreen } from "@mod-tollium/web/ui/js/dialogs/simplescreen";
import { getActiveApplication } from "@mod-tollium/web/ui/js/support";
import { getIndyShell } from "@mod-tollium/web/ui/js/shell";
import { prepareFeedback } from "@mod-publisher/js/feedback/screenshot";

function filterDOM(node: Element) {
  // Nodes other than alements (e.g. text, comments) are always allowed
  if (node.nodeType !== Node.ELEMENT_NODE)
    return true;
  // Don't include the trigger element in the screenshot
  return !node.classList.contains("wh-tollium__feedback")
    // Don't include invisible applications
    && (!node.classList.contains("appcanvas") || node.classList.contains("appcanvas--visible"))
    // Don't include invisible tab sheets
    && (!node.classList.contains("tabsheet") || !node.classList.contains("invisible"));
}

export default class TolliumFeedbackAPI {
  private trigger: HTMLElement;
  token = ''; //set by shell _updateFeedbackHandler

  constructor() {
    // Add a trigger node
    this.trigger =
      <span class="wh-tollium__feedback">
        {createImage("tollium:objects/bug", 24, 24, "b")}
      </span>;

    this.trigger.addEventListener("click", async event => {
      this.trigger.classList.add("wh-tollium__feedback--active");
      await this.run(event);
      this.trigger.classList.remove("wh-tollium__feedback--active");
    });
    document.body.append(this.trigger);

  }

  /** Remove us from the DOM */
  remove() {
    this.trigger.remove();
    //after this we should be garbage collectible as our caller should drop the reference
  }

  async run(event: MouseEvent) {
    const app = getActiveApplication();
    if (!app)
      return;

    // Ask (using a proper Tollium dialog) if the user wants to give feedback for a certain DOM element
    const which = await runSimpleScreen(app,
      {
        text: getTid("tollium:shell.feedback.message"),
        title: getTid("tollium:shell.feedback.title"),
        buttons:
          [
            {
              name: "specific",
              title: getTid("tollium:shell.feedback.button-specific")
            },
            {
              name: "general",
              title: getTid("tollium:shell.feedback.button-general")
            },
            {
              name: "cancel",
              title: getTid("~cancel")
            }
          ],
        defaultbutton: "specific",
        icon: "question"
      });

    if (which === "cancel")
      return;

    const application = app.getToplevelApp().appname;
    const prepped = await prepareFeedback({
      token: this.token,
      addElement: which === "specific",
      initialMouseEvent: event,
      domFilterCallback: filterDOM
    });

    /* Using the upload flow might have been nice (esp. for slow connections) but it looks like Tollium will *push* the upload to an existing
       app and I can't access the upload from a newly started app (it won't get the upload). It might be cleaner to reengineer Tollium to
       always *pull* the upload and only receive the token (and we probably need that for WASM apps anyway)

    const screenshotAsBlob = await new Promise(resolve => screenshot.toBlob(resolve));
    console.error({ screenshot, screenshotAsBlob });

    const uploader = new compatupload.UploadSession([screenshotAsBlob]);//, { params: { tolliumdata: getUploadTolliumData(component) } });
    const uploadcontroller = new UploadDialogController({ displayapp: app }, uploader);
    const result = await uploader.upload();
    console.error(result);
    uploadcontroller.close();
    */

    getIndyShell().executeInstruction({
      type: "appmessage",
      app: "connect:submitfeedback",
      target: {
        ...prepped,
        application
      },
      message: null,
      reuse_instance: "never",
      inbackground: false
    });
  }
}
