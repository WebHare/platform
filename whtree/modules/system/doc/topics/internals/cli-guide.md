# CLI guidelines

Some pointers when writing CLI tools:

- Always use %TerminateScriptWithError to abort - this ensures an errorcode is set. Avoid throwing exceptions for 'normal'
  misuse of the tools (eg invalid syntax, port already exists) as they are harder to read and may suggest an internal error.
- Always set an errorcode when printing command syntax - just finish with `TerminateScriptWithError("")` - so scripts can
  detect when they made a mistake

## Script skeleton
```harescript
<?wh
// command: cli-tool [subcommand]
// short: Does a CLI thing

LOADLIB "wh::os.whlib";

LOADLIB "mod::system/lib/database.whlib";


MACRO SubCommand(STRING ARRAY params)
{
  RECORD subargs := ParseArguments(params,
      [ [ name := "switch", type := "switch"  ]
      , [ name := "param", type := "param", required := TRUE ]
      ]);

  IF(NOT RecordExists(subargs))
  {
    Print("Syntax: wh cli-tool subcommand [--virtual] <port number>\n");
    TerminateScriptWithError("");
  }

  GetPrimary()->BeginWork();

  //Database stuff

  GetPrimary()->CommitWork();
}

MACRO Main()
{
  RECORD ARRAY options := [ [ name := "command", type := "param", required := TRUE ]
                          , [ name := "params", type := "paramlist" ]
                          ];

  RECORD cmdargs := ParseArguments(GetConsoleArguments(), options);


  SWITCH(RecordExists(cmdargs) ? cmdargs.command : "help")
  {
    CASE "subcommand"
    {
      SubCommand(cmdargs.params);
    }
    DEFAULT
    {
      Print("Syntax: wh cli-tool <command>\n");
      Print("  subcommand [--switch] <param>: Execute the subcommand\n");
      TerminateScriptWithError("");
    }
  }
}

OpenPrimary();
Main();
```
