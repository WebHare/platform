# Writing documentation

## Language
Prefer American English. Examples:

- `color` not `colour`
- `behavior` not `behaviour`
- `organization` vs `organisation`

## Topic structure
All documentation for a topic must be in a single folder under `<module>/doc/topics/<topicname>`.

Non-core module should just use their name for a topic (eg `webshop`) or as a prefix (eg `webshop-api`) to
avoid collisions.

A topic folder must contain a topic.xml, eg:

```xml
<topic xmlns="http://www.webhare.net/xmlns/dev/topic"
       title="Newsletter"
       shortdescription="Newsletter (Pronuntio)"
       docorder="harescript changelog">
  <section name="api" title="Newsletter API" />
</topic>
```

A topic may also contain an `intro.md` which will be displayed on the topic's landing page. `intro.md`
does not need to listed in the docorder

The docorder describes the order of the `md` files, and the `<section>`s describe the order of
API documentation.

## HareScript documentation

### Library prolog
The prolog is the first comment (before any loadlib) and describes the topic under which
this library should be filed:

```harescript
<?wh
/** @topic mytopic/section
*/

LOADLIB ...;
```

When a library is public (eg. not in `/internal/` or `/tests/` subdirectory), its public symbols
will be documented. This can be overridden at the library level by specifying `@public` or
`@private`, optionally followed by a reason.

This topic, and whether the symbol is documented can also be overridden at the symbol level.

### Symbol documentation
Per symbol (function, variable, objecttype or objecttype member):

````harescript
/** @short Inverse of %OtherFunction
    @long Long, just like %OtherFunction
    @loadlib Recommended library to LOADLIB, if not this one
    @param(object wrdschema2017) wrdschema WRD schema passed as argument 'wrdschema'
    @param language Language code
    @param options Options (but shouldn't we just leave this out)
    @cell(integer) options.int Gimme an int!
    @return(object wrdschema) Iets over de returnwaarde
    @cell(integer) return.int Returns an int!

    @related <!-- Ignore for now? -->
    @example
```
// Prints 42
PRINT(ToString(21+21));
​```
*/
MACRO Print()
````

- `@short` is optional, the first line after `/**` or `///` will always be interpreted as the short description  <!-- FIXME of moeten we @short gewoon deprecaten voor consistentie? -->
- `///` is technically equivalent to `/**` but only really usable for specifying a short description but nothing else
- use `@private` (with an optional comment) to mark identifiers that should not be documented
- use `@public` (with an optional comment) to mark identifiers that should be documented. When documenting a public symbol
  that is exported from a public library, you should probably also use `@loadlib` to specify which library the user should
  loadlib for access to this symbol.
- use `@includecelldef [filename]#symbol.parameter` to reuse cell definitions from a different function
- use `@signature` to hardcode the signature shown for a function (eg to hide VARIANT parameters)
  - for example: `@signature FUNCTION PTR FUNCTION MakeFunctionPtr(STRING functionname)`
- use `@loadlib` (with a library name) to specify which loadlib should be used to get access to this symbol (that
  library must export this symbol)

Symbols are filed under their library's topic, unless overridden using `@topic`.

```harescript
  /* Refers to /lib/payments.whlib in the same module, objecttype PaymentAPI, member StartPayment's errors cell in the return value
     @cell(record array) return.errors @includecelldef /lib/payments.whlib#PaymentAPI::StartPayment.return.errors
  */

  /* Use the options supported by another function as the base for your options and extend them:
     @param options Options @includecelldef %ScanBlob.options
     @cell(boolean) options.extractdominantcolor If TRUE, extract the dominant color from images
  */
```

## Code site internal linking

### Symbol-search based link
An identifier prefix with `%` (eg `%AllowToSkipCaptchaCheck`) will use the symbol
search rules to look for the identifier in the current public libraries. The symbol
needs to be unambigously one of

- a documented global function or variable (including tables and schemas)
- a documented objecttype
- a documented member function of a documented objecttype which is not an UPDATE.

"Documented" means that it's either public in a public library, or has been
explictly marked in the `@documents` section of a public library.

`%` is currently only (officially) supported in HareScript and Markdown documentation.

<!-- TODO: establish rules for use in XSD -->

You can also directly refer to a member of an objecttype using the syntax
`%Objecttype::Member`. The objecttype must be a documented one, but the member can
now also refer to an UPDATEd member.

### Topic links
Direct links to topics look like this: `topic:<topicname>[/subfile]`

Eg: `[Forms api](topic:forms)` or `[Custom questions](topic:forms/custom-questions)`

Relative links are also supported between Markdown documents, eg `[Custom questions](custom-questions)`
when used in the 'getting started' document
