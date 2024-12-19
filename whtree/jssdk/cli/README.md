# WebHare cli support

`@webhare/cli` provides access to CLI support functions, like ANSI commands and
a command-line parser.

## Command-line parser

You can use the command-line parser for simple scripts like:

```typescript
import { run } from "@webhare/cli";

run({
  options: {
    // Option are stored with the last name of their list of names, in this case "verbose"
    "v,verbose": { default: false, description: "Show extra info" },
    // Also, the names are camelcased, this one is stored as "withData".
    "with-data": { default: "", description: "string option" },
  },
  arguments: [
    { name: "<file>", description: "File to load" }
  ],
  main({ args, opts, specifiedOpts }) {
    // Type types of args and opts
    console.log(`Load file ${args.file}`);
    console.log(`Verbose: ${opts.verbose ? "yes" : "no"}`);
    console.log(`WithData: ${opts.withData}`);
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
  options: {
    // Option are stored with the last name of their list of names, in this case "verbose"
    "v,verbose": { default: false, description: "Show extra info" },
    // Also, the names are camelcased, this one is stored as "withData".
    "with-data": { default: "", description: "string option" },
  },
  subCommands: {
    command1: {
      shortDescription: "Executes command1",
      description: "This command executes the stuff a command1 command should execute",
      options: {
        "fast": { default: false, description: "Do it fast" }
      },
      arguments: [
        { name: "<file>", description: "The file to operate on" },
        { name: "[output]", description: "Optional output" },
        { name: "[more...]", description: "More arguments, all optional" },
      ],
      main({ opts, args }) {
        // The global and per-command options are passed in opts
        console.log(`Verbose: ${opts.verbose}, fast: ${opts.fast}`);
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

### Options
Simple options can have three types, determined by the type of the `default`
property.
- boolean. These are switches, the value is set to `true` when the switch is
  provided (even when the default is set to `true`!).
- string. A string option. The argument is required (cannot be made optional).
  Possible forms: `-svalue`, `-s value`, `--str=value` and `--str value`.
- number. A number option. The argument is required (cannot be made optional).
  Possible forms: `-n55.4`, `-n 10`, `--number=21.2` and `--number 66.6`.

If there are rules for the form of the argument, or it needs a specific parser,
an argument type can be specified with a `type: CLIArgumentType<Type>` property.
If that property is provided, the `default` can be any value that is valid for
type `Type`. In the future, autocomplete may also be provided through an option
type.

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
