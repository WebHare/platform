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

/** @short Initialize the global feedback options
    @param options New options
    @cell(string) options.scope The feedback scope (required)
    @cell(boolean) options.addElement If the user should be asked to point at an element
    @cell(function) options.highlightCallback A function that, given a hovered element, returns the element that should be
        highlighted (optional, by default the hovered element is highlighted)
    @cell(function) options.domFilterCallback A function that, given a DOM element, returns whether the element returns if
        the element should be included in the screenshot (optional, by default all elements are included)
    @cell(function) options.feedbackPromise A function that returns a Promise, which resolves with extra data (a record-like
        object) to add to the feedback
*/
export function initFeedback(options)
{
  feedbackOptions = { ...defaultOptions, ...options };
}

/** @short Get feedback
    @param event The event that caused requesting the feedback (optional)
    @param extraOptions Extra option, overwriting the global options @includecelldef %initFeedback.options
    @return The result
    @cell(boolean) return.success If the feedback was successfully stored
    @cell(string) return.guid If successful, the feedback GUID
    @cell(string) return.error If not successful, an error message
*/
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
