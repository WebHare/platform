# @webhare/litty
Litty is a simple template builder for HTML code which auto-escapes interpolated values.

Litty is intended to replace Witty with a template literal syntax. (a Literal wITTY)

## How to use

Use the `litty` tagged template literal to build HTML. Insert values with `${...}`,
then call `await littyToString()` to render the template:

```typescript
import { litty, littyToString, type LittyValue } from "@webhare/litty";

function item(content: LittyValue) {
  return litty`<li>${content}</li>`;
}

const name = "<Alice>";
const page = litty`<h1>Hello ${name}</h1><ul>${[item("One"), item("Two")]}</ul>`;
const html = await littyToString(page);
// <h1>Hello &lt;Alice&gt;</h1><ul><li>One</li><li>Two</li></ul>
```

Literal HTML is preserved; interpolated values are escaped for use in HTML text
or quoted attributes (using littyEncode with the `attribute` format).
Nested Litty templates render as HTML without being escaped
again. Arrays render their elements in order without separators, and can be nested.
Use ordinary JavaScript expressions for conditionals and loops:

```typescript
const page = litty`<ul>${names.map(name => item(name))}</ul>${showFooter ? litty`<footer>Done</footer>` : null}`;
```

Always quote attribute values:

```typescript
const link = litty`<a href="${url}">${label}</a>`;
```


## Composing templates

Prefer returning `Litty` values from rendering functions instead of converting
them to strings. Accept `LittyValue` for slots that can contain either plain text
or another template, and interpolate the values directly:

```typescript
import { litty, littyEncode, littyToString, type Litty, type LittyValue } from "@webhare/litty";

function card(title: string, content: LittyValue): Litty {
  return litty`<article><h2>${title}</h2>${content}</article>`;
}

function layout(content: LittyValue): Litty {
  return litty`<!doctype html><html><body>${content}</body></html>`;
}

const cards = [
  card("Welcome", litty`<p>Hello ${"<Alice>"}!</p>`),
  card("Details", litty`<p>${littyEncode("First line\nSecond line", "html")}</p>`)
];
const page = layout(litty`<main>${cards}</main>`);
const html = await littyToString(page);
```

Render to a string as late as possible, usually only when handing the completed
page to an API that requires a string. If an API accepts `Litty`, pass the template
directly and let that API render it.

Calling `littyToString()` inside a component loses the distinction between HTML
and plain text: interpolating that string into another template escapes its markup
again. Keep the `Litty` value instead; don't render early and then use `rawLitty()`
to undo the escaping. Reserve `rawLitty()` for integrating existing trusted HTML.

## Supported values

Template values support strings, numbers, bigints, booleans, `URL`, `Money`, `Date`, and Temporal `Instant`,
`PlainDate`, `PlainDateTime`, `PlainTime`, and `ZonedDateTime`. Booleans render as
`true` or `false`, dates use `toISOString()`, and Temporal values use `toString()`.
URLs, bigints, and Money values use `toString()`; Money uses a decimal point without locale-specific formatting.
These values are attribute-encoded. `null` and `undefined` render as empty strings.
Litty templates and arrays of supported values can be nested.

## Custom encoding and raw HTML

Both helpers return a `Litty` value that can be interpolated into another template.
Use `littyEncode(text, "html")` for plain text whose line breaks should become
`<br>` tags. It still escapes HTML in the input; its output isn't escaped again.
Explicit `"attribute"` encoding is equivalent to interpolating the text directly:

```typescript
import { litty, littyEncode, littyToString } from "@webhare/litty";

const text = "<Hello>\nWorld";
await littyToString(litty`<p>${text}</p>`);
// <p>&lt;Hello&gt;&#10;World</p>
await littyToString(litty`<p>${littyEncode(text, "attribute")}</p>`);
// <p>&lt;Hello&gt;&#10;World</p>
await littyToString(litty`<p>${littyEncode(text, "html")}</p>`);
// <p>&lt;Hello&gt;<br>World</p>
```

Use `rawLitty()` when a renderer has already produced trusted HTML, rather than
plain text, as shown in the Markdown handler above. Within a template:

```typescript
import { litty, littyToString, rawLitty } from "@webhare/litty";

const renderedHTML = "<strong>Trusted HTML</strong>";
await littyToString(litty`<section>${rawLitty(renderedHTML)}</section>`);
// <section><strong>Trusted HTML</strong></section>
```

For JSON embedded in script elements, serialize it specifically for that context
before wrapping it in `rawLitty()`:

```typescript
import { litty, rawLitty } from "@webhare/litty";
import { stringify } from "@webhare/std";

const config = { title: "<Hello>" };
const script = litty`<script type="application/json" id="config">${rawLitty(stringify(config, { target: "script" }))}</script>`;
```

`rawLitty()` does not sanitize its input. Only use it with trusted HTML or output
already encoded for its insertion context, never directly with untrusted user
input.

For example, preserve line breaks in a postal address while still escaping any
markup in the supplied text:

```typescript
import { litty, littyEncode, type Litty } from "@webhare/litty";

function addressBlock(address: string): Litty {
  return litty`<address>${littyEncode(address, "html")}</address>`;
}

const address = addressBlock("Alice & Bob\nMain Street 1");
// Renders as <address>Alice &amp; Bob<br>Main Street 1</address>
```

Encoded values can also be reused in larger templates. Use `"attribute"` rather
than `"html"` inside a quoted attribute, where `<br>` would not create a line break:

```typescript
import { litty, littyEncode } from "@webhare/litty";

const description = 'A "special" offer\nToday only';
const tooltip = littyEncode(description, "attribute");
const content = littyEncode(description, "html");
const offer = litty`<div title="${tooltip}">${content}</div>`;
// Renders as <div title="A &quot;special&quot; offer&#10;Today only">A "special" offer<br>Today only</div>
```

Both examples build composable templates; render them with
`littyToString()` only when a string is needed.

## Using Litty in a content request handler

A content builder can pass its composed template straight to
`request.buildWebPage()`. Here is a complete Markdown handler, including a helper
that returns `Litty` rather than exposing the Markdown renderer's HTML string:

```typescript
import { litty, rawLitty, type Litty } from "@webhare/litty";
import type { ContentBuilderFunction, ContentPageRequest, WebResponse } from "@webhare/router";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false });

function renderMarkdownText(text: string): Litty {
  return rawLitty(markdown.render(text));
}

export async function renderMarkdown(request: ContentPageRequest): Promise<WebResponse> {
  const markdowninfo = await request.getInstance("platform:filetypes.markdown");
  const markdowntext = await markdowninfo?.data?.text?.text();
  const content = markdowntext ? renderMarkdownText(markdowntext) : null;
  return request.buildWebPage(litty`<main>${content}</main>`);
}

renderMarkdown satisfies ContentBuilderFunction;
```

Use the exported `renderMarkdown` function as the content builder for the
Markdown file type. `buildWebPage()` integrates the content into the site's page
rendering; the handler does not need to call `littyToString()`.

The Markdown renderer produces HTML, so its output is wrapped in `rawLitty()`
once, at that integration boundary. This example disables embedded HTML and keeps
MarkdownIt's default link validation. Don't wrap untrusted source text directly
in `rawLitty()`.
