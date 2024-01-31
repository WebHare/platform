import "typeface-roboto";
import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog';
import * as dialog from 'dompack/components/dialog';
import { getTid } from "@mod-tollium/js/gettid";
import { runFeedbackReport } from "./feedback";

import "./authormode.scss";
import "./authormode.lang.json";

export interface AuthorModeOptions {
  //whether to show feedback options. only include if you've set up a module to actually handle feedback and screenhots!
  allowFeedback?: boolean;
  //optional list of feedback topics
  topics?: Array<{
    rowkey: string;
    title: string;
  }>;
  //orientation. defaults to 'right'
  orientation?: 'left' | 'right';
}

declare global {
  interface Window {
    whAuthorModeOptions?: AuthorModeOptions;
  }
}

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
        {window.whAuthorModeOptions?.allowFeedback ?
          <ul class="wh-authorbar__actiongroup">
            <li class="wh-authorbar__action">
              <a href="#" onClick={(event: MouseEvent) => reportIssue(event, true)}>{getTid("publisher:site.authormode.feedback-specific")}</a>
            </li>
            <li class="wh-authorbar__action">
              <a href="#" onClick={(event: MouseEvent) => reportIssue(event, false)}>{getTid("publisher:site.authormode.feedback-general")}</a>
            </li>
          </ul> : null}
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

  document.documentElement.classList.add("wh-authormode--active");
}

const orientation = window.whAuthorModeOptions?.orientation ?? 'right';
document.documentElement.classList.add('wh-authorbar--orientation-' + orientation);

dialogapi.setupDialogs(options => dialog.createDialog('wh-authormode__dialog', options), { messageboxclassbase: "wh-authormode__message__" });
dompack.onDomReady(setupAuthorMode);
