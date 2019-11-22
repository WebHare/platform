# Language files

WebHare supports multilingual sites by using 'language files' to contain the
strings to translate. You can also use language files to 'split off' the texts
for easier maintenance even if your site supports only a single language.

To enable language files, create a folder named `language` in the root of
your module. In this folder, create a file `default.xml`

Add this content to the file:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<language xmlns="http://www.webhare.net/xmlns/tollium/screens" xml:lang="en">
  <textgroup gid="site">
    <text tid="text">This is a test</text>
  </textgroup>
</language>
```

In your `moduledefinition.xml` file, where you should have a `assetpack` node, make sure there are `supportedlanguages`

```xml
  <assetpack entrypoint="..." supportedlanguages="en" />
```

To add more languages, just create more XML files in the `language` folder. Make
sure to name the files after the language,eg `nl.xml`, `de.xml` and to set the
language in the `xml:lang=".."` attribute of the document element of the file.

## In Witty files

You can now use the `[gettid ...]` call to show a translated text, for example:

```witty
[gettid site.text]
```

This should print "This is a test".

The used language is set in your main site profile's `<apply>` node:

```xml
<sitelanguage lang="en" />
```

For example to show Dutch in a Dutch site, do something like this:

```xml
<apply>
  <to type="all" sitename="My Site - Dutch" />
  <sitelanguage lang="nl" />
</apply>
```

Of course you can also set up root folders for each language, for example root folders named `en` and `nl`. Just make sure to apply the correct site language to each location.

## In JavaScript files

You can also use the `gettid` function in your JavaScript (\*.es) files. To do this, perform these steps on top of the steps in chapter "Setup":

Create a JSON file called `mysite.lang.json`. `mysite` can be anything, just make sure the file name ends with `.lang.json`.

A language specification file should contain one object, with an `imports` key,
which is an object with module names for keys and arrays of gid's for values,
and optionally a `requires` key, which can be used to list other language files
to be included, e.g.:

```javascript
  { "imports": { "module_name": [ "site.commontexts" ] }
  , "requires": [ "../common.lang.json" ]
  }
```

Where `module_name` is the name of your module and the value an array of `<textgroup>` nodes to include.

Import both the `gettid` library as well as your `mysite.lang.json` file, and invoke `getTid`:

```javascript
import { getTid } from "@mod-tollium/js/gettid";
import './path/to/mysite.lang.json';

console.log(getTid('module_name:site.commontexts.text'));
```

Where `module_name` is the name of your module. This should print "This is a test".

Also, all elements that have a data-texttid attribute will have their textContent set to the result of calling getTid with the
value of the data-texttid attribute. This is done for all elements within the document body on DOMContentLoaded. Use the
convertElementTids function to run this conversion again. If a node is supplied as the first argument, only the elements
within that node (excluding the node itself) will processed.

The language to use is read from the `lang` attribute on the `<html>` tag, but can be overridden using:

```javascript
getTid.tidLanguage = "en";
```

# Editing language files

You can use the built-in language file editor to fill out the language texts.
Open `Modules and configuration` in WebHare, select your module and start
the language editor.

## General guidelines
- Separate language sets (limitlanguages=) as high as reasonable possible in the language file. Make an early split between frontend (website) and backend (interface) translation groups.
- Group related texts in such a way that if a page, widget or application is removed, you can simply remove a part of the tree without worrying about shared texts
  - Keep filetype and application titles inside their group - do not use a global 'module' or 'filetypes' group
  - In XML files, set a 'gid' as high as possible, avoid too many subgids. (Siteprofiles added full support for a toplevel gid= in WebHare 4.17)
  - When in doubt, base your gid on the path of the current file (eg, use 'gid="tolliumapps.langedit" for mod::tollium/tolliumapps/langedit/langedit.xml)
- Use "~texts" (~ is short for tollium:tilde) for common texts such as 'add'.
- Avoid directly modifying language files. If you have to, rewrite them using the language file editor
- When updating/restructuring language files, you can use the 'import missing from' feature in the language editor to quickly populate a new group if the untranslated texts are already somewhere else in the tree
