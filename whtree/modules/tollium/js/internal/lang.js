/* This is the language file loader
*/
"use strict";

let fs = require("fs");
let path = require("path");
let sax = require("sax");


let testfsoverrides = {};

/*
let encoding = require("dompack/types/text");
*/
let encoding =
{ encodeTextNode: function(str)
  {
    return str.split('&').join('&amp;')
              .split('<').join('&lt;')
              .split('>').join('&gt;');
  }
, encodeValue:function (str)
  {
    return str.split('&').join('&amp;')
              .split('<').join('&lt;')
              .split('>').join('&gt;')
              .split('"').join('&quot;')
              .split("'").join('&apos;');
  }
, decodeValue:function(str)
  {
    return str.replace(/<br *\/?>/g, "\n")
              .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
              .replace(/&amp;/g, "&");
  }
, encodeJSCompatibleJSON:function(s)
  {
    return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
};

module.exports = function(source)
{
  let callback = this.async();
  if (!callback)
    return "";

  this.cacheable(true);
  runLangLoader(this, source).then(res => callback(null, res));
};

async function runLangLoader(context, source)
{
  try
  {
    let config = JSON.parse(context.query.substr(1));

    // Read installed modules and determine current module
    let modules = new Map();
    let curmodule = "";
    config.modules.forEach(module =>
    {
      modules.set(module.name, module.root);
      if (context.resourcePath.startsWith(module.root))
        curmodule = module.name;
    });
    if (!curmodule)
      context.emitWarning("Could not determine current module");

    // this.inputValue[0] is the parsed JSON object from the 'json' loader
    let langfile = JSON.parse(source); //this.inputValue[0];

    let alltexts = new Map();
    let filecache = new Map();

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
        config.languages.forEach(lang =>
        {
          if (!(lang in alltexts.get(module)))
            alltexts.get(module)[lang] = {};

          let nodes = readLanguageFile(modules.get(module), lang, filecache);
          parseLanguageFile(alltexts.get(module)[lang], gids, nodes);
        });
      }
    }

    let output = `// Auto-generated language file from ${context.resourcePath}\n`;
    output += generateTexts(alltexts);

    // Mark all cached files as dependency, so the language file will be regenerated if one of these changes
    filecache.forEach(result =>
    {
      output += `// Adding dependency: ${result.filepath}\n`;
      context.addDependency(result.filepath);
    });
    // Clear file cache for the next run (file contents may have changed by then)
    filecache.clear();

    // We're done
    return output;
  }
  catch(e)
  {
    console.log('caught runrpcloader error:',e);
    context.emitError(e);
    return '/*\n' + JSON.stringify(e) + '\n*/\n';
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
      let encoded = encoding.encodeJSCompatibleJSON(texts[lang]);
      output += `registerTexts("${module}","${lang}",${encoded});\n`;
    }
  });
  return output;
}


function readLanguageFile(basepath, language, filecache)
{
  let languages = [ language ];

  let files = [];
  for (let i = 0; i < languages.length; ++i)
  {
    // Read the language file
    let langfile = readLanguageFileInternal(basepath, languages[i], filecache);
    // Add the fallback language to the list of languages, if it's not already present
    if (langfile.fallbacklanguage && !languages.includes(langfile.fallbacklanguage))
      languages.push(langfile.fallbacklanguage);
    // Add the parsed language file to the front of the file list
    files.unshift(langfile);
  }
  // Only one language, return its nodes directly
  if (files.length == 1)
    return files[0].nodes;

  // addLanguageTexts overwrite existing nodes, so we follow the fallbacklanguage chain backwards, which keeps the fallback
  // nodes that are not overwritten by a more desired language
  let nodes = {};
  for (let langfile of files)
    addLanguageTexts(langfile.nodes, nodes);
  return nodes;
}

function getLanguageXML(basepath, language)
{
  let filepath = path.resolve(basepath, "./language/" + language + ".xml");
  if (testfsoverrides[filepath])
    return { filepath, filedata: testfsoverrides[filepath] };

  // Check if the specific language file exists and is a file
  let filestat;
  try
  {
    filestat = fs.statSync(filepath);
  }
  catch(e) {}
  if (!filestat || !filestat.isFile())
  {
    // The specific language file doesn't exist, fallback to default.xml
    filepath = path.resolve(basepath, "./language/default.xml");

    if (testfsoverrides[filepath])
      return { filepath, filedata: testfsoverrides[filepath] };

    try
    {
      filestat = fs.statSync(filepath);
    }
    catch(e) {}
  }
  if (!filestat || !filestat.isFile())
    throw new Error(`File ${filepath} not found`);

  //ADDME: Would like to use the streaming API, but couldn't get that to work properly...
  return { filepath, filedata: fs.readFileSync(filepath) };
}


function readLanguageFileInternal(basepath, language, filecache)
{
  // If we've seen this file before, return it immediately
  let cachedResult = filecache.get(basepath + "|" + language);
  if (cachedResult)
    return cachedResult;

  let { filepath, filedata } = getLanguageXML(basepath, language);

  // Parse the file
  let result = {};
  let curnode = result;
  let curtext = null;
  let nodestack = null;
  let invalidtagcount = 0;
  let fallbacklanguage = "";
  let parseerror = null;

  // Not using the 'xmlns' option, because we don't get a fully namespaced node object in the 'closetag' callback, just a
  // (fully qualified) name, so we'll just check if the node name starts with "html:" to filter out the html tags
  let parser = sax.parser(true, { strictEntities: true });
  try
  {
    parser.onerror = function(error)
    {
      parseerror = Error(error);
    };

    parser.onopentag = function(node)
    {
      if (invalidtagcount)
      {
        ++invalidtagcount;
        return;
      }
      // If this is an html tag, write the tag without the prefix with attributes
      if (node.name.startsWith("html:"))
      {
        if (!curtext)
          throw new Error("Unexpected HTML tag");

        curnode[curtext] += '<' + node.name.substr(5);
        for (let attr of Object.keys(node.attributes))
          curnode[curtext] += ' ' + attr + '="' + encoding.encodeValue(node.attributes[attr]) + '"';
        curnode[curtext] += '>';
      }
      else
      {
        switch (node.name)
        {
          // If this is the <language> tag, initialize the node stack
          case "language":
          {
            if (nodestack)
              throw new Error("Unexpected <language> tag");

            nodestack = [];
            fallbacklanguage = node.attributes.fallbacklanguage || "";
            break;
          }
          // If this a <textgroup>, initialize a new textgroup and push it onto the node stack
          case "textgroup":
          {
            if (!nodestack)
              throw new Error("Expected <language> tag");
            if (curtext)
              throw new Error("Unexpected <textgroup> tag with gid '" + node.attributes.gid + "'");
            if (!curnode)
              throw new Error("No current node for <textgroup> tag with gid '" + node.attributes.gid + "'");

            nodestack.push(curnode);
            curnode[node.attributes.gid] = {};
            curnode = curnode[node.attributes.gid];
            break;
          }
          // If this a <text>, initialize a new text
          case "text":
          {
            if (!nodestack)
              throw new Error("Expected <language> tag");
            if (curtext)
              throw new Error("Unexpected <text> tag with tid '" + node.attributes.tid + "'");
            if (!curnode)
              throw new Error("No current node for <text> tag with tid '" + node.attributes.tid + "'");

            curtext = node.attributes.tid;
            curnode[curtext] = "";
            break;
          }
          case "br":
          {
            if (!curtext)
              throw new Error("Unexpected <br> tag");

            curnode[curtext] += "\n";
            break;
          }
          case "param":
          {
            if (!curtext)
              throw new Error("Unexpected <param> tag");

            curnode[curtext] += "{p" + node.attributes.p + "}";
            break;
          }
          case "ifparam":
          {
            if (!curtext)
              throw new Error("Unexpected <ifparam> tag");

            curnode[curtext] += "{i" + node.attributes.p + "=" + JSON.stringify(node.attributes.value) + "}";
            break;
          }
          case "else":
          {
            if (!curtext)
              throw new Error("Unexpected <else> tag");

            curnode[curtext] += "{e}";
            break;
          }
          default:
          {
            // Skip this tag and its contents
            ++invalidtagcount;
            break;
          }
        }
      }
    };

    parser.ontext = function(text)
    {
      // If adding text, add text to curnode
      if (curtext && !invalidtagcount)
        curnode[curtext] += encoding.encodeTextNode(text.replace(/\{/g, "{{"));
    };

    parser.onclosetag = function(name)
    {
      // Exiting a tag we're skipping, decrease the invalid tag stack depth
      if (invalidtagcount)
      {
        --invalidtagcount;
        return;
      }

      // Close the html tag without the prefix
      if (name.startsWith("html:"))
      {
        curnode[curtext] += '</' + name.substr(5) + '>';
      }
      else
      {
        switch (name)
        {
          // Root node is closed, deinitialize the node stack
          case "language":
          {
            nodestack = null;
            break;
          }
          // Pop the previous node
          case "textgroup":
          {
            curnode = nodestack.pop();
            break;
          }
          // No longer parsing text
          case "text":
          {
            curtext = null;
            break;
          }
          // Close the ifparam construction
          case "ifparam":
          {
            curnode[curtext] += "{i}";
            break;
          }
        }
      }
    };

    // Called after the parser was closed
    parser.onend = function()
    {
      result = { filepath, language, nodes: result, fallbacklanguage };
      filecache.set(basepath + "|" + language, result);
    };

    // Start parsing
    parser.write(filedata);
  }
  finally
  {
    // always close the parser (especially when errors have occurred)
    parser.close();
  }
  return result;
}

function parseLanguageFile(moduletexts, gids, data)
{
  let texts = {};

  gids.forEach(gid =>
  {
    let readContext = data;
    let writeContext = texts;
    if (gid.split(".").every(part =>
      {
        // Find the part in the current context
        if (part in readContext && typeof readContext[part] == "object")
        {
          // This is a textgroup, recurse into the group
          if (!(part in writeContext))
            writeContext[part] = {};
          readContext = readContext[part];
          writeContext = writeContext[part];
          return true;
        }
        else if (part in readContext && typeof readContext[part] == "string")
        {
          // This is a text, just add the text and we're done
          writeContext[part] = readContext[part];
          return false;
        }
      }))
    {
      addLanguageTexts(readContext, writeContext);
    }
  });

  Object.assign(moduletexts, texts);
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

function overrideFile(path, content)
{
  if (content == null)
    delete testfsoverrides[path];
  else
    testfsoverrides[path] = content;
}

//export for tests
module.exports.readLanguageFile = readLanguageFile;
module.exports.parseLanguageFile = parseLanguageFile;
module.exports.generateTexts = generateTexts;
module.exports.overrideFile = overrideFile;
