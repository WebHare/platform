import * as dompack from '@webhare/dompack';
import * as storage from 'dompack/extra/storage';
import * as dialogapi from 'dompack/api/dialog';
import { createClient } from "@webhare/jsonrpc-client";
import { prepareFeedback } from "@mod-publisher/js/feedback/screenshot";
import { getTid } from "@mod-tollium/js/gettid";
import type { PublisherFeedback, FeedbackResult, PreparedFeedback } from '@mod-publisher/js/feedback';

// The RPC service used to submit feedback
interface AuthorService {
  submitFeedback(data: PublisherFeedback): Promise<FeedbackResult>;
}

// The payload of the JSON Web Token as returned by GetFeedbackWebToken
interface UserData {
  iap: Date;
  sub: string;
  name: string;
  email: string;
  preferred_username: string;
}

const authorservice = createClient<AuthorService>("publisher:authorservice");

// The form elements we want to address through the form.elements property
interface FeedbackFormElements extends HTMLFormControlsCollection {
  topic?: HTMLSelectElement;
  remarks: HTMLTextAreaElement;
}

let aboutdompointer: HTMLElement | null = null;
let dontshowagain: HTMLInputElement | null = null;
let feedbackToken: string | null = null;
let userData: UserData | null = null;

async function submitFeedback(dialog: dialogapi.DialogBase, event: SubmitEvent, prepped: PreparedFeedback) {
  //TODO prevent double submissions
  dompack.stop(event);

  //SubmitFeedback. TODO capture browser triplet and resolution etc too
  const form = event.target as HTMLFormElement;
  const elements = form?.elements as FeedbackFormElements;
  const feedbackinfo: PublisherFeedback = {
    ...prepped,
    topic: elements.topic?.value || '',
    remarks: elements.remarks.value || ''
  };

  try {
    const submission = await authorservice.submitFeedback(feedbackinfo);
    if (!submission.success)
      throw new Error(submission.response_text || "Unknown submitFeedback error");
    await dialogapi.runMessageBox(
      <div>
        <h2>{getTid("publisher:site.authormode.feedbacksubmitted")}</h2>
        <p>{submission.response_text}</p>
      </div>,
      [{ title: getTid("tollium:tilde.ok"), result: "ok" }], { /*signal: actrl.signal, */allowcancel: true });

  } catch (e) {
    console.error("Feedback submission failed", e);
    await dialogapi.runMessageBox(
      <div>
        <h2>{getTid("publisher:site.authormode.feedbackfailed-title")}</h2>
        <p>{getTid("publisher:site.authormode.feedbackfailed-text")}</p>
        <p>{(e as Error).message}</p>
      </div>,
      [{ title: getTid("tollium:tilde.close"), result: "close" }], { /*signal: actrl.signal, */allowcancel: true });
  } finally {
    dialog.resolve("ok");
  }
}

export async function runFeedbackReport(event: MouseEvent, addElement: boolean) {
  if (!feedbackToken || !userData)
    return;

  if (addElement && !localStorage.whFeedbackHintHidden) {
    if (!aboutdompointer) {
      aboutdompointer =
        <div class="wh-authormode__aboutdompointer">
          <div class="wh-authormode__aboutdompointer__block">
            <span class="wh-authormode__aboutdompointer__text">{getTid("publisher:site.authormode.aboutdompointer")}</span>
            <span class="wh-authormode__aboutdompointer__dontshowagain">
              <label>
                {dontshowagain = <input type="checkbox" />}
                &nbsp;
                {getTid("publisher:site.authormode.dontshowagain")}
              </label>
            </span>
          </div>
        </div>;
    }

    if (aboutdompointer && dontshowagain) {
      // Create a promise, store the resolve callback
      let aboutresolve: (value: unknown) => void;
      const aboutpromise = new Promise(resolve => aboutresolve = resolve);
      // Upon clicking, set whFeedbackHintHidden and call the resolve callback
      dontshowagain.checked = false;
      dontshowagain.onchange = () => { localStorage.whFeedbackHintHidden = "1"; aboutresolve(true); };
      // Show the aboutdompointer block
      document.body.append(aboutdompointer);
      // Wait for 2 seconds before calling the resolve callback
      // @ts-ignore `resolve` is assigned synchronously, which isn't picked up by the TypeScript compiler (see
      // https://github.com/Microsoft/TypeScript/issues/30053)
      setTimeout(aboutresolve, 2000);
      // Wait for the promise
      await aboutpromise;
      // Remove the aboutdompointer block again
      aboutdompointer.remove();
    }
  }

  const prepped = await prepareFeedback({ token: feedbackToken, addElement: addElement, initialMouseEvent: event });

  // Create dialog
  const topics = window.whAuthorModeOptions?.topics || [];
  const dialog = dialogapi.createDialog({ /*signal: actrl.signal, */allowcancel: false });
  dialog.contentnode?.append(
    <form onSubmit={(formEvent: SubmitEvent) => submitFeedback(dialog, formEvent, prepped)}>
      <h2>{getTid("publisher:site.authormode.feedbackform")}</h2>
      <p>
        <label>{getTid("publisher:site.authormode.from")}: </label>
        {userData.name}
      </p>
      {topics.length ?
        <p>
          <label for="topic">{getTid("publisher:site.authormode.topic")}:</label><br />
          <select name="topic" required>
            <option value="" selected disabled>{getTid("publisher:site.authormode.topic-placeholder")}</option>
            {topics?.map(topic => <option value={topic.rowkey}>{topic.title}</option>)}
          </select>
        </p> : null}
      <p>
        <label for="remarks">{getTid("publisher:site.authormode.remarks")}:</label><br />
        <textarea name="remarks" placeholder={getTid("publisher:site.authormode.remarks-placeholder")} maxlength="4096"></textarea>
      </p>
      <div class="wh-authormode__message__buttongroup">
        <button onClick={() => dialog.resolve("cancel")}>{getTid("tollium:tilde.cancel")}</button>
        <button type="submit">{getTid("tollium:tilde.submit")}</button>
      </div>
    </form>
  );

  await dialog.runModal();
}

// Initialize the feedback options
const parsedtoken = storage.getLocal<string>("wh-feedback:accesstoken");
if (parsedtoken?.match(/^[^.]*\.[^.]*\.[^.]*$/)) {
  feedbackToken = parsedtoken;
  userData = JSON.parse(window.atob(feedbackToken.split(".")[1])) as UserData;
}
