/* This is the language file loader */
"use strict";

import type * as esbuild from 'esbuild';
import type { CaptureLoadPlugin } from "@mod-platform/js/assetpacks/compiletask";
import * as fs from "node:fs";
import { emplace } from '@webhare/std';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getCompiledLanguageFile } from '@mod-tollium/js/internal/gettid_nodehooks';
import type { LanguageText } from '@webhare/gettid/src/types';

type ModuleTids = { [tid: string]: string | ModuleTids };
type ModuleTexts = { [language: string]: ModuleTids };
type TextsMap = Map<string, ModuleTexts>;

async function runLangLoader(languages: string[], resourcepath: string, source: string) {
  const warnings: string[] = [], dependencies: string[] = [];
  try {
    const langfile = JSON.parse(source) as { imports?: { [module: string]: string[] } };

    const alltexts: TextsMap = new Map();
    const filelist: string[] = [];

    if (langfile.imports) {
      for (const module of Object.keys(langfile.imports)) {
        const gids = Array.from(langfile.imports[module]);

        const moduletexts = emplace(alltexts, module, { insert: () => ({}) });

        // Find the requested module's language file
        for (const lang of languages) {
          if (!(lang in moduletexts))
            moduletexts[lang] = {};

          const nodes = await readLanguageFile(module, lang, filelist);
          parseLanguageFile(moduletexts[lang], gids, nodes);
        }
      }
    }

    let output = `// Auto-generated language file from ${resourcepath}\n`;
    output += generateTexts(alltexts);

    // Mark all cached files as dependency, so the language file will be regenerated if one of these changes
    filelist.forEach(result => {
      output += `// Adding dependency: ${result}\n`;
      dependencies.push(result);
    });

    // We're done
    return {
      output,
      warnings,
      dependencies,
      errors: []
    };
  } catch (e) {
    console.error('caught language parser error:', e);

    return {
      output: '/*\n' + JSON.stringify(e) + '\n*/\n',
      warnings,
      dependencies,
      errors: [String(e)]
    };
  }
}

export function generateTexts(alltexts: TextsMap) {
  // Require the general gettid library to register the language texts
  let output = 'var registerTexts = require("@webhare/gettid/src/internal").registerTexts;\n';
  // Register the language texts for each module
  alltexts.forEach((texts, module) => {
    for (const lang of Object.keys(texts)) {
      const encoded = JSON.stringify(texts[lang]);
      output += `registerTexts("${module}","${lang}",${encoded});\n`;
    }
  });
  return output;
}


export async function readLanguageFile(module: string, language: string, filelist: string[]) {
  const languages = [language];

  const files = [];
  for (let i = 0; i < languages.length; ++i) {
    // Read the language file
    // TODO send the GIDs we need to harescript and reduce the amount of data we need to IPC/process
    const langfile = await readLanguageFileInternal(module, languages[i], filelist);

    // Add the fallback language to the list of languages, if it's not already present
    if (langfile.filedata.fallbacklanguage && !languages.includes(langfile.filedata.fallbacklanguage))
      languages.push(langfile.filedata.fallbacklanguage);
    // Add the parsed language file to the front of the file list
    files.push(langfile);
  }

  // Only one language, return its nodes directly
  if (files.length === 1)
    return files[0].filedata.texts;

  // addLanguageTexts overwrite existing nodes, so we follow the fallbacklanguage chain backwards, which keeps the fallback
  // nodes that are not overwritten by a more desired language  (TODO move fallback language resolution to JS for smaller bundles)
  const texts = new Map<string, string>();
  for (const langfile of files) {
    for (const entry of langfile.filedata.texts)
      if (!texts.has(entry.tid))
        texts.set(entry.tid, entry.text);
  }

  // reflatten the map..
  const final: Array<{ tid: string; text: string }> = [];
  for (const text of texts.entries())
    final.push({ tid: text[0], text: text[1] });

  return final;
}

async function getLanguageXML(modulename: string, language: string) {
  const texts = new Map<string, LanguageText>;
  const output = getCompiledLanguageFile(modulename, language, texts);
  const outputTexts = new Array<{ tid: string; text: string }>();

  for (const [tid, text] of output.texts.entries())
    outputTexts.push({ tid, text: text as string });

  return {
    filepath: modulename + "|" + language,
    filedata: {
      diskpath: output.resource,
      fallbacklanguage: output.fallbackLanguage,
      texts: outputTexts
    }
  };
}


export async function readLanguageFileInternal(modulename: string, language: string, filelist: string[]) {
  const response = await getLanguageXML(modulename, language);
  filelist.push(response.filedata.diskpath);
  return response;
}

export function parseLanguageFile(moduletexts: ModuleTids, gids: string[], data: Array<{ tid: string; text: string }>) {
  for (const tid of data) {
    if (!gids.some(gid => tid.tid.startsWith(gid + '.'))) //filter tids out of our scope
      continue;

    let storeptr = moduletexts;

    //split on '.', build subgroups. eg gid a.b.c becomes { a: { b: { c: ... }}}
    const tidparts = tid.tid.split(".");
    for (let i = 0; i < tidparts.length - 1; ++i) {
      if (!storeptr[tidparts[i]])
        storeptr[tidparts[i]] = {};
      else if (typeof storeptr[tidparts[i]] === "string")
        storeptr[tidparts[i]] = { "": storeptr[tidparts[i]] };
      storeptr = storeptr[tidparts[i]] as ModuleTids;
    }
    if (typeof storeptr[tidparts[tidparts.length - 1]] === "object")
      (storeptr[tidparts[tidparts.length - 1]] as ModuleTids)[""] = tid.text;
    else
      storeptr[tidparts[tidparts.length - 1]] = tid.text;
  }
}

export function buildLangLoaderPlugin(languages: string[], captureplugin: CaptureLoadPlugin) {
  const runInAsyncScope = AsyncLocalStorage.snapshot();
  return {
    name: "languagefile",
    setup: (build: esbuild.PluginBuild) => {
      build.onLoad({ filter: /.\.lang\.json$/, namespace: "file" }, a => runInAsyncScope(async (args) => {
        const source = await fs.promises.readFile(args.path, 'utf8');
        const result = await runLangLoader(languages, args.path, source);

        result.dependencies.forEach(dep => captureplugin.loadcache.add(dep));

        return {
          contents: result.output,
          warnings: result.warnings.map(_ => ({ text: _ })),
          errors: result.errors.map(_ => ({ text: _ })),
          watchFiles: result.dependencies //NOTE doesn't get used until we get rid of captureplugin
        };
      }, a));
    }
  };
}
