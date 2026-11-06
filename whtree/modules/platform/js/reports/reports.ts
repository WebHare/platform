import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { ReportDescriptor } from "@mod-system/js/internal/generation/gen_extract_reports";
import type { SpreadsheetData, WorkbookData } from "@webhare/office-formats";
import type { ReportContext, SpreadsheetReportGeneratorFunction } from "@webhare/backend-integration";
import { importJSFunction } from "@webhare/services";

/** Look up a report declaration
 * @param name - Full module:report name
 * @returns The report descriptor. Throws if the report does not exist
 */
export function getReport(name: string): ReportDescriptor {
  const report = getExtractedConfig("reports").reports.find(_ => _.name === name);
  if (!report)
    throw new Error(`No such report '${name}'`);
  return report;
}

/** Generate a report
 * @param name - Full module:report name
 * @param params - Initial parameters
 * @param settings - Settings returned by the report's configScreen
 * @param context - Context for the generation
 */
export async function generateReport(name: string, params: Record<string, unknown> | null, settings: Record<string, unknown> | null, context: ReportContext): Promise<SpreadsheetData | WorkbookData> {
  const report = getReport(name);
  const generator = await importJSFunction<SpreadsheetReportGeneratorFunction>(report.onGenerate);
  return await generator(params || {}, settings || {}, context);
}
