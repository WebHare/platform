// @webhare/cli: Task that scans all schemas for WRD integrity issues and stores them for the dashboard checks

// For a quick check of all schemas use: `wh run mod::platform/scripts/tasks/integritycheck.ts --metadata-only`

import { listSchemas } from '@webhare/wrd';
import { runCli } from "@webhare/cli";
import { checkWRDSchema, type WRDIssue } from '@webhare/wrd/src/check';
import { loadlib } from '@webhare/harescript';
import type { CheckResult } from '@webhare/services';
import { toSnakeCase } from '@webhare/std';
import { isValidWRDSchemaTag } from '@webhare/wrd/src/wrdsupport';
import { isatty } from 'tty';

async function checkWRD(options?: { metadataOnly?: boolean; verbose?: boolean }): Promise<CheckResult[]> {
  const schemas = await listSchemas();
  const issues: CheckResult[] = [];
  for (const schema of schemas.toSorted((a, b) => a.tag.localeCompare(b.tag))) {
    const localIssues: WRDIssue[] = [];
    if (options?.verbose)
      console.log(`Checking WRD schema '${schema.tag}'...`);

    if (!isValidWRDSchemaTag(schema.tag)) {
      localIssues.push({ message: `Schema tag '${schema.tag}' is not a valid WRD schema tag` });
      continue;
    }

    await checkWRDSchema(schema.tag, (issue: WRDIssue) => {
      localIssues.push(issue);
    }, options);

    if (localIssues.length > 0) {
      const integrityIssue = {
        type: "platform:wrd.integrity",
        metadata: { schema: schema.tag },
        messageText: `Schema ${schema.tag} has ${localIssues.length} integrity issue${localIssues.length > 1 ? 's' : ''}: ${localIssues.slice(0, 3).map(_ => _.message).join(', ')}${localIssues.length > 3 ? ` and ${localIssues.length - 3} more` : ''}`,
      };
      issues.push(integrityIssue);
      if (options?.verbose)
        console.log(integrityIssue.messageText);
    }
  }

  return issues;
}

runCli({
  flags: {
    "v,verbose": { description: "Be verbose in output", default: isatty(1) },
    "metadata-only": { description: "Only check metadata, not actual entities", default: false }
  },
  async main({ opts }) {
    const issues = await checkWRD({ metadataOnly: opts.metadataOnly, verbose: opts.verbose });
    if (!opts.metadataOnly) //only store the issues if we didn't just do a partial check
      await loadlib("mod::system/lib/checks.whlib").UpdateCheckStatus("platform:integritycheck", toSnakeCase(issues));
  }
});
