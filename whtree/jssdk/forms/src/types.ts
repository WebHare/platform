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
