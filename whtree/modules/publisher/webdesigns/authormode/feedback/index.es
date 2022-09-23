import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog.es';
import * as feedbackapi from "@mod-publisher/js/feedback";
import { getTid } from "@mod-tollium/js/gettid";

import * as authorservice from "../authorservice.rpc.json";

let aboutdompointer = null, dontshowagain = null;
let feedbackToken = null, userData;

async function submitFeedback(dialog, event, result)
{
  //TODO prevent double submissions
  dompack.stop(event);

  //SubmitFeedback. TODO capture browser triplet and resolution etc too
  let form = event.target;
  let submission = await authorservice.submitFeedback(result.guid,
    { topic: form.elements.topic.value
    , remarks: form.elements.remarks.value
    });

  await dialogapi.runMessageBox(
    <div>
      <h2>{ getTid("publisher:site.authormode.feedbacksubmitted") }</h2>
      <p>{ submission.responsetext }</p>
    </div>,
      [ { title: getTid("tollium:tilde.ok"), result: "ok" }
      ], { /*signal: actrl.signal, */allowcancel: true });

  dialog.resolve("ok");
}

export async function runFeedbackReport(event, addElement)
{
  if (!feedbackToken)
    return;

  if (addElement && !localStorage.whFeedbackHintHidden)
  {
    if (!aboutdompointer)
    {
      aboutdompointer =
        <div class="wh-authormode__aboutdompointer">
          <div class="wh-authormode__aboutdompointer__block">
            <span class="wh-authormode__aboutdompointer__text">{ getTid("publisher:site.authormode.aboutdompointer") }</span>
            <span class="wh-authormode__aboutdompointer__dontshowagain">
              <label>
                { dontshowagain = <input type="checkbox" /> }
                &nbsp;
                { getTid("publisher:site.authormode.dontshowagain") }
              </label>
            </span>
          </div>
        </div>;
    }

    // Create a promise, store the resolve callback
    let aboutresolve;
    const aboutpromise = new Promise(resolve => aboutresolve = resolve);
    // Upon clicking, set whFeedbackHintHidden and call the resolve callback
    dontshowagain.checked = false;
    dontshowagain.onchange = () => { localStorage.whFeedbackHintHidden = "1"; aboutresolve(); };
    // Show the aboutdompointer block
    document.body.append(aboutdompointer);
    // Wait for 2 seconds before calling the resolve callback
    setTimeout(aboutresolve, 2000);
    // Wait for the promise
    await aboutpromise;
    // Remove the aboutdompointer block again
    aboutdompointer.remove();
  }

  // Get the feedback data with the screenshot
  // TODO there needs to be a spinner "Preparing Feedback" or something like that
  const result = await feedbackapi.getFeedback(event, { addElement });
  if (!result.success)
  {
    if (result.error != "cancelled")
    {
      await dialogapi.runMessageBox(getTid("publisher:site.authormode.feedbackerror"),
          [ { title: getTid("tollium:tilde.close"), result: "ok" }
          ], { /*signal: actrl.signal, */allowcancel: true });
    }
    return;
  }

  // Create dialog
  let dialog = dialogapi.createDialog({ /*signal: actrl.signal, */allowcancel: false });
  dialog.contentnode.append(
    <form onSubmit={ event => submitFeedback(dialog, event, result) }>
      <h2>{ getTid("publisher:site.authormode.feedbackform") }</h2>
      <p>
        <label>{ getTid("publisher:site.authormode.from") }: </label>
        { userData.name }
      </p>
      <p>
        <label for="topic">{ getTid("publisher:site.authormode.topic") }:</label><br/>
        <select name="topic" required>
          <option value="" selected disabled>{ getTid("publisher:site.authormode.topic-placeholder") }</option>
          { result.topics.map(topic => <option value={topic.tag}>{topic.title}</option>) }
        </select>
      </p>
      <p>
        <label for="remarks">{ getTid("publisher:site.authormode.remarks") }:</label><br/>
        <textarea name="remarks" placeholder={ getTid("publisher:site.authormode.remarks-placeholder") } maxlength="4096"></textarea>
      </p>
      <div class="wh-authormode__message__buttongroup">
        <button onClick={ () => dialog.resolve("cancel") }>{ getTid("tollium:tilde.cancel") }</button>
        <button type="submit">{ getTid("tollium:tilde.submit") }</button>
      </div>
    </form>
    );

  await dialog.runModal();
}

// Initialize the feedback options
try
{
  if (localStorage?.whFeedbackToken.match(/^[^.]*\.[^.]*\.[^.]*$/))
  {
    feedbackToken = localStorage.whFeedbackToken;
    userData = JSON.parse(atob(feedbackToken.split(".")[1]));
    feedbackapi.initFeedback({ token: feedbackToken });
  }
}
catch(ignore) {}
