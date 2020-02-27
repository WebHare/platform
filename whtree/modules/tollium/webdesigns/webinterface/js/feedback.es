import * as dompack from "dompack";
import * as feedback from "@mod-publisher/js/feedback";
import * as whintegration from "@mod-system/js/wh/integration";
import getTid from "@mod-tollium/js/gettid";
import { createImage } from "@mod-tollium/js/icons";
import { runSimpleScreen } from "@mod-tollium/web/ui/js/dialogs/simplescreen";
import $todd from "@mod-tollium/web/ui/js/support";

export function init(node)
{
  // Add the feedback trigger if this is a development server
  if (whintegration.config.dtapstage === "development")
  {
    // Add a trigger node
    const trigger =
      <span class="wh-tollium__feedback">
        { createImage("tollium:objects/bug", 24, 24, "b") }
      </span>;
    trigger.addEventListener("click", async event =>
    {
      trigger.classList.add("wh-tollium__feedback--active");
      await run(event, trigger);
      trigger.classList.remove("wh-tollium__feedback--active");
    });
    node.append(trigger);
  }

  // Initialize the feedback options
  feedback.initFeedback({
    scope: "tollium:webharebackend",
    domFilterCallback: filterDOM
  });
}

export async function run(event)
{
  // Ask if the user wants to give feedback for a certain DOM element
  const which = await runSimpleScreen($todd.getActiveApplication(),
    { text: getTid("tollium:shell.feedback.message")
    , title: getTid("tollium:shell.feedback.title")
    , buttons:
      [ { name: "specific"
        , title: getTid("tollium:shell.feedback.button-specific")
        }
      , { name: "general"
        , title: getTid("tollium:shell.feedback.button-general")
        }
      , { name: "cancel"
        , title: getTid("tollium:common.actions.cancel")
        }
      ]
    , defaultbutton: "specific"
    , icon: "question"
    });

  if (which !== "cancel")
  {
    // Get the feedback data with the screenshot
    const result = await feedback.getFeedback(event, { addElement: which === "specific" });
    if (result.success)
    {
      // Ask for extra information
      window.$shell.startBackendApplication("tollium:feedback", null, { target: { guid: result.guid } });
    }
  }
}

function filterDOM(node)
{
  // Don't include the trigger element in the screenshot
  return node.nodeType != Node.ELEMENT_NODE || !node.classList.contains("wh-tollium__feedback");
}
