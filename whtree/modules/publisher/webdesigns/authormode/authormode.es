import "./authormode.scss";
import { runFeedbackReport } from "./feedback";
import * as dompack from 'dompack';
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog.es';

function reportIssue(event)
{
  dompack.stop(event);
  runFeedbackReport(event);
}

function setupAuthorMode()
{
  console.log("[authormode] activating");

  document.body.append(
    <wh-authorbar>
      <div class="wh-authorbar__title">WebHare auteursmode!</div>
      <a href="#" class="wh-authorbar__action" onClick={event => reportIssue(event)}>Meld een probleem</a>
    </wh-authorbar>)
}

dialogapi.setupDialogs(options => dialog.createDialog('wh-authormode__dialog', options));
dompack.onDomReady(setupAuthorMode);
