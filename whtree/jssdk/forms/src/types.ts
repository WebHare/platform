declare global {
  interface GlobalEventHandlersEventMap {
    "wh:form-analytics": FormAnalyticsEvent;
  }
}

export type FormAnalyticsSubEvents = {
  event: "started";
} | {
  event: "failed";
  errorfields: string;
  errorsource: "server" | "nextpage" | "client";
} | {
  event: "exception";
  exception: string;
  errorsource: "server" | "client";
} | {
  event: "slow";
  waitfor: "submit";
} | {
  event: "nextpage" | "previouspage";
  targetpagenum: number;
  targetpagetitle: string;
} | {
  event: "submitted";
};

export type FormAnalyticsEventData = { //Note that this set needs to correspond with the pxlEvents in mod::platform/moduledefinition.yml
  /** Event type */
  event: FormAnalyticsSubEvents["event"];
  /** Form identifier */
  id: string;
  /** Form WHFS object ref (like pxl 'ob') */
  objref: string;
  /** Unique instance id for this form filling session (different per form on a page, always unique per page load) */
  session: string;
  /** Number of the current form page (1 based) s*/
  pagenum: number;
  /** Title of the current form page */
  pagetitle: string;
  /** Time passed since form interaction started */
  time: number;
  /** Waiting time in msec since start of form submission */
  waittime?: number;
} & FormAnalyticsSubEvents;

export type FormAnalyticsEvent = CustomEvent<FormAnalyticsEventData>;

export interface EmailValidationResult { /** If blocked, the suggested error message */
  blocked?: string;
  /** If set, the emailaddress should be forced to this value */
  force?: string;
  /** Suggested email address */
  suggestion?: string;
}

/** How the server understands which form we're trying to talk to */
export interface RPCFormTarget {
  ///URL without origin
  url: string;
  ///Form target id (defined by the server, passed in `form[data-wh-form-target]`)
  target: string;
}

export interface RPCFormInvokeBase extends RPCFormTarget {
  vals: Array<{
    name: string;
    value: unknown;
  }>;
}

export interface RPCFormInvokeRPC extends RPCFormInvokeBase {
  methodname: string;
  args: unknown[];
}

export interface RPCFormSubmission extends RPCFormInvokeBase {
  extrasubmit?: unknown;
}

export type FormCondition = {
  matchtype: "IN" | "HAS" | "IS";
  field: string;
  value: unknown;
  options?: {
    matchcase?: boolean;
    checkdisabled?: boolean;
  };
} | {
  matchtype: "HASVALUE";
  field: string;
  value: boolean;
  options?: {
    checkdisabled?: boolean;
  };
} | {
  matchtype: "AGE<" | "AGE>=";
  field: string;
  value: number;
  options?: {
    checkdisabled?: boolean;
  };
} | {
  matchtype: "AND" | "OR";
  conditions: FormCondition[];
} | {
  matchtype: "NOT";
  condition: FormCondition;
};

/** A file/image value in a form. link or file is set depending on whether the resource is currently available clientside
 *  or serverside (the latter happens when editing an existing form value)
 */
export type FormFileValue = {
  fileName: string;
  file: File;
  link: null;
} | {
  fileName: string;
  file: null;
  link: string;
};
