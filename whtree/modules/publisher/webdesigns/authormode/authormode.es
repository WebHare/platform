import "typeface-roboto";
import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog';
import * as dialog from 'dompack/components/dialog';
import { getTid } from "@mod-tollium/js/gettid";
import { runFeedbackReport } from "./feedback";

import "./authormode.scss";
import "./authormode.lang.json";


function reportIssue(event, addElement)
{
  dompack.stop(event);
  runFeedbackReport(event, addElement);
}

function setupAuthorMode()
{
  console.log("[authormode] activating");

  document.body.append(
    <wh-authorbar>
      <div class="wh-authorbar__title">{ getTid("publisher:site.authormode.title") }</div>
      <div class="wh-authorbar__actions">
        <ul class="wh-authorbar__actiongroup">
          <li class="wh-authorbar__action">
            <a href={`${location.origin}/.publisher/common/find/?url=${encodeURIComponent(location.href)}`} target="_blank">{ getTid("publisher:site.authormode.openinwebhare") }</a>
          </li>
        </ul>
        <ul class="wh-authorbar__actiongroup">
          <li class="wh-authorbar__action">
            <a href="#" onClick={event => reportIssue(event, true)}>{ getTid("publisher:site.authormode.feedback-specific") }</a>
          </li>
          <li class="wh-authorbar__action">
            <a href="#" onClick={event => reportIssue(event, false)}>{ getTid("publisher:site.authormode.feedback-general") }</a>
          </li>
        </ul>
      </div>
    </wh-authorbar>)
}

dialogapi.setupDialogs(options => dialog.createDialog('wh-authormode__dialog', options), { messageboxclassbase: "wh-authormode__message__" });
dompack.onDomReady(setupAuthorMode);
