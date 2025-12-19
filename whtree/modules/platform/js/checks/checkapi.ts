import { type ToSnakeCase, toSnakeCase } from "@webhare/hscompat";
import { importJSFunction, resolveResource } from "@webhare/services";
import { type ModDefYML, getAllModuleYAMLs } from '@webhare/services/src/moduledefparser';

type CheckScopes = "gdpr" | "policy";

export type CheckResult = {
  /** Check type, a modulescoped:name */
  type: string;
  /** Check specific metadata */
  metadata?: object | null;
  /** Is this a critical message? */
  isCritical?: boolean;
  jumpTo?: object | null;
  scopes?: CheckScopes[];
} & ({
  /** Textual message */
  messageText: string;
} | {
  /** TID based message */
  messageTid: {
    tid: string;
    params?: string[];
  };
});

export type CheckFunction = () => CheckResult[] | Promise<CheckResult[]>;

type HS_CheckResult = ToSnakeCase<CheckResult>;

export async function runIntervalChecks(): Promise<HS_CheckResult[]> {
  //Gather modules
  const checks: ModDefYML["selfChecks"] = [];
  for (const modyml of await getAllModuleYAMLs())
    for (const check of modyml.selfChecks || [])
      checks.push({ checker: resolveResource(modyml.baseResourcePath, check.checker) });

  const results: Array<Promise<CheckResult[]>> = checks.map(check =>
    importJSFunction<CheckFunction>(check.checker).then(func => func()).catch(error => [
      {
        type: "platform:checkfailed",
        metadata: { check: check.checker },
        messageText: `Checker ${check.checker} failed: ${error.message}`,
        jumpTo: null,
        scopes: []
      }
    ]
    ));

  return (await Promise.all(results)).flat().map(toSnakeCase<CheckResult>);
}
