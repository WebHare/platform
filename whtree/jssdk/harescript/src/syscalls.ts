import { backendConfig } from "@webhare/services/src/config.ts";
import * as vm from 'node:vm';
import { readFileSync } from "node:fs";
import { defaultDateTime, formatISO8601Date, localizeDate, maxDateTimeTotalMsecs } from "@webhare/hscompat/src/datetime";
import type { HareScriptVM } from "./wasm-hsvm";
import { popWork, stashWork } from "@webhare/whdb/src/impl";
import { cbDoFinishWork } from "@mod-system/js/internal/whdb/wasm_pgsqlprovider";
import { throwError } from "@webhare/std";
import { updateAuditContext } from "@webhare/auth";
import { toAuthAuditContext, type HarescriptJSCallContext } from "@webhare/hscompat/src/context";
import * as services from "@webhare/services";
import { importJSFunction } from "@webhare/services";
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

/* Source:
  curl https://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt | cut -d'|' -f3|sort|grep '^..$'|jq -c -R -s 'split("\n")[:-1]'
*/
const languagecodes = ["aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az", "ba", "be", "bg", "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy", "da", "de", "dv", "dz", "ee", "el", "en", "eo", "es", "et", "eu", "fa", "ff", "fi", "fj", "fo", "fr", "fy", "ga", "gd", "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz", "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu", "ja", "jv", "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky", "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv", "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my", "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny", "oc", "oj", "om", "or", "os", "pa", "pi", "pl", "ps", "pt", "qu", "rm", "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw", "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty", "ug", "uk", "ur", "uz", "ve", "vi", "vo", "wa", "wo", "xh", "yi", "yo", "za", "zh", "zu"];

export function getLanguageList(hsvm: HareScriptVM, { locales }: { locales: string[] }): Array<Record<string, string>> {
  const regionmaps = locales.map(lang => ({ lang, names: new Intl.DisplayNames(lang, { type: "language" }) }));
  return languagecodes.map(code => ({
    code: code,
    ...Object.fromEntries(regionmaps.map(_ => [_.lang, _.names.of(code)]))
  })).filter(_ => Object.values(_).some(v => v !== undefined));
}

export async function importDescribe(hsvm: HareScriptVM, { name }: { name: string }) {
  return (await hsvm.importedLibs.load(name)).describe();
}

export function importCall(hsvm: HareScriptVM, { name, lib, args }: { lib: string; name: string; args: unknown[] }) {
  const loaded = hsvm.importedLibs.getIfExists(lib) ?? throwError(`Library '${lib}' was not described yet`);
  return loaded.call(name, args);
}

export async function jsCall(hsvm: HareScriptVM, calljs: { lib: string; name: string; args: unknown[]; hscontext: HarescriptJSCallContext }) {
  const func = await importJSFunction<(...args: unknown[]) => unknown>(`${calljs.lib}#${calljs.name}`);
  if (calljs.hscontext.auth)
    updateAuditContext(toAuthAuditContext(calljs.hscontext.auth));
  return await func(...calljs.args);
}

export function startSeparatePrimary() {
  stashWork();
}
export function stopSeparatePrimary() {
  // Restore the stashed work, not waiting for the old connection to close
  popWork()?.then(() => { }, () => { });
}
