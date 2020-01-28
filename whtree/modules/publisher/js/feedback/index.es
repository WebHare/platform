import takeScreenshot from "./screenshot";
import pointAtDOM from "./dompointer";
import * as service from "./internal/feedback.rpc.json";
import "./styles.css";

let feedbackOptions =
    { scope: ""
    , addElement: true
    , highlightCallback: null
    , domFilterCallback: null
    , feedbackPromise: null
    };

export function initFeedback(options)
{
  feedbackOptions = { ...feedbackOptions, ...options };
  if (!feedbackOptions.scope)
    console.error(`No scope supplied for feedback`);
}

export async function getFeedback(event, extraOptions)
{
  const options = { ...feedbackOptions, ...extraOptions };
  const element = options.addElement ? await pointAtDOM(event, options) : null;
  if (!options.addElement || element)
  {
    const data = takeScreenshot(options.domFilterCallback);
    const extraData = options.feedbackPromise ? await options.feedbackPromise() : {};
    if (extraData)
      return await service.storeFeedback(options.scope, { ...data, element, extraData });
  }
  return { success: false, error: "cancelled" };
}
