## Breaking changes

### PDF titles are set after the file has been created
When you create a PDF file in the WHFS without a title, WebHare takes the title from the PDF's metadata. It used to do
this immediately during `CreateFile`. It now does this in a `platform:analyzefiles` managed task, which runs after the
work that created the file has been committed. The title appears a few seconds after the upload, and setting it doesn't
change the file's modification date.

Code that reads the title of a new PDF right after creating it now gets an empty title. If you need the title
immediately, read it from the PDF yourself and pass it as `title` when creating the file. In tests, wait for the task:
`testfw->FlushTasks([ "platform:analyzefiles" ])` in HareScript, or `await flushTasks(["platform:analyzefiles"])` from
`@webhare/tasks` in TypeScript.

This now also works for files created from TypeScript (eg. `createFile` and `importIntoWHFS`) and on the WebAssembly
HareScript engine, which didn't set PDF titles before. A title you pass explicitly, even an empty one, is never
replaced. PDFs larger than 100 MB no longer get a title.
