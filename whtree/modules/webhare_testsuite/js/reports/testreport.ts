import type { SpreadsheetData } from "@webhare/office-formats";
import type { ReportContext } from "@webhare/backend-integration";

/** Test report (declared as webhare_testsuite:testreport)
 * @param params - Initial parameters passed when the report was requested
 * @param settings - Settings returned by the config screen's Submit
 * @param context - Generation context
 */
export async function generateTestReport(params: { context: string }, settings: { extra: string }, context: ReportContext): Promise<SpreadsheetData> {
  return {
    title: "Test report",
    columns: [
      { name: "context", title: "Context", type: "string" },
      { name: "extra", title: "Extra", type: "string" },
      { name: "langcode", title: "Language", type: "string" }
    ],
    rows: [{ context: params.context, extra: settings.extra, langcode: context.langCode }]
  };
}

/** Test report without a config screen (declared as webhare_testsuite:testreport_noconfig)
 * @param params - Initial parameters passed when the report was requested
 */
export async function generateTestReportNoConfig(params: { context: string }): Promise<SpreadsheetData> {
  return {
    title: "Test report without config",
    columns: [{ name: "context", title: "Context", type: "string" }],
    rows: [{ context: params.context }]
  };
}
