# WebHare cli support

`@webhare/cli` provides access to CLI support functions, like ANSI commands and
a command-line parser.

## Command-line parser

You can use the command-line parser for simple scripts like:

```typescript
import { run } from "@webhare/cli";

run({
  flags: {
    // Flags are stored with the last name of their list of names, in this case "verbose"
    "v,verbose": { description: "Show extra info" },
  },
  options: {
    // Options have associated values. Also, the names are camelcased, this one is stored as "withData".
    "with-data": { description: "string option" },
  },
  arguments: [
    { name: "<file>", description: "File to load" }
  ],
  main({ args, opts, specifiedOpts }) {
    // Type types of args and opts
    console.log(`Load file ${args.file}`);
    console.log(`Verbose: ${opts.verbose ? "yes" : "no"}`);
    console.log(`WithData: ${opts.withData ?? "<not specified>"}`);
    console.log(`List of specified options: ${specifiedOpts.join(", ")}`); // prints the full names
  }
});
```

For scripts with sub-commands you can use the following form:

```typescript
import { run } from "@webhare/cli";

// runData is filled with data, containing the global options
const runData = run({
  /// Global options
  flags: {
    // Option are stored with the last name of their list of names, in this case "verbose"
    "v,verbose": { default: false, description: "Show extra info" },
  },
  options: {
    // Also, the names are camelcased, this one is stored as "withData".
    "with-data": { default: "", description: "string option" },
  },
  subCommands: {
    command1: {
      shortDescription: "Executes command1",
      description: "This command executes the stuff a command1 command should execute",
      flags: {
        "fast": { description: "Do it fast" }
      },
      arguments: [
        { name: "<file>", description: "The file to operate on" },
        { name: "[output]", description: "Optional output" },
        { name: "[more...]", description: "More arguments, all optional" },
      ],
      main({ opts, args }) {
        // The global and per-command options are passed in opts
        console.log(`Verbose: ${opts.verbose}, fast: ${opts.fast}`);
        console.log(`WithData: ${opts.withData ?? "<not specified>"}`);
        console.log(`File: ${args.file}`);
        console.log(`Output: ${args.output ?? "N/A"}`);
        console.log(`More: ${args.more.join(", ")}`);

        // run() returns before the main() is called, so runData can be used
        // to read the global options in shared functions
        console.log(`Verbose: ${runData.globalOpts.verbose}`);
      }
    }
  }
});
```

### Flags
Flags are simple switches (of type boolean) that can be `true` or `false`.
The value is set to true when the switch is provided in the command line (even
when the default is set to `true`!)

### Options
Options have a required associated value (there is no mechanism to make it
optional).

The default type of an options is `string`. If there are rules for the
form of the argument, or it needs a specific parser, an argument type can be
specified with a `type: CLIArgumentType<Type>` property. The type of the option
then becomes `Type`.

If no default is provided, the property passed to the main function will
be optional (eg: `{ args: { file?: string } }`). If a default is passed (which
must be of same type as the option, it is not added to the type), the property
will become required (eg: `{ args: { file: string } }`).

Example:
```typescript
import { intOption, run } from "@webhare/cli";

run({
  options: {
    "withoutDefault": { description: "Option without default" },
    "withDefault": { default: "", description: "Option with default" },
    "intWithDefault": { default: -1, description: "Option with default", type: intOption() },
  },
  main({ opts }) {
    // opts has type { withoutDefault?: string; withDefault: string; intWithDefault: number }
    console.log(`withoutDefault: ${opts.withoutDefault}`);
    console.log(`withDefault: ${opts.withDefault ?? "<not specified>"}`);
    console.log(`intWithDefault: ${opts.intWithDefault}`);
  }
});
```

To see if an option was provided on the command-line, use specifiedOpts (or
specifiedGlobalOpts for global options in the return value of `run()`).

### Arguments
There are four forms of arguments:
- `<arg1>`: a required argument
- `[arg2]`: an optional argument
- `<arg3...>`: a list of arguments, with at least one item
- `[arg4...]`: a list of arguments, none required

The default type of an argument is `string` (or `string[]` for lists). If a
`type: CLIArgumentType<Type>` is provided, the arguments are parsed with
that type and will change to `Type` and `Type[]` respectively.

### Main functions
The `main` functions execute the program or subcommand. They are executed
_after_ the `run()` function returns, to be able to store the object with
the global options so it can be accessed by the executed code.

The main function is called with the following signature:
```typescript
main(data: {
  /// Executed command, not provided if no subcommands are present
  command?: string;
  /// Options, for every option there is a property with the actual option value
  opts: Record<string, unknown>; // real type inferred by the options and arguments (eg `{ verbose: boolean; str: string }`)
  /// List of options specified on the command-line
  specifiedOptions: string[]; // real type inferred by the options (eg `Array<"verbose" | "fast>`)
  /// Options, for every argument there is a property with the actual argument value
  args: object; // real type inferred by the arguments (eg `{ arg1: string; arg2?: string; arg4: string[] }`)
}): CommandReturn;
```

The allowed return types of a main function are:
- `void`
- `number` - if not set yet or 0, the process exit code is set to this value
- `Promise<void>`
- `Promise<number>` - if not set yet or 0, the process exit code is set to this
  value

Special handling is invoked when an exception of type `CLIRuntimeError` is
received.  If the message of the exception is set, that message will be printed.
If the option `showHelp` of that exception that is set to true, the help will be
printed  to stderr (if set, the help for the command in option `command`). If
the property `exitCode` is  set, the process exit code will be set to that value
(and to `1` if not).

### Predefined types
The following types have been predefined:
- intOption: Accepts integers (optional with minimum and maximum value)
- floatOption: Accepts numbers (optional with minimum and maximum value)
- enumOption: Accepts a specific set of strings

### Autocompletion
The API for bash autocompletion support is still under development, and should
be considered experimental (and subject to change in the future).

For now, completion is handled by getting the command line (usually in COMP_LINE)
and slicing it at the cursor position (COMP_POINT). Then the command line
is parsed with `parseCommandLine`. The last string in the array returned by
that function is the one that will be completed. If the cursor is set at the end
of the line, after whitespace (eg `bla bla <here>`), an empty string is returned
at the end of the list.

Example for completion:

``` typescript
import { autoCompleteCLIRunScript, enableAutoCompleteMode, parseCommandLine } from "@webhare/cli/src/run-autocomplete";

/// Split the command line in words using bash word splitting rules
const words = parseCommandLine(commandline);
/// Run autocomplete
const completes = await runAutoComplete(words);
```

To run autocomplete for a file using `run()`, the cli library must be placed in
a mode that `run()` calls aren't executed, but their configuration is stored
for autocompletion instead.

Example:
```typescript
import { enableAutoCompleteMode } from "@webhare/cli/src/run-autocomplete";

/** registerAsDynamicLoader is called with the node module of the autocompletion
 * library, this can be used to register that library as one that does
 * `require()` calls, and should not be reloaded when a loaded library changes
 */
enableAutoCompleteMode({ registerAsDynamicLoader: (module) => { /* ... */ } });

const autocompletes = autoCompleteCLIRunScript("/tmp/file.ts", [ "param1" ]);
```

This returns a list of autocompletion options. It must be postfixed with `\n`
when it is not a partial autocompletion, and a space should be added after
the argument when accepted.

TODO: describe how to register an autocomplete handler, process the
result with COMP_WORDBREAKS, example to call it with `curl`.


## commander -> run conversion guide
```typescript
const parsedArgs = program
  .option("--days <days>", "Number of days to sync (default 7)", "7")
  .option("--debug", "Debug")
  .parse();

const days = parseInt(parsedArgs.opts().days) || 7;
const debug = Boolean(parsedArgs.opts().debug);

async function main() { ... }
```

becomes:

```typescript
run({
  flags: {
    "debug": { description: "Debug" },
  },
  options: {
    "days": { default: 7, description: "Number of days to sync (default 7)", type: intOption({ start: 1 }) },
  },
  main: async function ({ opts }) { ... }
});
```
