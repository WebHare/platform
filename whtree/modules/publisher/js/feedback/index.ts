export type HighlightCallback = (node: Element) => Element;
export type DOMFilterCallback = (node: Element) => boolean;
export type PostFilterCallback = (node: HTMLElement) => void;

export interface FeedbackOptions {
  /** Feedback token, a JSON Web Token as returned by GetFeedbackWebToken */
  token?: string;
  /** If the user should be asked to point at an element */
  addElement?: boolean;
  /** A function that, given a hovered element, returns the element that should be highlighted (optional, by default the
      hovered element is highlighted) */
  highlightCallback?: HighlightCallback;
  /** A function that, given a DOM element, returns whether the element returns if the element should be included in the
      screenshot (optional, by default all elements are included) */
  domFilterCallback?: DOMFilterCallback;
  /** A function that receives the screenshot DOM fragment and can do additional filtering or manipulation */
  postFilterCallback?: PostFilterCallback;
  /** A function that returns a releasable lock which is taken when the screenshot is being generated */
  getLock?: () => { release: () => void };
  /** A function that returns a Promise, which resolves with extra data (a record-like object) to add to the feedback */
  feedbackPromise?: () => Promise<Record<string, string | number | boolean>>;
  /** Mouse event that started the feedback, used to start dom highlighting */
  initialMouseEvent?: MouseEvent;
}

export interface PointOptions {
  highlightCallback?: HighlightCallback;
}

export interface FeedbackResult {
  /** If the feedback was successfully stored  */
  success: boolean;

  responsetext: string;
}

export interface PointResult {
  top: number;
  left: number;
  width: number;
  height: number;
  scale: number;
}

export interface PreparedFeedback {
  token?: string;
  image: string;
  browser: string;
  device: string;
  userAgent: string;
  url: string;
  element: PointResult | null;
}

export interface PublisherFeedback extends PreparedFeedback {
  remarks: string;
  topic: string;
}
