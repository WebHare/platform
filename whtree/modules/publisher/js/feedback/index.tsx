import takeScreenshot from "./screenshot";
import pointAtDOM from "./dompointer";
import * as service from "./internal/feedback.rpc.json";
import "@mod-publisher/web/common/feedback/styles.css";

export interface DeferredPromise<T>
{
  promise: Promise<T>;
  resolve: (result: T) => void;
  reject: (error: Error) => void;
}

// Object with string keys and string, number of boolean values
type KeyValueObject = { [key: string]: { value: string | number | boolean }};

type HighlightCallback = (node: Element) => Element;

export interface FeedbackOptions
{
  token: string;
  addElement?: boolean;
  highlightCallback?: HighlightCallback;
  domFilterCallback?: (node: Node) => boolean;
  postFilterCallback?: (node: DocumentFragment) => void;
  feedbackPromise?: () => Promise<KeyValueObject>;
}

export interface FeedbackResult
{
  success: boolean;
  guid?: string; // if success == true
  error?: string; // if success == false
}

export interface ScreenshotData
{
  readonly version: number;
  screenshot: {
    htmlAttrs: Array<{ name: string, value: string }>;
    styleSheets: Array<string>;
    bodyAttrs: Array<{ name: string, value: string }>;
    bodyContents: string;
  };
  size: {
    width: Number,
    height: number
  };
  browser: string;
  device: string;
  userAgent: string;
  url: string; // version 2
};

export interface PointOptions
{
  highlightCallback: HighlightCallback;
}

export interface PointResult
{
  top: number;
  left: number;
  width: number;
  height: number;
}


const defaultOptions: FeedbackOptions = { token: null, addElement: true };
let feedbackOptions: FeedbackOptions;

/** @short Initialize the global feedback options
    @param options New options
    @cell options.userData Author data
    @cell options.userData.realname The user's name
    @cell options.userData.email The user's email address
    @cell options.addElement If the user should be asked to point at an element
    @cell options.highlightCallback A function that, given a hovered element, returns the element that should be
        highlighted (optional, by default the hovered element is highlighted)
    @cell options.domFilterCallback A function that, given a DOM element, returns whether the element returns if
        the element should be included in the screenshot (optional, by default all elements are included)
    @cell options.postFilterCallback A function that receives the screenshot DOM fragment and can do additional
        filtering or manipulation
    @cell options.feedbackPromise A function that returns a Promise, which resolves with extra data (a record-like
        object) to add to the feedback
*/
export function initFeedback(options: FeedbackOptions): void
{
  feedbackOptions = { ...defaultOptions, ...options };
}

/** @short Get feedback
    @param event The event that caused requesting the feedback (optional)
    @param extraOptions Extra options, overwriting the global options @includecelldef %initFeedback.options
    @return The result
    @cell(boolean) return.success If the feedback was successfully stored
    @cell(string) return.guid If successful, the feedback GUID
    @cell(string) return.error If not successful, an error message
*/
export async function getFeedback(event?: MouseEvent, extraOptions?: FeedbackOptions): Promise<FeedbackResult>
{
  const options = { ...feedbackOptions, ...extraOptions };
  const element = options.addElement ? await pointAtDOM(event, { highlightCallback: options.highlightCallback }) : null;
  if (!options.addElement || element)
  {
    const data = takeScreenshot(options.domFilterCallback, options.postFilterCallback);
    const extraData = options.feedbackPromise ? await options.feedbackPromise() : {};
    if (extraData)
      return await service.storeFeedback(location.pathname, "unused_scope", { ...data, element, extraData, token: options.token });
  }
  return { success: false, error: "cancelled" };
}
