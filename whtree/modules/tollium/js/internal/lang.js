/* This is the language file loader
*/
"use strict";

let bridge = require('@mod-system/js/wh/bridge');
let fs = require("fs");

function encodeJSCompatibleJSON(s)
{
  return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

module.exports = function(source)
{
  let callback = this.async();
  if (!callback)
    return "";

  this.cacheable(true);
  let config = JSON.parse(this.query.substr(1));
  runLangLoader(config, this.resourcePath, source).then(res =>
    {
      res.warnings.forEach(w => this.emitWarning(w));
      res.errors.forEach(w => this.emitError(w));
      res.dependencies.forEach(d => this.addDependency(d));
      callback(null, res.output)
    });
};

async function runLangLoader(config, resourcepath, source)
{
  let warnings = [], dependencies = [];

  try
  {
    // Read installed modules and determine current module
    let modules = new Map();
    let curmodule = "";
    config.modules.forEach(module =>
    {
      modules.set(module.name, module.root);
      if (resourcepath.startsWith(module.root))
        curmodule = module.name;
    });
    if (!curmodule)
      warnings.push("Could not determine current module");

    // this.inputValue[0] is the parsed JSON object from the 'json' loader
    let langfile = JSON.parse(source); //this.inputValue[0];

    let alltexts = new Map();
    let filelist = [];

    if ("imports" in langfile)
    {
      for (let module of Object.keys(langfile.imports))
      {
        let gids = Array.from(langfile.imports[module]);

        // Use current module if not specified
        if (module === "")
          module = curmodule;

        if (!alltexts.has(module))
          alltexts.set(module, {});

        // Find the requested module's language file
        for(let lang of config.languages)
        {
          if (!(lang in alltexts.get(module)))
            alltexts.get(module)[lang] = {};

          let nodes = await readLanguageFile(module, lang, filelist);
          parseLanguageFile(alltexts.get(module)[lang], gids, nodes);
        }
      }
    }

    let output = `// Auto-generated language file from ${resourcepath}\n`;
    output += generateTexts(alltexts);

    // Mark all cached files as dependency, so the language file will be regenerated if one of these changes
    filelist.forEach(result =>
    {
      output += `// Adding dependency: ${result}\n`;
      dependencies.push(result);
    });

    // We're done
    return { output
           , warnings
           , dependencies
           , errors: []
           };
  }
  catch(e)
  {
    console.log('caught language parser error:',e);

    return { output: '/*\n' + JSON.stringify(e) + '\n*/\n'
           , warnings
           , dependencies
           , errors: [e.toString()]
           };
  }
}

function generateTexts(alltexts)
{
  // Require the general gettid library to register the language texts
  var output = 'var registerTexts = require("@mod-tollium/js/gettid").registerTexts;\n';
  // Register the language texts for each module
  alltexts.forEach((texts, module) =>
  {
    for (let lang of Object.keys(texts))
    {
      let encoded = encodeJSCompatibleJSON(texts[lang]);
      output += `registerTexts("${module}","${lang}",${encoded});\n`;
    }
  });
  return output;
}


async function readLanguageFile(module, language, filelist)
{
  let languages = [ language ];

  let files = [];
  for (let i = 0; i < languages.length; ++i)
  {
    // Read the language file
    // TODO send the GIDs we need to harescript and reduce the amount of data we need to IPC/process
    let langfile = await readLanguageFileInternal(module, languages[i], filelist);

    // Add the fallback language to the list of languages, if it's not already present
    if (langfile.filedata.fallbacklanguage && !languages.includes(langfile.filedata.fallbacklanguage))
      languages.push(langfile.filedata.fallbacklanguage);
    // Add the parsed language file to the front of the file list
    files.push(langfile);
  }

  // Only one language, return its nodes directly
  if (files.length == 1)
    return files[0].filedata.texts;

  // addLanguageTexts overwrite existing nodes, so we follow the fallbacklanguage chain backwards, which keeps the fallback
  // nodes that are not overwritten by a more desired language  (TODO move fallback language resolution to JS for smaller bundles)
  let texts = new Map;
  for (let langfile of files)
  {
    for (let entry of langfile.filedata.texts)
      if(!texts.has(entry.tid))
        texts.set(entry.tid, entry.text);
  }

  // reflatten the map..
  let final = [];
  for(let text of texts.entries())
    final.push({tid:text[0], text:text[1]});

  return final;
}

async function getLanguageXML(modulenam, language)
{
  await bridge.onlinepromise;
  let response = await bridge.invoke("mod::publisher/lib/internal/webdesign/rpcloader.whlib", "GetLanguageFile", modulenam, language);
  return { filepath: modulenam + "|" + language, filedata: response };
}


async function readLanguageFileInternal(modulename, language, filelist)
{
  await bridge.onlinepromise;
  let response = await getLanguageXML(modulename, language);
  filelist.push(response.filedata.diskpath);
  return response;
}

function parseLanguageFile(moduletexts, gids, data)
{
  for(let tid of data)
  {
    if(!gids.some(gid => tid.tid.startsWith(gid + '.'))) //filter tids out of our scope
      continue;

    let storeptr = moduletexts;

    //split on '.', build subgroups. eg gid a.b.c becomes { a: { b: { c: ... }}}
    let tidparts = tid.tid.split(".");
    for(let i = 0; i < tidparts.length - 1; ++i)
    {
      if(!storeptr[tidparts[i]])
        storeptr[tidparts[i]] = {};
      else if (typeof storeptr[tidparts[i]] == "string")
        storeptr[tidparts[i]] = { "": storeptr[tidparts[i]] };
      storeptr = storeptr[tidparts[i]];
    }
    if (typeof storeptr[tidparts[tidparts.length-1]] == "object")
      storeptr[tidparts[tidparts.length-1]][""] = tid.text;
    else
      storeptr[tidparts[tidparts.length-1]] = tid.text;
  }
}

function addLanguageTexts(readContext, writeContext)
{
  for (let key of Object.keys(readContext))
  {
    let value = readContext[key];

    if (typeof value == "object")
    {
      if (!(key in writeContext))
        writeContext[key] = {};
      addLanguageTexts(value, writeContext[key]);
    }
    else
      writeContext[key] = value;
  }
}

//export for tests
module.exports.readLanguageFile = readLanguageFile;
module.exports.parseLanguageFile = parseLanguageFile;
module.exports.generateTexts = generateTexts;

module.exports.getESBuildPlugin = (config, captureplugin) => ({
    name: "languagefile",
    setup: function (build)
    {
      build.onLoad({ filter: /.\.lang\.json$/, namespace: "file" }, async (args) =>
      {
        let source = await fs.promises.readFile(args.path);
        let result = await runLangLoader(config, args.path, source, null);

        result.dependencies.forEach(dep => captureplugin.loadcache.add(dep));

        return { contents: result.output
               , warnings: result.warnings.map(_ => ({text:_}))
               , errors: result.errors.map(_ => ({text:_}))
               , watchFiles: result.dependencies //NOTE doesn't get used until we get rid of captureplugin
               };
      });
    },
});

