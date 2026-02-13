---
agent: agent
---
Convert the requested Witty file to a TypeScript file using 'litty' templates. Unless otherwise directed, create a file with the `.witty` extension replaced with `.litty.ts` next to the original file. For example, if the original file is `template.witty`, the new file should be `template.litty.ts`.

Witty is the template language for HareScript. It uses files with a .witty extension

To convert a .witty file to .ts you need to use the `@webhare/litty` library.

Witty code can contain components (wrapped between tags `[component name]` and `[/component]`)
These components can be embedded (tags like `[embed name]`).

Code not inside a component is considered to be the main template.

As an *example* the following witty code
```
[component mycomponent]
  field: [value]
[/component]

[component mycomponent2]
  field2: <b>[value2]</b>
[/component]

<div>Witty test!</div>
[embed mycomponent]
[body]
```

can be translated to the following TypeScript code:

```
import { litty, Litty } from "@webhare/litty";

function mycomponent(value: string) {
  return `field: ${value}`;
}

function mycomponent2(value2: string) {
  return `field2: <b>${value2}</b>`;
}

export function myTemplate(data: {
  body: string;
  value: string;
  value2: string;
}): Litty {

  return litty`
    <div>Witty test!</div>
    ${mycomponent(data.value)}
    ${mycomponent2(data.value2)}
    ${data.body}
  `;
}
```

Camel case component names when converting them into a function. Eg `[component pretty_header]` should become `function prettyHeader`.

Convert parameter names/fields to camelcase as well.

Replace `myTemplate` (the entrypoint name) with a camel-cased name based on the original file name and append `Template`. For example, if the original file is `my-file.witty` the entrypoint should be named `myFileTemplate`.

As a special case: the functions replacing the components `htmlhead` and `htmlbody`, if present, should be exported. Name them something like `myFileHead` and `myFileBody` if the original file is `my-file.witty`.

An embed can also refer to a different file if it contaings a colon, eg `[embed ./header/header.witty:header]`. This should be assumed to refer to a component `header`
exported from `./header/header.litty.ts` so this could be replaced by `import { header } from "./header/header.litty.ts";` and then the embed can be replaced by `${header(data)}`. Offer to convert these other files as well if they are not already converted.

`[gettid ...]` calls are a special case:
- They should be replaced by a call to the JavaScript `getTid` function, to be imported using `import { getTid } from "@webhare/gettid";`. For example, `[gettid module:user.id]` should be replaced by `${getTid("module:user.id"}`.
- If the first parameter to getTid is not yet prefixed by a module name followed by a colon (ie it's `some.text` instead of `module:some.text`) it must be prefixed by the module name of the original file. Eg a file named `webhare_module/webdesigns/example_site/example_site.witty` is in the module `webhare_module` and thus the first parameter to getTid must be prefixed with `webhare_module:`. To find the module name, look upwards through the folder tree for the highest folder containing `moduledefinition.xml` or `moduledefinition.yml`. That folder's name is the module name.

A `[forvery]...[/forvery]` loop should be replaced by a JavaScript `map` call. For example:
```
  [forevery alt_languages]
    <link rel="alternate" hreflang="[language]" href="[link]" />
  [/forevery]
```

becomes

```
  ${data.altLanguages.map(lang => `
    <link rel="alternate" hreflang="${lang.language}" href="${lang.link}" />
  `).join("")}
```

Apply these changes to the Witty file provided by the user.
