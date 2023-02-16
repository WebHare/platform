import "typeface-roboto";
import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog';
import * as dialog from 'dompack/components/dialog';
import { getTid } from "@mod-tollium/js/gettid";
import { runFeedbackReport } from "./feedback";

import "./authormode.scss";
import "./authormode.lang.json";


function reportIssue(event: MouseEvent, addElement: boolean) {
  dompack.stop(event);
  runFeedbackReport(event, addElement);
}

function focusFirstAction() {
  (document.querySelector("wh-authorbar a") as HTMLElement)?.focus();
}

function hideAuthorMode() {
  document.documentElement.classList.remove("wh-authormode--active");
}

function setupAuthorMode() {
  console.log("[authormode] activating");

  document.body.append(
    <wh-authorbar>
      <div class="wh-authorbar__title" onClick={focusFirstAction}>{getTid("publisher:site.authormode.title")}</div>
      <div class="wh-authorbar__actions">
        <ul class="wh-authorbar__actiongroup">
          <li class="wh-authorbar__action">
            <a href="#" onClick={(event: MouseEvent) => reportIssue(event, true)}>{getTid("publisher:site.authormode.feedback-specific")}</a>
          </li>
          <li class="wh-authorbar__action">
            <a href="#" onClick={(event: MouseEvent) => reportIssue(event, false)}>{getTid("publisher:site.authormode.feedback-general")}</a>
          </li>
        </ul>
        <ul class="wh-authorbar__actiongroup">
          <li class="wh-authorbar__action">
            <a href={`${location.origin}/.publisher/common/find/?url=${encodeURIComponent(location.href)}`} rel="noopener noreferrer" target="_blank">{getTid("publisher:site.authormode.openinwebhare")}</a>
          </li>
          <li class="wh-authorbar__action">
            <a href="#" onClick={(event: MouseEvent) => hideAuthorMode()}>{getTid("publisher:site.authormode.hideauthormode")}</a>
          </li>
        </ul>
      </div>
    </wh-authorbar>);

  //no positioning selected?
  if (!document.documentElement.matches('.wh-authorbar--left,.wh-authorbar--right'))
    document.documentElement.classList.add('wh-authorbar--right');

  document.documentElement.classList.add("wh-authormode--active");
}

dialogapi.setupDialogs(options => dialog.createDialog('wh-authormode__dialog', options), { messageboxclassbase: "wh-authormode__message__" });
dompack.onDomReady(setupAuthorMode);
