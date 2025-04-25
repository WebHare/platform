import { backendConfig, type CheckResult } from "@webhare/services";
import { appendToArray } from "@webhare/std";
import { checkNodeModulesInModule } from "@mod-platform/js/devsupport/npm";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";

function groupModuleIssues(module: string, npmErrors: Array<{ error: string }>): CheckResult[] {
  if (!npmErrors.length)
    return [];

  return [
    {
      type: "devkit:npm",
      metadata: { module: module },
      messageText: `Module ${module} has ${npmErrors.length} package issue${npmErrors.length > 1 ? 's' : ''}: ${npmErrors.slice(0, 3).map(_ => _.error).join(', ')}${npmErrors.length > 3 ? ` and ${npmErrors.length - 3} more` : ''}`,
    }
  ];
}

export async function checkModules(): Promise<CheckResult[]> {
  const issues = groupModuleIssues('platform', await checkNodeModulesInModule(backendConfig.installationRoot));
  for (const [modulename, config] of Object.entries(backendConfig.module)) {
    if (!whconstant_builtinmodules.includes(modulename)) {
      appendToArray(issues, groupModuleIssues(modulename, await checkNodeModulesInModule(config.root)));
    }
  }
  return issues;
}
