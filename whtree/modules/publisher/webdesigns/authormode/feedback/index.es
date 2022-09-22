import * as dompack from 'dompack';
import "./feedback.scss";
import * as feedbackapi from "@mod-publisher/js/feedback";
import * as dialogapi from 'dompack/api/dialog.es';
import * as authorservice from "../authorservice.rpc.json";

let aboutdompointer = null;
let feedbackToken = null, userData;

function toggleAboutLocation()
{
  //TODO have a way to move the bar out of the way on mobile
  aboutdompointer.classList.toggle("wh-authormode__aboutdompointer--atbottom");
}

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

  await dialogapi.runMessageBox(submission.responsetext,
      [ { title: "Ok", result: "ok" }
      ], { /*signal: actrl.signal, */allowcancel: true });

  dialog.resolve("ok");
}

export async function runFeedbackReport(event)
{
  if (!feedbackToken)
    return;

  //TODO cancel or prevent recursive call (setup an abort controller and signal it if already set)
  let which = await dialogapi.runMessageBox("Betreft je feedback een specifiek element op deze pagina ?",
      [ { title: "Specifiek", result: "specific" }
      , { title: "Algemeen", result: "general" }
      , { title: "Annuleren", result: "cancel" }
      ], { /*signal: actrl.signal, */allowcancel: true });

  if (!which || which === "cancel")
    return;

  if(which == 'specific')
  {
    if(!aboutdompointer)
    {
      //TODO CANCEL button/link..
      aboutdompointer = <div class="wh-authormode__aboutdompointer">Wijs het element aan waarover je feedback wil geven</div>;
      aboutdompointer.addEventListener("mouseenter", toggleAboutLocation);
      document.body.append(aboutdompointer);
    }
    aboutdompointer.classList.remove("wh-authormode__aboutdompointer--atbottom");
  }

  // Get the feedback data with the screenshot
  // TODO there needs to be a spinner "Preparing Feedback" or something like that
  const result = await feedbackapi.getFeedback(event, { addElement: which === "specific" });
  if (!result.success)
  {
    await dialogapi.runMessageBox("Het uploaden van je feedback is helaas niet gelukt. Probeer het later nog eens.",
        [ { title: "Ok", result: "ok" }
        ], { /*signal: actrl.signal, */allowcancel: true });
    return;
  }

  // Create dialog
  let dialog = dialogapi.createDialog();
  dialog.contentnode.append(
    <form onSubmit={ event => submitFeedback(dialog, event, result)}>
      Melder:<br/>
      <input name="email" type="email" readonly value={userData.email}/>
      <br/>

      Type/onderwerp:<br/>
      <select name="topic">
        { result.topics.map(topic => <option value={topic.tag}>{topic.title}</option>) }
      </select>
      <br/>

      Toelichting:<br/>
      <textarea name="remarks"></textarea>
      <br/>

      <button type="submit">Versturen</button>
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
