import takeScreenshot from "./screenshot";
import pointAtDOM from "./dompointer";
import * as service from "./internal/feedback.rpc.json";
import "./styles.css";

const defaultOptions =
    { scope: ""
    , addElement: true
    , highlightCallback: null
    , domFilterCallback: null
    , feedbackPromise: null
    };
let feedbackOptions;

export function initFeedback(options)
{
  feedbackOptions = { ...defaultOptions, ...options };
}

export async function getFeedback(event, extraOptions)
{
  const options = { ...feedbackOptions, ...extraOptions };
  if (!options.scope)
    console.error(`No scope supplied for feedback`);
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
