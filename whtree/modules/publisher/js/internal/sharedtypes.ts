/** The format of the <script id="wh-config"> object  */
export interface WHConfigScriptData {
  ///Plguins may add keys at this level
  [key: string]: unknown;

  //NOTE: existing frontend code doesn't expect site/obj to ever be null. not sure if 'object' provides the best interface or whether we need some sort of 'unknown but an existing object'
  /** Page (targetobject) specific settings */
  obj: { [key: string]: unknown };
  /** Site specific settings */
  site: { [key: string]: unknown };

  /** True if the current WebHare is in production or acceptance DTAP stage. Often used to show/hide developer-targed runtime warnings */
  islive: boolean;
  /** Current WebHare's DTAP stage */
  dtapstage: "production" | "acceptance" | "test" | "development";
  /** Numeric server version number (eg 5.02.24 = 50224) */
  server: number;

  //TODO do we (still) need all these roots?
  siteroot: string;
}
