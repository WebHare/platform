import type { MaybePromise } from "@webhare/std";
import type { SpreadsheetData, WorkbookData } from "@webhare/office-formats";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/backend-integration" {
}

export interface FSObjectPolicyBaseContext {
  //TODO provide a getInstanceData to abstract away workflow choices around targetObject/contentObject ?
  targetObject: number | null;
  contentObject: number | null;
  targetParent: number;
  title: string;
}

export interface PublicationDefaults {
  start?: Temporal.Instant;
  end?: Temporal.Instant;
}

export interface FSObjectPolicy {
  /** Get default publication settings - mainly start & end publication date. Often overridden for news/events applications */
  getPublicationDefaults?(context: FSObjectPolicyBaseContext): MaybePromise<PublicationDefaults | null>;
  /** Calculate fallback meta (SEO) title for an object if not explicitly set. Used for display in editor */
  getFallbackMetaTitle?(context: FSObjectPolicyBaseContext): MaybePromise<string | null>;
}

/** Context in which a report is generated */
export interface ReportContext {
  /** Language code for user-visible texts in the report (eg column titles) */
  langCode: string;
}

/** Signature for the onGenerate function of a report with outputFormat application/x-webhare-spreadsheet
 * @typeParam Params - Initial parameters passed when the report was requested
 * @typeParam Settings - Settings returned by the report's configScreen (an empty object if there is no configScreen)
 */
export type SpreadsheetReportGeneratorFunction<Params extends object = Record<string, unknown>, Settings extends object = Record<string, unknown>> =
  (params: Params, settings: Settings, context: ReportContext) => Promise<SpreadsheetData | WorkbookData>;
