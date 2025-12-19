import { listSchemas } from '@webhare/wrd';
import { run } from "@webhare/cli";
import { checkWRDSchema, type WRDIssue } from '@webhare/wrd/src/check';
import { loadlib } from '@webhare/harescript';
import type { CheckResult } from '@webhare/services';
import { toSnakeCase } from '@webhare/std';
import { isValidWRDSchemaTag } from '@webhare/wrd/src/wrdsupport';

const issues: CheckResult[] = [];
let verbose = false;

async function checkWRD() {
  const schemas = await listSchemas();
  for (const schema of schemas.toSorted((a, b) => a.tag.localeCompare(b.tag))) {
    const localIssues: WRDIssue[] = [];
    if (verbose)
      console.log(`Checking WRD schema '${schema.tag}'...`);

    if (!isValidWRDSchemaTag(schema.tag)) {
      localIssues.push({ message: `Schema tag '${schema.tag}' is not a valid WRD schema tag` });
      continue;
    }

    await checkWRDSchema(schema.tag, (issue: WRDIssue) => {
      localIssues.push(issue);
    });

    if (localIssues.length > 0) {
      const integrityIssue = {
        type: "platform:wrd.integrity",
        metadata: { schema: schema.tag },
        messageText: `Schema ${schema.tag} has ${localIssues.length} integrity issue${localIssues.length > 1 ? 's' : ''}: ${localIssues.slice(0, 3).map(_ => _.message).join(', ')}${localIssues.length > 3 ? ` and ${localIssues.length - 3} more` : ''}`,
      };
      issues.push(integrityIssue);
      if (verbose)
        console.log(integrityIssue.messageText);
    }
  }
}

run({
  flags: {
    "v,verbose": "Be verbose in output"
  },
  async main({ opts }) {
    verbose = opts.verbose;
    await checkWRD();
    await loadlib("mod::system/lib/checks.whlib").UpdateCheckStatus("platform:integritycheck", toSnakeCase(issues));
  }
});
