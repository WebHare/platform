import './css/webinterface.scss';
import 'typeface-roboto';
import 'typeface-roboto-mono';
import './pages/harescripterror';

import * as dompack from "dompack";
import * as feedback from "@mod-publisher/js/feedback";
import * as whintegration from "@mod-system/js/wh/integration";
import { createImage } from "@mod-tollium/js/icons";
import { handleFeedback } from "./js/feedback";

require('font-awesome/css/font-awesome.css');
require('@mod-wrd/js/auth');

const IndyShell = require('@mod-tollium/web/ui/js/shell');


function initFeedback(node)
{
  // Initialize the feedback handler if this is a development server
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
      await handleFeedback(event, trigger);
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

function filterDOM(node)
{
  // Don't include the trigger element in the screenshot
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
