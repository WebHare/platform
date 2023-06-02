/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from "dompack";
import * as feedback from "@mod-publisher/js/feedback";
import getTid from "@mod-tollium/js/gettid";
import { createImage } from "@mod-tollium/js/icons";
import { runSimpleScreen } from "@mod-tollium/web/ui/js/dialogs/simplescreen";
import * as $todd from "@mod-tollium/web/ui/js/support";

export default class TolliumFeedbackAPI {
  constructor() {
    // Add a trigger node
    this.trigger =
      <span class="wh-tollium__feedback">
        {createImage("tollium:objects/bug", 24, 24, "b")}
      </span>;

    this.trigger.addEventListener("click", async event => {
      this.trigger.classList.add("wh-tollium__feedback--active");
      await this.run(event, this.trigger);
      this.trigger.classList.remove("wh-tollium__feedback--active");
    });
    document.body.append(this.trigger);

  }

  remove() {
    this.trigger.remove();
    this.trigger = null;
  }

  async run(event) {
    return run(event, { token: this.token });
  }
}

export async function run(event, options) {
  // Ask if the user wants to give feedback for a certain DOM element
  const which = await runSimpleScreen($todd.getActiveApplication(),
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

  if (which !== "cancel") {
    // Get the feedback data with the screenshot
    const result = await feedback.getFeedback(event, { addElement: which === "specific", ...options });
    if (result.success) {
      // Ask for extra information
      window.$shell.startBackendApplication("publisher:submitfeedback", null, { target: { guid: result.guid } });
    }
  }
}


function filterDOM(node) {
  // Nodes other than alements (e.g. text, comments) are always allowed
  if (node.nodeType != Node.ELEMENT_NODE)
    return true;
  // Don't include the trigger element in the screenshot
  return !node.classList.contains("wh-tollium__feedback")
    // Don't include invisible applications
    && (!node.classList.contains("appcanvas") || node.classList.contains("appcanvas--visible"))
    // Don't include invisible tab sheets
    && (!node.classList.contains("tabsheet") || !node.classList.contains("invisible"));
}

// Initialize the feedback options - we always init, as backend apps can trigger feedback too
feedback.initFeedback({
  domFilterCallback: filterDOM
});
