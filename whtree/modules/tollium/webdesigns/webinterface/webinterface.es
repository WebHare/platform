import './css/webinterface.scss';
import 'typeface-roboto';
import 'typeface-roboto-mono';
import './pages/harescripterror';

import * as dompack from "dompack";
import * as feedback from "@mod-publisher/js/feedback";
import * as whintegration from "@mod-system/js/wh/integration";
import getTid from "@mod-tollium/js/gettid";
import { createImage } from "@mod-tollium/js/icons";
import { runSimpleScreen } from "@mod-tollium/web/ui/js/dialogs/simplescreen";

require('font-awesome/css/font-awesome.css');
require('@mod-wrd/js/auth');

const IndyShell = require('@mod-tollium/web/ui/js/shell');
const $todd = require('@mod-tollium/web/ui/js/support');


function initFeedback(node)
{
  if (whintegration.config.dtapstage === "development")
  {
    const trigger =
      <span class="wh-tollium__feedback">
        { createImage("tollium:objects/bug", 24, 24, "b") }
      </span>;
    trigger.addEventListener("click", event => doFeedback(event, trigger));
    node.append(trigger);

    feedback.initFeedback({
      scope: "tollium:webharebackend",
      domFilterCallback: filterDOM
    });
  }
}

async function doFeedback(event, trigger)
{
  trigger.classList.add("wh-tollium__feedback--active");
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
    const result = await feedback.getFeedback(event, { addElement: which === "specific" });
    if (result.success)
      window.$shell.startBackendApplication("tollium:feedback", null, { target: { guid: result.guid } });
  }
  trigger.classList.remove("wh-tollium__feedback--active");
}

function filterDOM(node)
{
  return node.nodeType != Node.ELEMENT_NODE || !node.classList.contains("wh-tollium__feedback");
}

if(document.documentElement.classList.contains('wh-tollium--app'))
{
  if(!document.all && ("max" in document.createElement("progress")) && !document.documentElement.classList.contains("previewframe")) //IE < 11
  {
    window.$shell = new IndyShell;
    dompack.register("body", node => initFeedback(node));
  }
}
else if(window.parent && document.documentElement.classList.contains("previewframe")) //plain preview interface
{
  if(window.parent.suggestRenderingPDF)
  {
    let whpdfnode = document.querySelector('wh-pdf');
    if(whpdfnode)
      window.parent.suggestRenderingPDF(whpdfnode.getAttribute("url"));
  }
}
