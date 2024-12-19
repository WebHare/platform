import { getBestMatch } from "@webhare/js-api-tools";

/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
/// Type that can be returned by main() functions
type CommandReturn = void | number | Promise<void> | Promise<number>;

export class CLIError extends Error {
  constructor(message: string, public command?: string) {
    super(message);
  }
};

export class CLISyntaxError extends CLIError {
};

export class CLIConfigError extends CLIError {
};

export class CLIRuntimeError extends CLIError {
  constructor(message: string, public options: { exitCode?: number; showHelp?: boolean; command?: string } = {}) {
    super(message, options.command);
  }
}

export interface CLIArgumentFormat<ValueType> {
  /** Parses a user-provided value. Throws CLISyntaxError. Required to allow typeinference to work. */
  parseValue(arg: string, options: { argName: string; command?: string }): ValueType;
  autoComplete?(arg: string, options: { argName: string; command?: string }): string[];
  description?: string;
}

/** Type of options - with formatter or without. Options with formatter can have any default, but the
 * default will be coerced to the type of the formatter. All options take an argument, except boolean options
 * without formatter.
 */
type OptionsTemplate = {
  default: unknown;
  description?: string;
  format: CLIArgumentFormat<unknown>;
} | {
  default: string | boolean | number;
  description?: string;
  format?: never;
};

/** An arguments, with an optional formatter */
type Argument<J> = {
  name: `<${string}>` | `[${string}]` | `[${string}...]` | `<${string}...>`;
  description?: string;
  format?: CLIArgumentFormat<J>;
};

type SubCommandTemplate = {
  shortDescription?: string;
  description?: string;
  options?: Record<string, OptionsTemplate>;
  arguments?: [...Array<Argument<unknown>>];
  main?: unknown;
};

type ParseData = {
  name?: string;
  description?: string;
  options?: object; // validated by sanitization
  arguments?: Array<Argument<unknown>>; // validated by sanitization
  subCommands?: never;
  main?: unknown;
} | {
  name?: string;
  description?: string;
  options?: object; // validated by santization
  arguments?: Array<Argument<unknown>>;
  subCommands?: Record<string, SubCommandTemplate>;
};

type OptArgBase = {
  options?: Record<string, OptionsTemplate>;
  arguments?: Array<Argument<unknown>>;
  subCommands?: Record<string, SubCommandTemplate>;
};

/// Widens default literals to their base type. Needed because we infer the types of options 'as const' and we return the wider type (for options without formatter).
type WidenDefaultLiteral<T> = T extends boolean ? boolean : T extends string ? string : T extends number ? number : T;

// Ensures the defaults of options with formatter are compatible with the return type of the formatter.
type SanitizeOptions<Options extends Record<string, OptionsTemplate>> = { [Key in keyof Options]: Simplify<Omit<Options[Key], "default"> & { default: GetParsedFormat<Options[Key], WidenDefaultLiteral<Options[Key]["default"]>> }> };

/// Sanitizes the options and arguments of subcommands
type SanitizeSubCommandOptArgs<SubCommands extends Record<string, SubCommandTemplate>> = { [Key in keyof SubCommands]: SanitizeOptArgs<SubCommands[Key]> & SubCommandTemplate };

/// Sanitizes a single argument. FIXME: probably not needed, see if validation of arguments is ok
type SanitizeArgument<ThisArgument extends Argument<any>> = ThisArgument; // extends { format: CLIArgumentFormat<any> } ? ThisArgument : ThisArgument extends { format?: any } ? Omit<ThisArgument, "format"> & { format: CLIArgumentFormat<any> } : ThisArgument;
type SanitizeArguments<Arguments extends Array<Argument<any>>> = Arguments extends [infer FirstArgument extends Argument<any>, ...infer RestArguments extends Array<Argument<any>>] ? [SanitizeArgument<FirstArgument>, ...SanitizeArguments<RestArguments>] : [];

/// Sanitize the options and arguments of a record, and subcommands if present
type SanitizeOptArgs<O extends OptArgBase> =
  (O extends { options: {} } ? {
    options: SanitizeOptions<O["options"]>;
  } : {}) &
  (O extends { arguments: {} } ? {
    arguments: SanitizeArguments<O["arguments"]>;
  } : {}) &
  (O extends { subCommands: {} } ? {
    subCommands: SanitizeSubCommandOptArgs<O["subCommands"]>;
  } : {});

/// Returns the type a formatter returns
type GetFormatterType<O extends { format: CLIArgumentFormat<any> }> = ReturnType<O["format"]["parseValue"]>;

/// Determine the type of an argument (taking the formatter into account)
type TypeOfArgument<A extends Argument<unknown>> = A["name"] extends `<${string}...>` | `[${string}...]` ? Array<GetParsedFormat<A, string>> : GetParsedFormat<A, string>;

/// Determine the name of an argument (stripping `...`, `[]` and `<>`)
type NameOfArgument<A extends Argument<unknown>> = A["name"] extends `[${infer S}...]` ? S : A["name"] extends `<${infer S2}...>` ? S2 : A["name"] extends `[${infer S}]` ? S : A["name"] extends `<${infer S}>` ? S : never;

/// Get the parsed format for an option or an argument. Simplify<> is needed to work around some weird stuff in the TS compiler. `O extends object` doesn't seem to work here?
type GetParsedFormat<O extends object, Default> = Simplify<O> extends { readonly format: CLIArgumentFormat<any> } ? GetFormatterType<Simplify<O>> : Default;

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

/// Calculate the resulting values record for options
type OptionsResult<Options extends Record<string, OptionsTemplate>> = Simplify<{ -readonly [Key in keyof Options & string as GetOptionListStoreName<Key>]: GetParsedFormat<Options[Key], WidenDefaultLiteral<Options[Key]["default"]>> } & object>;

/// Calculate the resulting values record for arguments
type ArgumentsResult<Arguments extends ReadonlyArray<Argument<unknown>>> = [Arguments] extends [never[]] ? object : Simplify<
  { [ThisArgument in (Arguments[number]) as ThisArgument["name"] extends `<${string}>` | `[${string}...]` | `[${string}...]` ? NameOfArgument<ThisArgument> : never]: TypeOfArgument<ThisArgument> } &
  { [ThisArgument in (Arguments[number]) as ThisArgument["name"] extends `[${string}]` ? NameOfArgument<ThisArgument> : never]?: TypeOfArgument<ThisArgument> }
>;

/// Calculate the resulting values record for main functions
type MainData<Rec extends OptArgBase, Cmd extends string | null = null, ExtraOpts extends OptArgBase | null = null> = Simplify<{
  args: NarrowTruthy<ArgumentsResult<Rec["arguments"] & OptArgBase["arguments"] & {}>>;
  opts: NarrowTruthy<Simplify<OptionsResult<Rec["options"] & {}> & (ExtraOpts extends object ? OptionsResult<ExtraOpts["options"] & object> : object)>>;
  specifiedOpts: Array<keyof Simplify<OptionsResult<Rec["options"] & {}> & (ExtraOpts extends object ? OptionsResult<ExtraOpts["options"] & object> : object)>>;
} & (Cmd extends string ? { cmd: Cmd } : { cmd?: undefined })>;

/// Calculates the data for run() functions
type GlobalData<Rec extends OptArgBase> = {
  globalOpts: NarrowTruthy<Simplify<OptionsResult<Rec["options"] & {}>>>;
  specifiedGlobalOpts: Array<keyof Simplify<OptionsResult<Rec["options"] & {}>>>;
};

/// Build the declarations for the main functions
type MainDeclarations<Rec extends OptArgBase, Cmd extends string | null = null, ExtraOpts extends OptArgBase | null = null> =
  (Simplify<Rec> extends { subCommands: any } ? {
    subCommands: { [K in keyof Rec["subCommands"] & string]: MainDeclarations<Simplify<Rec>["subCommands"][K], K, Rec> };
  } : {
    main: (data: MainData<Rec, Cmd, ExtraOpts>) => CommandReturn;
  });

/// Infers the type of the options and arguments of a record
type GetRootOptionsArguments<T> = { [K in keyof T & ("options" | "arguments")]: T[K] };

/// Infers the type of the options and arguments of the subcommands of a record
type GetSubCommandOptionsArguments<T> = { [K in keyof T & "subCommands"]: { [C in keyof T[K]]: GetRootOptionsArguments<T[K][C]> } };

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

export function parse<
  const E extends object,
  const S extends object
>(
  data: GetRootOptionsArguments<E> & GetSubCommandOptionsArguments<S> & NoInfer<ParseData & SanitizeOptArgs<E & S>>,
  argv: string[]
): ParseResult<E & S, E & S, null> {
  const parsedOpts: Record<string, unknown> = {};
  const parsedGlobalOpts: Record<string, unknown> = {};
  const parsedArgs: Record<string, unknown> = {};

  const optMap = new Map<string, { storeName: string; isGlobal: boolean; optionRec: OptionsTemplate }>();

  function registerOptions(opts: Record<string, OptionsTemplate>, isGlobal: boolean) {
    for (const [keys, optionRec] of Object.entries(opts)) {
      const storeName = nameToCamelCase(keys.split(",").at(-1)!);
      for (const key of keys.split(",")) {
        optMap.set(key, { storeName, isGlobal, optionRec });
      }
      parsedOpts[storeName] = optionRec.default;
      if (isGlobal)
        parsedGlobalOpts[storeName] = optionRec.default;
    }
  }
  if (data.options)
    registerOptions(data.options as Record<string, OptionsTemplate>, true);

  let command: [string, SubCommandTemplate] | undefined;
  const specifiedOpts: string[] = [];
  const specifiedGlobalOpts: string[] = [];

  let gotArgument = false;
  let gotOptionTerminator = false;
  const argList: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("-") && !gotOptionTerminator) {
      // got an option
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
          const bestMatch = getBestMatch(key, [...optMap.keys()]);
          throw new CLISyntaxError(`Unknown option: ${JSON.stringify(key)}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}` : ``}`, command?.[0]);
        }

        const { storeName, isGlobal, optionRec } = optionRef;
        specifiedOpts.push(storeName);
        if (isGlobal)
          specifiedGlobalOpts.push(storeName);

        let strValue = parts[1];
        if (typeof optionRec.default === "boolean" && !optionRec.format) {
          parsedOpts[storeName] = true;
          if (isGlobal)
            parsedGlobalOpts[storeName] = true;
        } else {
          if (strValue === undefined) {
            if (i + 1 >= argv.length)
              throw new CLISyntaxError(`Option ${JSON.stringify(key)} requires a value`, command?.[0]);
            ++i;
            strValue = argv[i];
          }

          if (!optionRec.format) {
            if (typeof optionRec.default === "string") {
              parsedOpts[storeName] = strValue;
              if (isGlobal)
                parsedGlobalOpts[storeName] = strValue;
            } else if (typeof optionRec.default === "number")
              if (typeof optionRec.default === "number") {
                const parsedNumber = parseFloat(strValue);
                if (isNaN(parsedNumber))
                  throw new CLISyntaxError(`Illegal number ${JSON.stringify(strValue)} specified for option ${JSON.stringify(key)}`, command?.[0]);
                parsedOpts[storeName] = parsedNumber;
                if (isGlobal)
                  parsedGlobalOpts[storeName] = parsedNumber;
              } else
                throw new CLIConfigError(`Option ${JSON.stringify(key)} has a default value of type ${typeof optionRec.default
                  }, and needs a formatter to generate that kind of type`, command?.[0]);
          } else {
            const parsedValue = optionRec.format.parseValue(strValue, { argName: `option ${JSON.stringify(key)}`, command: command?.[0] });
            parsedOpts[storeName] = parsedValue;
            if (isGlobal)
              parsedGlobalOpts[storeName] = parsedValue;
          }
        }
      } else {
        for (let j = 1; j < arg.length; j++) {
          const key = arg[j];
          const optionRef = optMap.get(key);
          if (!optionRef) {
            const bestMatch = getBestMatch(key, [...optMap.keys()]);
            throw new CLISyntaxError(`Unknown option: ${JSON.stringify(key)}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}` : ``}`, command?.[0]);
          }

          const { storeName, isGlobal, optionRec } = optionRef;
          specifiedOpts.push(storeName);
          if (isGlobal)
            specifiedGlobalOpts.push(storeName);

          if (typeof optionRec.default === "boolean" && !optionRec.format) {
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

            if (!optionRec.format) {
              if (typeof optionRec.default === "string") {
                parsedOpts[storeName] = strValue;
                if (isGlobal)
                  parsedGlobalOpts[storeName] = strValue;
              } else if (typeof optionRec.default === "number")
                if (typeof optionRec.default === "number") {
                  const parsedNumber = parseFloat(strValue);
                  if (isNaN(parsedNumber))
                    throw new CLISyntaxError(`Illegal number ${JSON.stringify(strValue)} specified for option ${JSON.stringify(key)}`, command?.[0]);
                  parsedOpts[storeName] = parsedNumber;
                  if (isGlobal)
                    parsedGlobalOpts[storeName] = parsedNumber;
                } else
                  throw new CLIConfigError(`Option ${JSON.stringify(key)} has a default value of type ${typeof optionRec.default}, and needs a formatter to generate that kind of type`, command?.[0]);
            } else {
              const parsedValue = optionRec.format.parseValue(strValue, { argName: `option ${JSON.stringify(key)}`, command: command?.[0] });
              parsedOpts[storeName] = parsedValue;
              if (isGlobal)
                parsedGlobalOpts[storeName] = parsedValue;
            }
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
            throw new CLISyntaxError(`Unknown subcommand: ${JSON.stringify(arg)}${bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}` : ``}`);
          }
          command = [arg, cmdObj];
          if (cmdObj.options)
            registerOptions(cmdObj.options, false);
          continue;
        }
      }
      argList.push(arg);
    }
  }

  if (data.subCommands && !command)
    throw new CLISyntaxError(`No subcommand specified`);

  const cmdArgs = ((command ? command[1].arguments : data.arguments) || []) as Array<Argument<unknown>>;
  const { trailingRequired } = checkArgumentsOrder(cmdArgs, command?.[0]);

  // parse the arguments
  for (const arg of cmdArgs) {
    if (arg.name.endsWith("...>") || arg.name.endsWith("...]")) {
      const name = arg.name.slice(1, -4);
      const minRequired = arg.name.startsWith("<") ? 1 : 0;
      const parsed = argList.length <= trailingRequired ?
        [] :
        argList.splice(0, Math.max(minRequired, argList.length - trailingRequired))
          .map(value => arg.format?.parseValue(value, { argName: `argument ${JSON.stringify(name)}`, command: command?.[0] }) ?? value);
      if (parsed.length < minRequired)
        throw new CLISyntaxError(`Missing required argument: ${name}`, command?.[0]);
      parsedArgs[name] = parsed;
    } else if (arg.name.startsWith("<")) {
      const name = arg.name.slice(1, -1);
      if (!argList.length)
        throw new CLISyntaxError(`Missing required argument: ${name}`, command?.[0]);
      const value = argList.shift()!;
      parsedArgs[name] = arg.format?.parseValue(value, { argName: `argument ${JSON.stringify(name)}`, command: command?.[0] }) ?? value;
    } else if (arg.name.startsWith("[")) {
      const name = arg.name.slice(1, -1);
      const value = argList.length > trailingRequired ? argList.shift() : undefined;
      if (value !== undefined)
        parsedArgs[name] = arg.format?.parseValue(value, { argName: `argument ${JSON.stringify(name)}`, command: command?.[0] }) ?? value;
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
  if (options.error && options.error.message) {
    console.error(`Error: ${options.error.message}`);
    console.error(``);
  }

  if (data.name)
    console.error(`Command: ${data.name}`);
  if (data.description)
    console.error(`Description: ${data.description}`);

  const optionEntries = Object.entries(data.options || {}).sort(([a], [b]) => a.localeCompare(b));
  if (optionEntries.length) {
    console.log(`Options:`);
    for (const [name, option] of optionEntries) {
      console.error(`  ${name.padEnd(40, " ")} ${option.description || ""}`);
    }
  }
  if (data.subCommands) {
    const command = options.command ?? options.error?.command;
    if (command) {
      console.error(`Command: ${command}`);
      const commandRec = data.subCommands[command];

      const cmdOptionEntries = Object.entries(commandRec?.options || {}).sort(([a], [b]) => a.localeCompare(b));
      if (cmdOptionEntries.length) {
        console.log(`  Options:`);
        for (const [name, option] of cmdOptionEntries) {
          console.error(`    ${name.padEnd(40, " ")} ${option.description || ""}`);
        }
      }
      console.log(`  Arguments:`);
      for (const arg of commandRec.arguments || []) {
        console.error(`    ${arg.name.padEnd(40, " ")} ${arg.description || ""}`);
      }
    } else {
      console.log(`Subcommands:`);
      for (const [name, cmd] of Object.entries(data.subCommands).sort(([a], [b]) => a.localeCompare(b))) {
        console.error(`  ${name.padEnd(40, " ")} ${cmd.shortDescription || (cmd.description ? (cmd.description.length > 40 ? cmd.description.slice(0, 37) + "..." : cmd.description) : "")}`);
      }
    }
  } else {
    console.log(`Arguments:`);
    for (const arg of data.arguments || []) {
      console.error(`  ${arg.name.padEnd(40, " ")} ${arg.description || ""}`);
    }
  }
}

export function run<
  const E extends object,
  const S extends object
>(
  data: GetRootOptionsArguments<E> & GetSubCommandOptionsArguments<S> & NoInfer<ParseData & SanitizeOptArgs<E & S> & MainDeclarations<E & S>>,
  options: {
    argv?: string[];
  } = {}
): Simplify<{ onDone?: () => void } & GlobalData<E & S>> {
  type ReturnType = Simplify<{ onDone?: () => void } & GlobalData<E & S>>;
  const runReturn: ReturnType = {
    globalOpts: {},
    specifiedGlobalOpts: []
  } as any;

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
          printHelp(data, { error: e });
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

export function intRange(start?: number, end?: number): CLIArgumentFormat<number> {
  return {
    parseValue(arg, options) {
      const parsed = parseInt(arg);
      if (isNaN(parsed))
        throw new CLISyntaxError(`Illegal integer ${JSON.stringify(arg)} specified for ${options.argName}`, options.command);
      if (start !== undefined && parsed < start)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is smaller than ${start} for ${options.argName}`, options.command);
      if (end !== undefined && parsed > end)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is larger than ${end} for ${options.argName}`, options.command);
      return parsed;
    },
    description: `integer between ${start ?? "-∞"} and ${end ?? "∞"}`,
  };
}

export function floatRange(start?: number, end?: number): CLIArgumentFormat<number> {
  return {
    parseValue(arg, options) {
      const parsed = parseFloat(arg);
      if (isNaN(parsed))
        throw new CLISyntaxError(`Illegal number ${JSON.stringify(arg)} specified for ${options.argName}`, options.command);
      if (start !== undefined && parsed < start)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is smaller than ${start} for ${options.argName}`, options.command);
      if (end !== undefined && parsed > end)
        throw new CLISyntaxError(`Number ${JSON.stringify(arg)} is larger than ${end} for ${options.argName}`, options.command);
      return parsed;
    },
    description: `number between ${start ?? "-∞"} and ${end ?? "∞"}`,
  };
}

// FIXME: type inference doesn't pick up the correct type for the allowedValues array
export function stringEnum<const T extends string>(allowedValues: T[]): CLIArgumentFormat<T> {
  return {
    parseValue(arg, options): T {
      if (!allowedValues.includes(arg as T))
        throw new CLISyntaxError(`Illegal value ${JSON.stringify(arg)} specified for ${options.argName}`, options.command);
      return arg as T;
    },
    description: `one of ${allowedValues.map(s => JSON.stringify(s)).join(", ")}`,
  };
}
