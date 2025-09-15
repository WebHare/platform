import { getBestMatch } from "@webhare/js-api-tools";
import { registerRun } from "./run-autocomplete";

/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
/// Type that can be returned by main() functions
type CommandReturn = void | number | Promise<void> | Promise<number>;

export class CLIError extends Error {
  constructor(message: string, public command?: string) {
    super(message);
  }
}

export class CLISyntaxError extends CLIError {
}

export class CLIConfigError extends CLIError {
}

export class CLIShowHelp extends CLIError {
  constructor(message: string, public options: { command?: string } = {}) {
    super(message, options.command);
  }
}
export class CLIRuntimeError extends CLIError {
  constructor(message: string, public options: { exitCode?: number; showHelp?: boolean; command?: string } = {}) {
    super(message, options.command);
  }
}

export interface CLIArgumentType<ValueType> {
  /** Parses a user-provided value. Throws CLISyntaxError. Required to allow typeinference to work. */
  parseValue(arg: string, options: { argName: string; command?: string }): ValueType;
  /** Return possible autocomplete sugegestions. Incomplete suggestions (user should add more text) should end with a '*'. Returned values that do not match the supplied 'startsWith' are ignored
   * `cwd` is the current working directory, is filled in from WH 5.9+.
  */
  autoComplete?(startsWith: string, options: { argName: string; command?: string; cwd: string }): string[] | Promise<string[]>;
  description?: string;
}

/** Type of options - with type or without. Options with type can have any default, but the
 * default will be coerced to the value type of the type. All options take an argument, except boolean options
 * without type.
 */
type OptionsTemplate = {
  default?: unknown;
  description?: string;
  type: CLIArgumentType<unknown>;
  multiple?: boolean;
} | {
  default?: string;
  description?: string;
  type?: never;
  multiple?: boolean;
} | string;

type FlagTemplate = {
  default?: boolean;
  description?: string;
} | string;

/** An arguments, with an optional type */
type Argument<J> = {
  name: `<${string}>` | `[${string}]` | `[${string}...]` | `<${string}...>`;
  description?: string;
  type?: CLIArgumentType<J>;
};

type SubCommandTemplate = {
  shortDescription?: string;
  description?: string;
  options?: Record<string, OptionsTemplate>;
  flags?: Record<string, FlagTemplate>;
  arguments?: readonly [...Array<Argument<unknown>>];
  main?: unknown;
};

export type ParseData = {
  name?: string;
  description?: string;
  options?: Record<string, OptionsTemplate>;
  flags?: Record<string, FlagTemplate>;
  arguments?: ReadonlyArray<Argument<unknown>>;
  subCommands?: never;
  main?: unknown;
} | {
  name?: string;
  description?: string;
  options?: Record<string, OptionsTemplate>;
  flags?: Record<string, FlagTemplate>;
  arguments?: ReadonlyArray<Argument<unknown>>;
  subCommands?: Record<string, SubCommandTemplate>;
};

type OptArgBase = {
  options?: Record<string, OptionsTemplate>;
  flags?: Record<string, FlagTemplate>;
  arguments?: readonly [...Array<Argument<unknown>>];
  subCommands?: Record<string, SubCommandTemplate>;
};

// Ensures the defaults of options with type are compatible with the return type of the type.
type SanitizeOptions<Options extends Record<string, OptionsTemplate>> = { [Key in keyof Options]: "default" extends keyof Options[Key] ?
  Simplify<Omit<OptionsTemplate & object, "default"> & { default: GetParsedType<Options[Key], string, false> }> :
  OptionsTemplate;
};

/// Sanitizes the options and arguments of subcommands
type SanitizeSubCommandOptArgs<SubCommands extends Record<string, SubCommandTemplate>> = { [Key in keyof SubCommands]: SanitizeOptArgs<SubCommands[Key]> & SubCommandTemplate };

/// Sanitize the options and arguments of a record, and subcommands if present
type SanitizeOptArgs<O extends OptArgBase> =
  (O extends { options: {} } ? {
    options: SanitizeOptions<O["options"]>;
  } : {}) &
  (O extends { subCommands: {} } ? {
    subCommands: SanitizeSubCommandOptArgs<O["subCommands"]>;
  } : {});

/// Returns the type a type rec returns
type GetArgumentTypeType<O extends { type: CLIArgumentType<any> }> = ReturnType<O["type"]["parseValue"]>;

/// Determine the type of an argument (taking the type into account)
type TypeOfArgument<A extends Argument<unknown>> = A["name"] extends `<${string}...>` | `[${string}...]` ? GetParsedType<A, string, true> : GetParsedType<A, string, false>;

/// Determine the name of an argument (stripping `...`, `[]` and `<>`)
type NameOfArgument<A extends Argument<unknown>> = A["name"] extends `[${infer S}...]` ? S : A["name"] extends `<${infer S2}...>` ? S2 : A["name"] extends `[${infer S}]` ? S : A["name"] extends `<${infer S}>` ? S : never;

type GetMultiple<Type, Multiple extends boolean | undefined> = Multiple extends true ? Type[] : Type;

/// Get the parsed type for an option or an argument. Simplify<> is needed to work around some weird stuff in the TS compiler. `O extends object` doesn't seem to work here?
type GetParsedType<O extends object | string, Default, Multiple extends boolean | undefined> = O extends object ?
  (GetMultiple<Simplify<O> extends { readonly type: CLIArgumentType<any> } ? GetArgumentTypeType<Simplify<O>> : Default, Multiple>) :
  Default;

/// CamelCases a string separated by '-' or '_'
type CamelCase<S extends string> = S extends `${infer P1}${"_" | "-"}${infer P2}${infer P3}`
  ? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
  : Lowercase<S>;

function nameToCamelCase(name: string) {
  return name.replaceAll(/[-_][a-z]/g, c => c[1].toUpperCase());
}

/// Gets the name to store an option value in (last item of a comma separated list of option names, camelcased)
type GetOptionListStoreName<K extends string> = K extends `${string},${infer E}` ? never | GetOptionListStoreName<E> : CamelCase<K>;

// Gets rid of the intersections within a type
type Simplify<A extends object> = A extends object ? { [K in keyof A]: A[K] } : never;

type IsMultiple<O extends OptionsTemplate> = O extends { multiple: true } ? true : false;

/// Calculate the resulting values record for options
type OptionsResult<Options extends Record<string, OptionsTemplate>, Flags extends Record<string, FlagTemplate>> = Simplify<
  { -readonly [Key in keyof Options & string as ("default" extends keyof Options[Key] ? GetOptionListStoreName<Key> : never)]-?: GetParsedType<Options[Key], string, IsMultiple<Options[Key]>> } &
  { -readonly [Key in keyof Options & string as ("default" extends keyof Options[Key] ? never : GetOptionListStoreName<Key>)]?: GetParsedType<Options[Key], string, IsMultiple<Options[Key]>> } &
  { -readonly [Key in keyof Flags & string as GetOptionListStoreName<Key>]: boolean } &
  object>;

/// Calculate the resulting values record for arguments
type ArgumentsResult<Arguments extends ReadonlyArray<Argument<unknown>>> = [Arguments] extends [never[]] ? object : Simplify<
  { [ThisArgument in (Arguments[number]) as ThisArgument["name"] extends `<${string}>` | `[${string}...]` | `[${string}...]` ? NameOfArgument<ThisArgument> : never]: TypeOfArgument<ThisArgument> } &
  { [ThisArgument in (Arguments[number]) as ThisArgument["name"] extends `[${string}]` ? NameOfArgument<ThisArgument> : never]?: TypeOfArgument<ThisArgument> }
>;

/// Calculate the resulting values record for main functions
type MainData<Rec extends OptArgBase, Cmd extends string | null = null, ExtraOpts extends OptArgBase | null = null> = Simplify<{
  args: NarrowTruthy<ArgumentsResult<Rec["arguments"] & {}>>;
  opts: NarrowTruthy<Simplify<OptionsResult<Rec["options"] & {}, Rec["flags"] & {}> & (ExtraOpts extends object ? OptionsResult<ExtraOpts["options"] & object, ExtraOpts["flags"] & object> : object)>>;
  specifiedOpts: Array<keyof Simplify<OptionsResult<Rec["options"] & {}, Rec["flags"] & {}> & (ExtraOpts extends object ? OptionsResult<ExtraOpts["options"] & object, ExtraOpts["flags"] & object> : object)>>;
} & (Cmd extends string ? { cmd: Cmd } : { cmd?: undefined })>;

/// Calculates the data for run() functions
type GlobalData<Rec extends OptArgBase> = {
  globalOpts: NarrowTruthy<Simplify<OptionsResult<Rec["options"] & {}, Rec["flags"] & {}>>>;
  specifiedGlobalOpts: Array<keyof Simplify<OptionsResult<Rec["options"] & {}, Rec["flags"] & {}>>>;
};

/// Build the declarations for the main functions
type MainDeclarations<Rec extends OptArgBase, Cmd extends string | null = null, ExtraOpts extends OptArgBase | null = null> =
  (Simplify<Rec> extends { subCommands: any } ? {
    subCommands: { [K in keyof Rec["subCommands"] & string]: MainDeclarations<Simplify<Rec>["subCommands"][K], K, Rec> };
  } : {
    main: (data: MainData<Rec, Cmd, ExtraOpts>) => CommandReturn;
  });

/// The type of the options and arguments of a record
type PickRootOptionsArguments<T> = { [K in keyof T & ("options" | "flags" | "arguments")]: T[K] };

/** If used as intersection part of a function parameter type, and T isn't known yet, T will be inferred as an object
 * with the types of the properties "options", "flags" and "arguments" of the argument. We must make sure no main() is
 * swept up, because that fixes the signature of the function, and we cannot change it anymore based on the options and
 * arguments. This type returns unknown, so when used as `InferRootOptionsArguments<X> & ParseData` only ParseData will
 * remain as result type - so invalid typed data will be picked up by the compiler.
 * @example
 * ```ts
 * function test<T>(data: InferRootOptionsArguments<T> & ParseData) {}
 * // when calling `test({ options: { a: { default: 0 } }, description: "descr" })`, T will be inferred as `{ options: { a: {} } }`,
 * // but the type of InferRootOptionsArguments<T> will be `unknown`.
 * ```
 */
type InferRootOptionsArguments<T> = PickRootOptionsArguments<T> extends symbol ? PickRootOptionsArguments<T> : unknown;

/// Get only the subcommands and their options and arguments of the subcommands of a record
type PickSubCommandOptionsArguments<T> = { [K in keyof T & "subCommands"]: { [C in keyof T[K]]: PickRootOptionsArguments<T[K][C]> } };

/** Same as InferRootOptionsArguments but for the subcommands. Note: this construction does not pick up type literals or
 * tuples (for the subcommand arguments) when using PickSubCommandOptionsArguments directly would. Those are not actually
 * needed in this module, so there is no problem here, but it might be worth while to find out why. It does pick up
 * literals for argument names (but that might be because when used as `InferSubCommandOptionsArguments<T> & ParseData`
 * it gets influenced by the name of the argument, which is defined as a union of string literals).
*/
type InferSubCommandOptionsArguments<T> = PickSubCommandOptionsArguments<T> extends symbol ? PickSubCommandOptionsArguments<T> : unknown;

/// Convert {} to object for options. For some reason, `& object` doesn't work here
type NarrowTruthy<O> = {} extends Required<O> ? object : O;

/// The result of parsing a commandline with the 'parse' function
type ParseResult<GlobalRec extends OptArgBase, Rec extends OptArgBase, Cmd extends string | null = null, ExtraOpts extends OptArgBase | null = null> =
  (Rec extends { subCommands: any } ? {
    [K in keyof Rec["subCommands"] & string]: ParseResult<GlobalRec, Rec["subCommands"][K], K, Rec>
  }[keyof Rec["subCommands"] & string] :
    Simplify<MainData<Rec, Cmd, ExtraOpts> & GlobalData<GlobalRec>>);


/** Check order of arguments, that required arguments aren't surrounded by optional arguments, max 1 rest parameter, etc
*/
function checkArgumentsOrder(args: Array<Argument<unknown>>, cmd?: string): { trailingRequired: number } {
  // Allow <required>* <optional>* ...rest(0,1)
  let curLevel = 3;
  let haveRest = 0;
  let trailingRequired = 0;
  const names: string[] = [];
  for (const arg of args) {
    let level = arg.name.at(-2) === "." ? 1 : arg.name[0] === "[" ? 2 : 3;
    // Strip the <>, [] or ... from the name
    const name = level === 1 ? arg.name.slice(1, -4) : arg.name.slice(1, -1);
    // Test for duplicate names
    if (names.indexOf(name) !== -1)
      throw new CLIConfigError(`Argument ${JSON.stringify(name)} is specified twice`, cmd);
    // Allow trailing required arguments
    if (level === 3 && curLevel !== 3) {
      level = 0;
      ++trailingRequired;
    }
    // check order
    if (level > curLevel) {
      if (curLevel === 1)
        throw new CLIConfigError(`Optional argument ${JSON.stringify(name)} cannot follow a rest argument`, cmd);
      else
        throw new CLIConfigError(`Required argument ${JSON.stringify(names.at(-1)!)} cannot be placed between optional arguments`, cmd);
    }
    curLevel = level;
    if (level === 1 && ++haveRest !== 1)
      throw new CLIConfigError(`Only one rest argument allowed`, cmd);
    names.push(name);
  }
  return { trailingRequired };
}

type OptMap = Map<string,
  { storeName: string; isFlag: true; isGlobal: boolean; rec: FlagTemplate } |
  { storeName: string; isFlag: false; isGlobal: boolean; rec: OptionsTemplate }
>;

type OptData = {
  flags?: Record<string, FlagTemplate> | undefined;
  options?: Record<string, OptionsTemplate> | undefined;
};

function registerOptsAndFlags(optMap: OptMap, parsedOpts: Record<string, unknown> | null, parsedGlobalOpts: Record<string, unknown> | null, isGlobal: boolean, data: OptData) {
  if (data.flags) {
    for (const [keys, flagRec] of Object.entries(data.flags)) {
      const storeName = nameToCamelCase(keys.split(",").at(-1)!);
      for (const key of keys.split(",")) {
        optMap.set(key, { storeName, isFlag: true, isGlobal, rec: flagRec });
      }
      const defaultValue = typeof flagRec === "string" ? false : (flagRec.default ?? false);
      if (parsedOpts)
        parsedOpts[storeName] = defaultValue;
      if (isGlobal && parsedGlobalOpts)
        parsedGlobalOpts[storeName] = defaultValue;
    }
  }
  if (data.options) {
    for (const [keys, optionRec] of Object.entries(data.options)) {
      const storeName = nameToCamelCase(keys.split(",").at(-1)!);
      for (const key of keys.split(",")) {
        optMap.set(key, { storeName, isFlag: false, isGlobal, rec: optionRec });
      }
      if (typeof optionRec === "object" && "default" in optionRec) {
        if (parsedOpts)
          parsedOpts[storeName] = optionRec.default;
        if (isGlobal && parsedGlobalOpts)
          parsedGlobalOpts[storeName] = optionRec.default;
      }
    }
  }
}

/* Fix the suffix character for an autocomplete - we ask getAutoComplete to make them end in '*' but the autocomplete protocol needs '\\n' for final answers */
function fixAutcompleteSuffix(ac: string) {
  if (ac.endsWith('*'))
    return ac.substring(0, ac.length - 1);
  else
    return ac + '\n';
}

export function parse<
  const E extends object,
  const S extends object
>(
  data: InferRootOptionsArguments<E> & InferSubCommandOptionsArguments<S> & NoInfer<ParseData & SanitizeOptArgs<E & S>>,
  argv: string[]
): ParseResult<E & S, E & S, null> {
  const parsedOpts: Record<string, unknown> = {};
  const parsedGlobalOpts: Record<string, unknown> = {};
  const parsedArgs: Record<string, unknown> = {};

  const optMap = new Map<string, { storeName: string; isFlag: true; isGlobal: boolean; rec: FlagTemplate } | { storeName: string; isFlag: false; isGlobal: boolean; rec: OptionsTemplate }>();

  registerOptsAndFlags(optMap, parsedOpts, parsedGlobalOpts, true, data as OptData);

  let command: [string, SubCommandTemplate] | undefined;
  const specifiedOpts: string[] = [];
  const specifiedGlobalOpts: string[] = [];

  let gotArgument = false;
  let gotOptionTerminator = false;
  let showHelp = false;
  const argList: string[] = [];
  argvloop:
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("-") && arg.length > 1 && !gotOptionTerminator) {
      // got an option (single '-' is treated as argument)
      if (arg.startsWith("--")) {
        if (arg === "--") {
          gotOptionTerminator = true;
          continue;
        }
        const parts = arg.slice(2).split("=");
        const key = parts[0];
        if (key.length <= 1)
          throw new CLISyntaxError(`Invalid option syntax: ${JSON.stringify(arg)}`, command?.[0]);

        const optionRef = optMap.get(key);
        if (!optionRef) {
          if (key === "help") {
            showHelp = true;
            // Try to read the subcommand, but only if there are subcommands specified
            if (!data.subCommands || command)
              break;
            continue;
          }
          const bestMatch = getBestMatch(key, [...optMap.keys()]);
          throw new CLISyntaxError(`Unknown option: ${JSON.stringify(key)}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}?` : ``}`, command?.[0]);
        }

        const { storeName, isFlag, isGlobal, rec } = optionRef;
        specifiedOpts.push(storeName);
        if (isGlobal)
          specifiedGlobalOpts.push(storeName);

        if (isFlag) {
          if (parts.length > 1)
            throw new CLISyntaxError(`Flag ${JSON.stringify(key)} does not take a value`, command?.[0]);
          parsedOpts[storeName] = true;
          if (isGlobal)
            parsedGlobalOpts[storeName] = true;
        } else {
          let strValue = parts[1];
          if (strValue === undefined) {
            if (i + 1 >= argv.length)
              throw new CLISyntaxError(`Option ${JSON.stringify(key)} requires a value`, command?.[0]);
            ++i;
            strValue = argv[i];
          }

          const storeValue = typeof rec === "object" && rec.type ?
            rec.type.parseValue(strValue, { argName: `option ${JSON.stringify(key)}`, command: command?.[0] }) :
            strValue;

          parsedOpts[storeName] = storeValue;
          if (isGlobal)
            parsedGlobalOpts[storeName] = storeValue;
        }
      } else {
        for (let j = 1; j < arg.length; j++) {
          const key = arg[j];
          const optionRef = optMap.get(key);
          if (!optionRef) {
            if (key === "h") {
              showHelp = true;
              // Try to read the subcommand, but only if there are subcommands specified
              if (!data.subCommands || command)
                break argvloop;
              continue;
            }
            const bestMatch = getBestMatch(key, [...optMap.keys()]);
            throw new CLISyntaxError(`Unknown option: ${JSON.stringify(key)}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}?` : ``}`, command?.[0]);
          }

          const { storeName, isFlag, isGlobal, rec } = optionRef;
          specifiedOpts.push(storeName);
          if (isGlobal)
            specifiedGlobalOpts.push(storeName);

          if (isFlag) {
            parsedOpts[storeName] = true;
            if (isGlobal)
              parsedGlobalOpts[storeName] = true;
          } else {
            let strValue: string;
            if (j + 1 < arg.length) {
              strValue = arg.slice(j + 1);
              j += strValue.length;
            } else {
              if (i + 1 >= argv.length)
                throw new CLISyntaxError(`Option ${JSON.stringify(key)} requires a value`, command?.[0]);
              strValue = argv[++i];
            }

            const storeValue = typeof rec === "object" && rec.type ?
              rec.type.parseValue(strValue, { argName: `option ${JSON.stringify(key)}`, command: command?.[0] }) :
              strValue;

            parsedOpts[storeName] = storeValue;
            if (isGlobal)
              parsedGlobalOpts[storeName] = storeValue;
          }
        }
      }
    } else {
      if (!gotArgument) {
        gotArgument = true;
        if (data.subCommands) {
          const cmdObj = data.subCommands[arg];
          if (!cmdObj) {
            const bestMatch = getBestMatch(arg, Object.keys(data.subCommands));
            throw new CLISyntaxError(`Unknown subcommand: ${JSON.stringify(arg)}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}?` : ``}`);
          }
          command = [arg, cmdObj];
          registerOptsAndFlags(optMap, parsedOpts, parsedGlobalOpts, false, cmdObj as OptData);

          // No need to process further if we have got a request for help
          if (showHelp)
            break;
          continue;
        }
      }

      // Can't process the arguments inline, because required arguments at the end are supported
      argList.push(arg);
    }
  }

  if (data.subCommands && !command)
    throw new CLISyntaxError(`No subcommand specified`);

  const cmdArgs = ((command ? command[1].arguments : data.arguments) || []) as Array<Argument<unknown>>;
  const { trailingRequired } = checkArgumentsOrder(cmdArgs, command?.[0]);

  // Don't validate arguments when calling help
  if (showHelp)
    throw new CLIShowHelp("", { command: command?.[0] });

  // parse the arguments
  for (const arg of cmdArgs) {
    if (arg.name.endsWith("...>") || arg.name.endsWith("...]")) {
      const name = arg.name.slice(1, -4);
      const minRequired = arg.name.startsWith("<") ? 1 : 0;
      const parsed = argList.length <= trailingRequired ?
        [] :
        argList.splice(0, Math.max(minRequired, argList.length - trailingRequired))
          .map(value => arg.type?.parseValue(value, { argName: `argument ${JSON.stringify(name)}`, command: command?.[0] }) ?? value);
      if (parsed.length < minRequired)
        throw new CLISyntaxError(`Missing required argument: ${name}`, command?.[0]);
      parsedArgs[name] = parsed;
    } else if (arg.name.startsWith("<")) {
      const name = arg.name.slice(1, -1);
      if (!argList.length)
        throw new CLISyntaxError(`Missing required argument: ${name}`, command?.[0]);
      const value = argList.shift()!;
      parsedArgs[name] = arg.type?.parseValue(value, { argName: `argument ${JSON.stringify(name)}`, command: command?.[0] }) ?? value;
    } else if (arg.name.startsWith("[")) {
      const name = arg.name.slice(1, -1);
      const value = argList.length > trailingRequired ? argList.shift() : undefined;
      if (value !== undefined)
        parsedArgs[name] = arg.type?.parseValue(value, { argName: `argument ${JSON.stringify(name)}`, command: command?.[0] }) ?? value;
    } else
      throw new CLIConfigError(`Invalid argument name: ${arg.name}`, command?.[0]);
  }

  if (argList.length)
    throw new CLISyntaxError(`Too many arguments`, command?.[0]);

  return {
    cmd: command?.[0],
    args: parsedArgs,
    opts: parsedOpts,
    specifiedOpts,
    globalOpts: parsedGlobalOpts,
    specifiedGlobalOpts,
  } as ParseResult<E & S, E & S, null>;
}

export function printHelp(data: ParseData, options: { error?: CLIError; command?: string } = {}): void {
  const print = options.error ?
    (...args: unknown[]) => console.error(...args) :
    (...args: unknown[]) => console.log(...args);

  if (options.error && options.error.message) {
    print(`Error: ${options.error.message}`);
    print(``);
  }

  function describeData(toDescribe: { type?: CLIArgumentType<unknown>; default?: unknown }): string {
    const strs = [
      toDescribe.type?.description,
      toDescribe.default !== false ? JSON.stringify(toDescribe.default) : undefined
    ].filter(_ => _);
    return strs.length ? ` (${strs.join(", ")})` : "";
  }

  function formatOptionNames(names: string): string {
    return names.split(",").map(name => name.length === 1 ? `-${name}` : `--${name}`).join(", ");
  }

  if (data.name)
    print(`Command: ${data.name}`);
  if (data.description)
    print(`Description: ${data.description}`);

  const secondColumnPadAt = 24;
  const maxDescriptionLen = 80;

  const optionEntries = Object.entries({ ...data.options, ...data.flags }).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, OptionsTemplate | FlagTemplate]>;
  if (optionEntries.length) {
    print(`Options:`);
    for (const [name, option] of optionEntries) {
      print(`  ${formatOptionNames(name).padEnd(secondColumnPadAt - 3, " ")} ${typeof option === "string" ? option : option.description || ""}${describeData(typeof option === "string" ? { description: option } : option)}`);
    }
  }
  if (data.subCommands) {
    const command = options.command ?? options.error?.command;
    if (command) {
      print(`Subcommand: ${command}`);
      const commandRec = data.subCommands[command];

      const cmdOptionEntries = Object.entries({ ...commandRec?.options, ...commandRec?.flags }).sort(([a], [b]) => a.localeCompare(b));
      if (cmdOptionEntries.length) {
        print(`  Options:`);
        for (const [name, option] of cmdOptionEntries) {
          print(`    ${formatOptionNames(name).padEnd(secondColumnPadAt - 5, " ")} ${typeof option === "string" ? option : option.description || ""}${describeData(typeof option === "string" ? { description: option } : option)}`);
        }
      }
      if (commandRec.arguments?.length) {
        print(`  Arguments:`);
        for (const arg of commandRec.arguments || [])
          print(`    ${arg.name.padEnd(secondColumnPadAt - 5, " ")} ${arg.description || ""}${describeData(arg)}`);
      }
    } else {
      print(`Subcommands:`);
      for (const [name, cmd] of Object.entries(data.subCommands).sort(([a], [b]) => a.localeCompare(b))) {
        print(`  ${name.padEnd(secondColumnPadAt - 3, " ")} ${cmd.shortDescription || (cmd.description ? (cmd.description.length > maxDescriptionLen ? cmd.description.slice(0, maxDescriptionLen - 1) + /*ellipsis*/"\u2026" : cmd.description) : "")}`);
      }
    }
  } else if (data.arguments?.length) {
    print(`Arguments:`);
    for (const arg of data.arguments || []) {
      print(`  ${arg.name.padEnd(secondColumnPadAt - 3, " ")} ${arg.description || ""}`);
    }
  }
}

/** Run a command line application
 *
 * @param data - Command configuration
 * @param options - Options for the run
 *    - argv: Override arguments. (defaults to process.argv.slice(2))
 */
export function run<
  const E extends object,
  const S extends object
>(
  data: InferRootOptionsArguments<E> & InferSubCommandOptionsArguments<S> & NoInfer<ParseData & SanitizeOptArgs<E & S> & MainDeclarations<E & S>>,
  options: {
    argv?: string[];
  } = {}
): Simplify<{ onDone?: () => void } & GlobalData<E & S>> {
  type ReturnType = Simplify<{ onDone?: () => void } & GlobalData<E & S>>;
  const runReturn: ReturnType = {
    globalOpts: {},
    specifiedGlobalOpts: []
  } as any;

  const registerData = registerRun((argv: string[], opts: { cwd: string }) => runAutoComplete(data, argv, opts));
  if (registerData.mode === "autocomplete")
    return runReturn;

  const parsed: Record<string, unknown> & { cmd?: string } = {};
  try {
    // The return type of parse is not very useful in this (generic) context, so we cast it to a useful type
    const parseReturn = parse<E, S>(data, options.argv ?? process.argv.slice(2)) as { cmd?: string } & ReturnType;
    runReturn.globalOpts = parseReturn.globalOpts;
    runReturn.specifiedGlobalOpts = parseReturn.specifiedGlobalOpts;
    for (const [key, value] of Object.entries(parseReturn))
      if (!["globalOpts", "specifiedGlobalOpts"].includes(key))
        parsed[key] = value;
  } catch (e) {
    if (e instanceof CLIShowHelp) {
      printHelp(data, { command: e.options.command });
      return runReturn;
    }
    if (e instanceof CLIError) {
      printHelp(data, { error: e });
      process.exitCode = 1;
      void Promise.resolve(true).then(() => runReturn.onDone?.());
      return runReturn;
    }
    throw e;

  }
  type MainFunc = (arg: object) => CommandReturn;

  void (async () => {
    // Execute the main() command after an await, so the run() command can first return and make the global options available.
    await Promise.resolve();

    try {
      let retval: CommandReturn;
      if (parsed.cmd) {
        const cmd = data.subCommands![parsed.cmd];
        retval = (cmd.main as MainFunc)(parsed);
      } else
        retval = (data as { main: MainFunc }).main(parsed);

      retval = await retval;
      if (typeof retval === "number")
        process.exitCode ??= retval;
    } catch (e) {
      if (e instanceof CLIRuntimeError) {
        if (e.options.showHelp)
          printHelp(data, { error: e, command: e.command });
        else if (e.message)
          console.error(`Error: ${e.message}`);
        if (e.options.exitCode !== undefined)
          process.exitCode = e.options.exitCode;
        else
          process.exitCode ??= 1;
      } else
        throw e; // rethrow, let the uncaughtException handler handle it
    } finally {
      runReturn.onDone?.();
    }
  })();
  return runReturn;
}

export function intOption({ start, end }: { start?: number; end?: number } = {}): CLIArgumentType<number> {
  return {
    parseValue(arg, options) {
      if (!arg.match(/^-?\d+$/))
        throw new CLISyntaxError(`Illegal integer ${JSON.stringify(arg)} specified for ${options.argName}`, options.command);
      const parsed = parseInt(arg, 10);
      if (typeof parsed !== "number" || isNaN(parsed) || parsed < -Number.MAX_SAFE_INTEGER || parsed > Number.MAX_SAFE_INTEGER)
        throw new CLISyntaxError(`Illegal integer ${JSON.stringify(arg)} specified for ${options.argName}`, options.command);
      if (start !== undefined && parsed < start)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is smaller than ${start} for ${options.argName}`, options.command);
      if (end !== undefined && parsed > end)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is larger than ${end} for ${options.argName}`, options.command);
      return parsed;
    },
    description: start !== undefined ?
      end !== undefined ?
        `integer between ${start} and ${end}` :
        `integer larger or equal to ${start}` :
      end !== undefined ?
        `integer smaller or equal to ${end}` :
        `integer`
  };
}

export function floatOption({ start, end }: { start?: number; end?: number } = {}): CLIArgumentType<number> {
  return {
    parseValue(arg, options) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(arg);
        if (typeof parsed !== "number" || isNaN(parsed))
          throw new Error();
      } catch (e) {
        throw new CLISyntaxError(`Illegal number ${JSON.stringify(arg)} specified for ${options.argName}`, options.command);
      }
      if (start !== undefined && parsed < start)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is smaller than ${start} for ${options.argName}`, options.command);
      if (end !== undefined && parsed > end)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is larger than ${end} for ${options.argName}`, options.command);
      return parsed;
    },
    description: start !== undefined ?
      end !== undefined ?
        `number between ${start} and ${end}` :
        `number larger or equal to ${start}` :
      end !== undefined ?
        `number smaller or equal to ${end}` :
        `number`
  };
}

export function enumOption<const T extends string>(allowedValues: T[]): CLIArgumentType<T> {
  return {
    parseValue(arg, options): T {
      if (!allowedValues.includes(arg as T)) {
        const bestMatch = getBestMatch(arg, allowedValues);
        throw new CLISyntaxError(`Illegal value ${JSON.stringify(arg)} specified for ${options.argName}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}?` : ``}`, options.command);
      }
      return arg as T;
    },
    autoComplete() {
      return allowedValues;
    },
    description: `one of ${allowedValues.map(s => JSON.stringify(s)).join(", ")}`,
  };
}

/** Autocompletes the last argv argument (assumes the cmdline which must be autocompleted is split at the cursor).
 * When an new argument must be autocompleted, pass a "".
 */
export async function runAutoComplete(data: ParseData, argv: string[], { cwd }: { cwd: string }): Promise<string[]> {
  const optMap = new Map<string, { storeName: string; isFlag: true; isGlobal: boolean; rec: FlagTemplate } | { storeName: string; isFlag: false; isGlobal: boolean; rec: OptionsTemplate }>();
  let command: [string, SubCommandTemplate] | undefined;

  registerOptsAndFlags(optMap, null, null, true, data as OptData);

  let gotOptionTerminator = false;
  let argIdx = 0;
  argvloop:
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const isLast = i === argv.length - 1;

    if (arg.startsWith("-") && !gotOptionTerminator) {
      // got an option
      if (arg.startsWith("--")) {
        if (arg === "--" && !isLast) {
          // This is an option terminator only when it's not the last argument, skip it
          gotOptionTerminator = true;
          continue;
        }

        const parts = arg.slice(2).split("=");
        const key = parts[0];

        const optionRef = optMap.get(key);

        if (!isLast) {
          if (!optionRef || optionRef.isFlag)
            continue;

          ++i;
          if (i === argv.length - 1) {
            // autocompleting the argument of this option
            if (typeof optionRef.rec === "object" && optionRef.rec.type?.autoComplete) {
              const completes = await optionRef.rec.type.autoComplete(argv[i], { argName: `option ${JSON.stringify(key)}`, command: command?.[0], cwd });
              return completes.filter(c => c.startsWith(argv[i])).map(fixAutcompleteSuffix);
            }
            return [];
          }
        } else {
          // --long-opt=value, autocompleting the value
          if (parts.length > 1) {
            // Unknown options or flags can't take arguments
            if (optionRef?.isFlag || typeof optionRef?.rec !== "object" || !optionRef?.rec.type || !optionRef.rec.type.autoComplete)
              return [];

            const completes = await optionRef.rec.type.autoComplete(parts[1], { argName: `option ${JSON.stringify(key)}`, command: command?.[0], cwd });
            return completes.map(c => `--${key}=${c}`).filter(c => c.startsWith(arg)).map(fixAutcompleteSuffix);
          }

          // autocomplete the option
          return [...optMap.keys()].filter(k => k.length >= 2 && k.startsWith(key)).map(k => `--${k}\n`).sort();
        }
      }

      // INV: !arg.startsWith("--")

      if (isLast && arg.length === 1) { // just a '-'
        // give back all options
        return [...optMap.keys()].map(k => k.length === 1 ? `-${k}\n` : `--${k}\n`).sort();
      }

      for (let j = 1; j < arg.length; j++) {
        const key = arg[j];
        const optionRef = optMap.get(key);
        // Ignore unknown options
        if (!optionRef)
          continue;

        // No need to autocomplete flags
        if (optionRef.isFlag)
          continue;

        if (j + 1 < arg.length) {
          // option followed by immediate value
          if (isLast) {
            if (typeof optionRef.rec === "object" && optionRef.rec.type?.autoComplete) {
              const completes = await optionRef.rec.type.autoComplete(arg.slice(j + 1), { argName: `option ${JSON.stringify(key)}`, command: command?.[0], cwd });
              return completes.map(c => `${arg.slice(0, j + 1)}${c}`).filter(c => c.startsWith(arg));
            }
            return [];
          }
          continue argvloop;
        }

        // Known option, immediate value follows

        if (isLast) {
          // Single-letter option found, add a space so the value can be autofilled
          return [`${arg}\n`];
        }

        ++i;
        if (i === argv.length - 1) {
          if (typeof optionRef.rec === "object" && optionRef.rec.type?.autoComplete) {
            const completes = await optionRef.rec.type.autoComplete(arg.slice(j + 1), { argName: `option ${JSON.stringify(key)}`, command: command?.[0], cwd });
            return completes.filter(c => c.startsWith(arg));
          }
          return [];
        }
      }

      if (isLast)
        return [`${arg}\n`];
      continue;
    }

    // This is the command (if subCommands are specified) or an argument
    if (data.subCommands && !command) {
      if (isLast) {
        return Object.keys(data.subCommands).filter(k => k.startsWith(arg)).sort().map(k => `${k}\n`);
      }

      const cmdObj = data.subCommands[arg];
      if (!cmdObj)
        return [];

      command = [arg, cmdObj];
      registerOptsAndFlags(optMap, null, null, false, cmdObj as OptData);
      continue;
    }

    const args: ReadonlyArray<Argument<unknown>> = (command ? command[1].arguments : data.arguments) || [];

    if (argIdx >= args.length)
      return [];

    // FIXME: if required arguments follow the optional arguments, maybe merge autocompletes?

    const curArg = args[argIdx];
    if (curArg.name.endsWith("...>") || curArg.name.endsWith("...]")) {
      if (isLast) {
        if (curArg.type?.autoComplete) {
          const completes = await curArg.type.autoComplete(arg, { argName: `argument ${JSON.stringify(curArg.name)}`, command: command?.[0], cwd });
          return completes.filter(c => c.startsWith(arg)).map(fixAutcompleteSuffix);
        }
        return [];
      }
      continue;
    }

    ++argIdx;
    if (isLast) {
      if (curArg.type?.autoComplete) {
        const completes = await curArg.type.autoComplete(arg, { argName: `argument ${JSON.stringify(curArg.name)}`, command: command?.[0], cwd });
        return completes.filter(c => c.startsWith(arg)).map(fixAutcompleteSuffix);
      }
      return [];
    }
  }
  return [];
}
