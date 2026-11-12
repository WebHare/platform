---
name: naming-conventions
description: "Naming conventions for WebHare platform code and documentation: casing of acronyms in identifiers (URL, HTML, WHFS vs Id), names for language codes (lang), and WebHare terminology (WHFS type, field vs property, instance, file type, avoiding 'content type' and 'metadata'). Use when naming variables, functions, parameters, types, options, YAML/JSON members or CLI flags, when reviewing names, or when writing docs and comments about WebHare concepts."
---

# Naming conventions

These conventions apply to new TypeScript code, YAML/JSON members (eg. in
siteprofiles and module definitions), CLI options, documentation, and comments
in the WebHare platform. Existing public APIs don't always follow them; don't
rename a published API just to match. For general TypeScript guidelines see the
`typescript-development` skill in the `webhare_dev` module.

## Identifiers

- Use camelCase for variables, functions, parameters and members, and
  UpperCamelCase for types and classes.
- Write acronyms in capitals inside a name: `baseURL`, `getOriginURL`,
  `siteBaseURL`, `openWHFSObject`. Do not write `baseUrl` or
  `targetUrl`.
- At the start of a camelCase name, write the acronym in lowercase: `url`,
  `whfsType`. Types and classes keep the capitals: `WHFSFolder`.
- Exception: write `Id`, not `ID`: `entityId`, `fileId`, `parentId`.
- Use `lang` for a variable, parameter or member holding a language code (eg.
  `"en"`, `"nl"`), not `langCode`, `language` or `languageCode`. Combine it
  like other words, eg. `defaultLang`.

## WebHare terminology

Use these terms consistently in names, docs and comments. They match the
[WebHare glossary](https://www.webhare.dev/reference-next/glossary/).

- **WHFS** (WebHare File System): the hierarchical store of sites, folders and
  files. A **WHFS object** is either a **WHFS file** or a **WHFS folder**.
- **Site**: a WHFS folder that is the root for publishing to a URL. Sites can't
  contain other sites, except through a **foreign folder** (a part of a site that
  is managed elsewhere and isn't published by the CMS).
- **Publisher**: the CMS application in which users manage sites, files and
  folders.
- **WHFS type**: a named group of custom fields. Don't call it a *content type*:
  that term is ambiguous with MIME types. For a MIME type, say `mimeType`.
- **Base fields**: the built-in fields every WHFS object has (eg. `name`,
  `title`). **Custom fields**: fields added by modules through WHFS types.
- **Field** vs **property**: members of a WHFS type are *fields*, not
  *properties*. *Property* is reserved for settings of forms and Tollium
  components.
- **Instance**: a concrete set of values for a WHFS type. Widgets are instances
  that can render themselves.
- **File type**: a WHFS type enabled as the type of WHFS files.
- **Resource**: a file shipped as part of a module. A **resource path** refers to
  one as `mod::<module>/<path>`.
- **RTD** (rich text document): structured rich content using headings,
  paragraphs and widgets, constrained by an **RTD type**.
- **Value constraints**: limits on the values a field or Tollium component
  accepts. In siteprofiles, properties override each other but constraints are
  merged.
- Avoid **metadata** in technical names and docs: too many things qualify. Name
  what it actually is (eg. `customFields`, `seoTitle`). It is fine in end-user
  UI, such as the Publisher's "Metadata" tab.

WHFS types have a meta type describing what they can be used for: `instance`,
`dataFile`, `upload`, `page`, `blockWidget`, `inlineWidget` or `folder`. Use
these names, not older ones such as *content type* for `instance`.
