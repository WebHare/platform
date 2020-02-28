import * as feedback from "@mod-publisher/js/feedback";
import getTid from "@mod-tollium/js/gettid";
import { runSimpleScreen } from "@mod-tollium/web/ui/js/dialogs/simplescreen";

const $todd = require('@mod-tollium/web/ui/js/support');

export async function handleFeedback(event)
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
