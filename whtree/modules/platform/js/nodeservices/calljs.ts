/* The invoke service implements CallJS if invoked from native HareScript */

import { RestAPIWorkerPool } from "@mod-system/js/internal/openapi/workerpool";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { debugFlags } from "@webhare/env";
import { toAuthAuditContext, type HarescriptJSCallContext } from "@webhare/hscompat/context";
import { BackendServiceConnection, importJSFunction } from "@webhare/services";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { createReturnValueWithTransferList } from "@webhare/services/src/localservice";
import { omit, pick, toCamelCase, typedEntries, typedFromEntries, type ToCamelCase, type TypedEntries, type TypedFromEntries } from "@webhare/std";
import * as v8 from "node:v8";
import { decodeFromMessageTransfer, encodeforMessageTransfer } from "./nodeipchelper";


const pickedV8HeapStats = [
  "used_heap_size",
  "peak_malloced_memory",
  "external_memory",
] as const;

type SelectedHeapStats = ToCamelCase<Pick<ReturnType<typeof v8.getHeapStatistics>, typeof pickedV8HeapStats[number]>>;

let prevMemoryUsage: SelectedHeapStats | undefined = undefined;

/** Map the keys and values of an object into another object */
export function mapObject<T extends object, R extends [string, unknown]>(obj: T, mapFn: ([key, value]: TypedEntries<T>) => R): TypedFromEntries<R> {
  return typedFromEntries(typedEntries(obj).map(mapFn));
}

/** Filters the keys of an object based on a predicate function. When the predicate function is a type guard, exactly filters
 * the object, otherwise a Partial is applied on the object
 */
export function filterObject<T extends object, R extends keyof T & string>(obj: T, filterFunc: (data: TypedEntries<T>) => data is TypedEntries<T> & [R, unknown]): Pick<T, R>;
export function filterObject<T extends object>(obj: T, filterFunc: (data: TypedEntries<T>) => boolean): Partial<T>;

export function filterObject<T extends object>(obj: T, filterFunc: (data: TypedEntries<T>) => boolean): Partial<T> {
  return pick(obj, typedEntries(obj).filter(filterFunc).map(([key, value]) => key));
}


export async function workerHandleCall({ lib, name, stringifiedArgs, hscontext }: { lib: string; name: string; stringifiedArgs: string; hscontext: HarescriptJSCallContext }) {
  await using context = new CodeContext(`CallJSService ${lib}#${name}`, { lib, name });
  if (hscontext.auth)
    context.setScopedResource("platform:authcontext", toAuthAuditContext(hscontext.auth));

  const args = decodeFromMessageTransfer(stringifiedArgs) as unknown[];

  let retval;
  if (debugFlags.calljs) {
    // @threadCpuUsage does not exist in the type definitions for NodeJS 24.2 yet. Check again in WH 5.9.
    type MyProcess = typeof process extends { threadCpuUsage: unknown } ?
      typeof process :
      typeof process & { threadCpuUsage: (usage?: NodeJS.CpuUsage) => NodeJS.CpuUsage };

    const start = process.hrtime.bigint();
    const cpuUsageStart = (process as MyProcess).threadCpuUsage() as NodeJS.CpuUsage;

    const func = await importJSFunction<(...args: unknown[]) => unknown>(`${lib}#${name}`);

    const afterImport = process.hrtime.bigint();

    retval = await context.run(() => func(...args));

    const durationMs = Number(process.hrtime.bigint() - afterImport) / 1_000_000; // hrtime in in ns, convert to ms
    const importDurationMs = Number(afterImport - start) / 1_000_000; // hrtime in in ns, convert to ms
    const cpuUsage = (process as MyProcess).threadCpuUsage(cpuUsageStart) as NodeJS.CpuUsage;
    const memUsage: SelectedHeapStats = toCamelCase(pick(v8.getHeapStatistics(), pickedV8HeapStats));
    const memUsageDelta = prevMemoryUsage && filterObject(mapObject(prevMemoryUsage, ([key, value]) => [key, memUsage[key] - value]), ([key, value]) => value !== 0);
    prevMemoryUsage = memUsage;

    const encodedRetval = await encodeforMessageTransfer(retval);
    return createReturnValueWithTransferList({
      returnValue: encodedRetval.value,
      cpuUsage,
      memUsage,
      memUsageDelta,
      durationMs,
      importDurationMs,
      workerGroupId: bridge.getGroupId(),
    }, encodedRetval.transferList);
  } else {
    const func = await importJSFunction<(...args: unknown[]) => unknown>(`${lib}#${name}`);
    retval = await context.run(() => func(...args));
    const encodedRetval = await encodeforMessageTransfer(retval);
    return createReturnValueWithTransferList({
      returnValue: encodedRetval.value,
      workerGroupId: bridge.getGroupId(),
    }, encodedRetval.transferList);
  }
}

let workerPool: RestAPIWorkerPool | undefined = undefined;
class CallJSService extends BackendServiceConnection {
  async invoke(lib: string, name: string, args: unknown[], hscontext: HarescriptJSCallContext) {
    workerPool ??= new RestAPIWorkerPool("CallJSService", 5, 1000);
    return await workerPool.runInWorker(async (worker) => {
      const encodedArgs = await encodeforMessageTransfer(args);

      const retval: Awaited<ReturnType<typeof workerHandleCall>>["value"] = await worker.callRemote({
        ref: "@mod-platform/js/nodeservices/calljs.ts#workerHandleCall",
        transferList: encodedArgs.transferList,
      }, { lib, name, stringifiedArgs: encodedArgs.value, hscontext });
      if ("durationMs" in retval) {
        // If debugFlags.calljs is enabled, we log the call details
        bridge.logDebug("platform:calljsservice", {
          func: `${lib}#${name}`,
          ...omit(retval, ["returnValue"]),
        });
      }

      return decodeFromMessageTransfer(retval.returnValue);
    });
  }
}

export async function getCallJSService(servicename: string) {
  return new CallJSService;
}
