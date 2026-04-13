import { backendConfig } from "@webhare/services/src/config.ts";
import * as vm from 'node:vm';
import { readFileSync } from "node:fs";
import { defaultDateTime, formatISO8601Date, localizeDate, maxDateTimeTotalMsecs } from "@webhare/hscompat/src/datetime";
import type { HareScriptVM } from "./wasm-hsvm";
import { popWork, stashWork } from "@webhare/whdb/src/impl";
import { cbDoFinishWork } from "@mod-system/js/internal/whdb/wasm_pgsqlprovider";
import { stdTypeOf, throwError, toCamelCase, toSnakeCase } from "@webhare/std";
import { updateAuditContext } from "@webhare/auth";
import { toAuthAuditContext, type HarescriptJSCallContext } from "@webhare/hscompat/src/context";
import * as services from "@webhare/services";
import { importJSFunction } from "@webhare/services";
import type { CallJSOptions } from "@mod-platform/js/nodeservices/calljs";
import { getWHType } from "@webhare/std/src/quacks";
import { runReplacerRecursive } from "@mod-platform/js/nodeservices/nodeipchelper";
import { WebHareMemoryBlob } from "@webhare/services/src/webhareblob";
import { Marshaller } from "@webhare/hscompat/src/hson";
export { fulfillResurrectedPromise } from "./wasm-resurrection";

/* Syscalls are simple APIs for HareScript to reach into JS-native functionality that would otherwise be supplied by
   the C++ baselibs, eg openssl crypto. These APIs are generally pure and JSON based for ease of implementation and
   is used for initial API implementation. Once a syscall is too slow or inefficient, it should use the faster
   externalfunction/dllinterface APIs */

// Used by wasm.whlib to detect the WASM environment (the C++ EM_Syscall implementation would always return null)
export function init() {
  return { iswasm: true };
}

export async function lockMutex(hsvm: HareScriptVM, params: { mutexname: string; wait_until: Date }) {
  if (hsvm.mutexes.some(_ => _?.name === params.mutexname)) //JS is allowed to overlap mutexes in a context due to its async nature, but HS wasn't designed to support it so block it
    throw new Error(`Mutex '${params.mutexname}' has already been locked by this Harescript VM`);

  const mutex = await services.lockMutex(params.mutexname, { timeout: params.wait_until, __skipNameCheck: true });
  if (!mutex)
    return { status: "timeout" };

  hsvm.mutexes.push(mutex);
  return { status: "ok", mutex: hsvm.mutexes.length };
}

export async function unlockMutex(hsvm: HareScriptVM, params: { mutexid: number }) {
  hsvm.mutexes[params.mutexid - 1]?.release();
  hsvm.mutexes[params.mutexid - 1] = null;
  return null;
}

export async function hasMutex(_hsvm: HareScriptVM, params: { mutexname: string }) {
  return services.hasMutex(params.mutexname);
}

export function webHareConfig() {
  return {
    servertype: backendConfig.dtapstage,
    servername: backendConfig.serverName,
    primaryinterfaceurl: backendConfig.backendURL,
    __eventmasks: [
      "system:registry.system.global",
      "system:whfs.sitemeta.16" //site 16 (WebHare backend) tells us where the primaryinterfaceurl is
    ]
  };
}

export function finishWork(hsvm: HareScriptVM, { commit }: { commit: boolean }): Promise<unknown> {
  return cbDoFinishWork(hsvm, commit);
}

/** Run JavaScript code directly (no TypeScript!) */
export function executeInline(hsvm: HareScriptVM, { func, param }: { func: string; param?: unknown }): Promise<unknown> {
  const compileOptions = {
    contextExtensions: [{ require }]
  };

  /* When the keyword "await" is present in the function code, it needs to be run in an async function. For false
     positives, this might result in a somewhat slower execution, but no correctness problems.
  */
  if (func.indexOf("await") !== -1) {
    if (param !== undefined) {
      const tocall = vm.compileFunction(`async function wrapper(vm, param) { ${func} }; return wrapper($vm, $param);`, ["$vm", "$param"], compileOptions);
      return tocall(hsvm, param);
    } else {
      const tocall = vm.compileFunction(`async function wrapper(vm) { ${func} }; return wrapper($vm);`, ["$vm"], compileOptions);
      return tocall(hsvm);
    }
  } else {
    if (param !== undefined) {
      const tocall = vm.compileFunction(func, ["vm", "param"], compileOptions);
      return tocall(hsvm, param);
    } else {
      const tocall = vm.compileFunction(func, ["vm"], compileOptions);
      return tocall(hsvm);
    }
  }
}

export function formatISO8601DateTime(_hsvm: HareScriptVM, params: {
  date: Date; options: {
    dateformat: "year" | "month" | "day" | "empty";
    timeformat: "hours" | "minutes" | "seconds" | "milliseconds" | "empty";
    timezone: string;
    extended: boolean;
  };
}) {
  if (params.date.getTime() <= defaultDateTime.getTime() || params.date.getTime() >= maxDateTimeTotalMsecs)
    return { result: "" };

  return {
    result: formatISO8601Date(params.date, {
      dateFormat: params.options.dateformat,
      timeFormat: params.options.timeformat,
      timeZone: params.options.timezone,
      extended: params.options.extended
    })
  };
}

export function localizeDateTime(_hsvm: HareScriptVM, params: {
  formatstring: string;
  date: Date;
  locale: string;
  timezone: string;
}) {
  if (params.date.getTime() <= defaultDateTime.getTime() || params.date.getTime() >= maxDateTimeTotalMsecs)
    return { result: "" };

  return {
    result: localizeDate(params.formatstring, params.date, params.locale, params.timezone || "UTC")
  };
}

//TODO cache the country mapping - allow users to get a subset?
let countrycodes: string[] | undefined;
export function getCountryList(hsvm: HareScriptVM, { locales }: { locales: string[] }): Array<Record<string, string>> {
  countrycodes ||= [...Object.keys(JSON.parse(readFileSync(backendConfig.installationRoot + "node_modules/country-list-js/data/iso_alpha_3.json", "utf8")))].sort();
  const regionmaps = locales.map(lang => ({ lang, names: new Intl.DisplayNames(lang, { type: "region" }) }));
  return countrycodes.map(code => ({
    code: code,
    ...Object.fromEntries(regionmaps.map(_ => [_.lang, _.names.of(code)]))
  }));
}

export async function importDescribe(hsvm: HareScriptVM, { name }: { name: string }) {
  return (await hsvm.importedLibs.load(name)).describe();
}

export function importCall(hsvm: HareScriptVM, { name, lib, args }: { lib: string; name: string; args: unknown[] }) {
  const loaded = hsvm.importedLibs.getIfExists(lib) ?? throwError(`Library '${lib}' was not described yet`);
  return loaded.call(name, args);
}

//Find any Files/Blobs and serialize them
async function fixBlobs(hsvm: HareScriptVM, val: unknown) {
  const waiters = new Array<Promise<void>>;
  const retval = runReplacerRecursive(val, (orgValue) => {
    const stdType = stdTypeOf(orgValue);

    if (["File", "Blob"].includes(stdTypeOf(orgValue)) && !getWHType(orgValue)) { //Plain blobs, not WebHareMemoryBlob or WebHareDiskBlob
      //We may eventually build a WASM C++ BlobBase around Blobs so the HSVM can directly use them.
      //Until then, serialize them to a WebHareMemoryBlob here so APIs like generateXLSX are at least somewhat reachable
      const newVal = hsvm.allocateVariable();

      const newWaiter = Promise.withResolvers<void>();
      waiters.push(newWaiter.promise);

      WebHareMemoryBlob.fromBlob(orgValue as Blob).
        then(blob => {
          newVal.setBlob(blob);
          newWaiter.resolve();
        }).catch(e => newWaiter.reject(e)); //transfer the error to the main promise

      return newVal; //Replace the object with a HSVMVar
    }

    if (orgValue instanceof Uint8Array || orgValue instanceof ArrayBuffer || orgValue instanceof Buffer || orgValue[Marshaller])
      return orgValue;

    //keep recursing into plain objects but leave recognized stuff alone
    return stdType === "object" ? undefined : orgValue;
  });

  await Promise.all(waiters); //fills all the vars we created with actual blobs
  return retval;
}

export async function jsCall(hsvm: HareScriptVM, calljs: { lib: string; name: string; args: unknown[]; hscontext: HarescriptJSCallContext; options: CallJSOptions }) {
  const func = await importJSFunction<(...args: unknown[]) => unknown>(`${calljs.lib}#${calljs.name}`);
  if (calljs.hscontext.auth)
    updateAuditContext(toAuthAuditContext(calljs.hscontext.auth));

  const retval = await func(...calljs.options.camelcase ? toCamelCase(calljs.args) : calljs.args);
  const fixedRetval = await fixBlobs(hsvm, retval); //load blobs into memory as setJSValue is sync
  return calljs.options.camelcase && typeof fixedRetval === 'object' ? toSnakeCase(fixedRetval) : fixedRetval;
}

export function startSeparatePrimary() {
  stashWork();
}
export function stopSeparatePrimary() {
  // Restore the stashed work, not waiting for the old connection to close
  popWork()?.then(() => { }, () => { });
}
