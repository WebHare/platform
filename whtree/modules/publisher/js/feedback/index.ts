import { KeyValueObject, PlainValue, Properties } from "@mod-system/js/types";
import takeScreenshot from "./screenshot";
import pointAtDOM from "./dompointer";
// @ts-ignore the typescript compiler doesn't support importing .rpc.json files
import * as service from "./internal/feedback.rpc.json";
import "@mod-publisher/web/common/feedback/styles.css";

export type HighlightCallback = (node: Element) => Element;
export type DOMFilterCallback = (node: Element) => Element;

export interface UserData
{
  /** The user's name */
  realname: string;
  /** The user's email address */
  email: string;
}
export interface FeedbackOptions
{
  /** Feedback token, a JSON Web Token as returned by GetFeedbackWebToken */
  token?: string;
  /** Author data */
  userData?: UserData;
  /** If the user should be asked to point at an element */
  addElement?: boolean;
  /** A function that, given a hovered element, returns the element that should be
        highlighted (optional, by default the hovered element is highlighted) */
  highlightCallback?: HighlightCallback;
  /** A function that, given a DOM element, returns whether the element returns if
        the element should be included in the screenshot (optional, by default all elements are included) */
  domFilterCallback?: DOMFilterCallback;
  /** A function that receives the screenshot DOM fragment and can do additional
        filtering or manipulation */
  postFilterCallback?: (node: DocumentFragment) => void;
  /** A function that returns a Promise, which resolves with extra data (a record-like
        object) to add to the feedback */
  feedbackPromise?: () => Promise<KeyValueObject<PlainValue>>;
}

export interface FeedbackResult
{
  /**  If the feedback was successfully stored  */
   success: boolean;

   /** If successful, the feedback GUID */
   guid?: string;

   /** If successful, an array of available topics */
   topics?: {
    /** The topic tag */
     tag: string,
     /** The topic title */
     title: string,
   }[];

   /** If not succesful, an error message */
   error?: string;
}

export interface ScreenshotData
{
  readonly version: number;
  screenshot: {
    htmlAttrs: Properties;
    styleSheets: string[];
    bodyAttrs: Properties;
    bodyContents: string;
  };
  size: {
    width: number,
    height: number
  };
  browser: string;
  device: string;
  userAgent: string;
  url: string; // version 2
}

export interface PointOptions
{
  highlightCallback?: HighlightCallback;
}

export interface PointResult
{
  top: number;
  left: number;
  width: number;
  height: number;
}


const defaultOptions: FeedbackOptions = { token: "", addElement: true };
let feedbackOptions: FeedbackOptions;

/**
    Initialize the global feedback options

    @param options - New options
 */
export function initFeedback(options: FeedbackOptions): void
{
  feedbackOptions = { ...defaultOptions, ...options };
}


/**
     Get feedback

    @param event - The event that caused requesting the feedback (optional)
    @param extraOptions - Extra options, overwriting the global options
    @returns The result
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
