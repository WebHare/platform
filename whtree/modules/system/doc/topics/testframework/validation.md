# Validation
WebHare run several static checks when testing a module

## Static validation
Running `wh checkmodule <modulename>` will validate XML and WHLIBs for that module

The `meta > validation` tag in the moduledefinition can be used to tweak the
configuration process.

Eg:
```xml
  <meta>
    <validation options="nowarnings" >
    <exclude mask="data/siteprofile_newsletter.xsd" why="Not understood by WebHare" />
  </meta>
```

Options to tune the validation/CI process:
- `nomissingtids` - turns all tid warnings into errors.
- `perfectcompile` - turns all compilations warnings into errors
- `nowarnings` - treat every warning as an error. implies all options above

`<exclude>` specifies masks (relative to `mod::<modulename>/`) for files to exclude
completely from validation The `why` attribute is required to explain why this file is being excluded.
Note that excluded files are also excluded from the language's editor tid scan.

