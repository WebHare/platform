# Using Witty

Using a Witty consists of two steps, apart from the actual writing of the Witty template and code that gathers the required data. You first need to _parse_ the Witty template, a process in which the template is validated and prepared for execution. Next, you need to _run_ the Witty template.

## Parsing a Witty template

Before you can use a Witty template, you have to parse it. The HareScript library [wh::witty.whlib](http://www.webhare.net/scripts/findlibrary.shtml?name=wh::witty.whlib) offers the following parse functions:
```
//Parse a blob as a Witty template
PUBLIC INTEGER FUNCTION ParseWittyBlob(BLOB data, STRING encoding);

//Parse a string as a Witty template
PUBLIC INTEGER FUNCTION ParseWitty(STRING data, STRING encoding);

//Parse a file in the HareScript filesystem as a template
PUBLIC INTEGER FUNCTION ParseWittyLibrary(STRING name, STRING encoding);
```
The _data_ parameter of the first two functions should speak for themselves, but the third function is a special version that takes a _library_ as a parameter, such as _site_::_site/folder/file.witty_ or _module::mymodule/file.witty_. This allows you to store Witty templates in the database or on disk, without having to bother with transactions or access rights.

As a security precaution, the Witty engine checks the type of the file you are trying to load through _ParseWittyLibrary_. If the file is stored in the database (eg, a site:: path), it must have a Witty template file type (publisher file type #26). If the file is stored on disk, it must have a &quot;.witty&quot; extension.

If any of the parse functions returns a value equal to or less than zero, an error occurred. You can use the _GetWittyParseErrors_ function to get a list of the parse errors and their locations.

## Data encoding

All Witty loading functions take an _encoding_ parameter, which allow Witty to automatically set the right encoding on inserted text. Witty supports the following encodings:

| Encoding | Effect |
| --- | --- |
| HTML | %EncodeValue is used inside tags, %EncodeHTML outside tags. The parser interprets `<` and `>` as tag start and end characters, but properly ignores the `>` character if it appears inside an attribute value of a tag. |
| XML | %EncodeValue is used for all inserted text |
| TEXT | No encoding is used |

These encodings only specify the default encoding - you can still override them per inserted field.

All functions return a positive value on success, which you should store as a handle for later _RunWitty_ commands. If any of these functions return a zero or negative value, the Witty library was either not found or it contains a syntax error.

## Parse failures and common errors

If the parse functions return an error, there is a syntax error in your Witty template (and _not_ in the data you are supplying to RunWitty). If you see an &quot;Invalid Witty handle&quot; error message, you probably have a syntax error in your template and did not check for an error before calling RunWitty. You can also use the _GetWittyParseErrors_ function to get a list of the parse errors and their locations.

The most common causes of a syntax error are:

- Forgetting to use the slash when closing a block (eg. using `[if] instead of [/if]`)
- Forgetting to escape open brackets by using a double open bracket (`[[`)
- Misspelling the encoding of data (eg. using `[cell:encodejava]` instead of `[cell:java]`)
- Using an unsupported encoding in a Parse call (eg, `NONE` or `XHTML`)

## Executing Witty code

A successfully parsed Witty library can be executed using %RunWitty. You can also run a specific component contained inside a Witty template using %RunWittyComponent:
```harescript
// Run a parsed witty Template in its entirety, skipping cover components
PUBLIC RECORD FUNCTION RunWitty(INTEGER script, RECORD data);

// Run only a specific component in a parsed Witty template
PUBLIC RECORD FUNCTION RunWittyComponent(INTEGER script, STRING component, RECORD data);
```

Witty code calls back to HareScript code when it executes a function pointer. You can use %CallWittyComponent and %GetWittyVariable inside these functions, to run available components or get variables from the current Witty context:
```harescript
// Get a variable from the currently running Witty`s context
PUBLIC VARIANT FUNCTION GetWittyVariable(STRING variablename);

// Invoke a component in the currently running Witty
PUBLIC RECORD FUNCTION CallWittyComponent(STRING component, RECORD data);
```
The Witty Run/Call functions return a record which describes any errors that may have occurred. All these functions have a return value of the following form:

| Cell | Type | Description |
| --- | --- | --- |
| success | Boolean | True if no errors occurred during the execution |
| error | Record | A record containing the last run-time Witty error, if any. See the section on error handling for more information |

You can also use the AbortOnWittyRunError function to wrap RunWitty calls as an easy way to trigger error handling. For example:
```harescript
//Parse a library (we assume this first step already succeeded)
INTEGER witty_handle := ParseWittyLibrary(&quot;module::test/mylib.whlib&quot;, &quot;HTML&quot;);

//Witty data record
RECORD witty_data := [...];

//Run witty, abort on any error
AbortOnWittyRunError( RunWitty(witty\_handle, witty\_data) );
```
## Supplying external data

To do anything meaningful with a Witty template, it needs external data to render. This data is supplied as a record to the various Witty execution commands. In Witty, a cell is accessed by referring to it by its name, and the data records you pass can contain more records and record arrays. For more information on how cells are looked up inside the data record you specify, see the Cell name lookups section.

## Capturing or redirecting Witty results

By default, the result of a Witty is printed using %Print. If you want to capture the output of a Witty, you should redirect its output using %RedirectOutputTo. The following example demonstrates how to capture a Witty`s output:

```harescript
// Create a stream to hold the Witty results
INTEGER datastream := CreateStream();
// Redirect and save the original output stream id
INTEGER oldoutput := RedirectOutputTo(datastream);

// Execute the witty (wittyid refers to an earlier parsed Witty template)
RunWitty(wittyid, wittydata);

// Restore the original output redirection
RedirectOutputTo(oldoutput);
// Store the witty result stream into a blob
BLOB finaldata := MakeBlobFromStream(datastream);
```
Of course, normally you don't need to redirect a Witty's output into a blob - when using Witty in dynamic server pages or publication templates, the default behaviour of RunWitty is usually just fine - it sends it output to the server or output page.

