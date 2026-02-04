
import { addConsoleCallback } from "@mod-system/js/internal/whmanager/bridge";
import { intOption, enumOption, floatOption, parse, run, CLIRuntimeError, runAutoComplete, type ParseData } from "@webhare/cli/src/run";
import { parseCommandLine } from "@webhare/cli/src/run-autocomplete";
import { backendConfig } from "@webhare/services";
import * as test from "@webhare/test-backend";
import * as child_process from "node:child_process";

async function testCLIMainParse() {
  test.eq({
    cmd: undefined,
    args: {},
    opts: {},
    specifiedOpts: [],
    globalOpts: {},
    specifiedGlobalOpts: [],
  }, parse({
    options: {},
    arguments: [],
  }, []));

  // After the first argument flags and options are not parsed
  test.throws(/too many arguments/i, () => parse({
    flags: {
      "v,verbose": { default: false, description: "Show verbose output" },
    },
    options: {
      "with-blabla": { default: "", description: "String param" }
    },
    arguments: [{ name: "<file>", description: "The file to process" }],
  }, ["a", "--with-blabla", "b"]));

  // After the first argument flags and options are not parsed when mixedFlags is false
  test.throws(/too many arguments/i, () => parse({
    flags: {
      "v,verbose": { default: false, description: "Show verbose output" },
    },
    mixedFlags: false,
    options: {
      "with-blabla": { default: "", description: "String param" }
    },
    arguments: [{ name: "<file>", description: "The file to process" }],
  }, ["a", "--with-blabla", "b"]));

  // Flags and options are parsed after the first argument when mixedFlags is true
  test.eq({
    cmd: undefined,
    args: { file: "a" },
    opts: { verbose: false, withBlabla: "b" },
    specifiedOpts: ["withBlabla"],
    globalOpts: { verbose: false, withBlabla: "b" },
    specifiedGlobalOpts: ["withBlabla"],
  }, parse({
    flags: {
      "v,verbose": { default: false, description: "Show verbose output" },
    },
    options: {
      "with-blabla": { default: "", description: "String param" }
    },
    mixedFlags: true,
    arguments: [{ name: "<file>", description: "The file to process" }],
  }, ["a", "--with-blabla", "b"]));


  test.eq({
    cmd: undefined,
    args: { file: "a" },
    opts: {},
    specifiedOpts: [],
    globalOpts: {},
    specifiedGlobalOpts: [],
  }, parse({
    arguments: [{ name: "[file]", description: "Optional arg" }],
  }, ["a"]));

  test.eq({
    cmd: undefined,
    args: { arg: "a" },
    opts: { verbose: true, output: "test", num: 3 },
    specifiedOpts: ["verbose", "output", "num"],
    globalOpts: { verbose: true, output: "test", num: 3 },
    specifiedGlobalOpts: ["verbose", "output", "num"],
  }, parse({
    flags: {
      "v,no-verbose,verbose": { default: true, description: "Show verbose output" },
    },
    options: {
      "output": { default: "", description: "Override output location" },
      "num": { default: 0, description: "Override output location", type: intOption() },
    },
    arguments: [{ name: "[arg]", type: enumOption(["a", "b", "c"]), }],
  }, ["-v", "--output", "test", "--num", "3", "a"]));

  async function testOptionsParse(args: string[]) {
    const res = parse({
      flags: {
        "v,verbose": { default: false, description: "Show verbose output" },
        "a,all": { default: true, description: "Show all" }
      },
      options: {
      },
      arguments: [],
    }, args);
    return ((res.opts as Record<string, unknown>).verbose ? "v" : "") + ((res.opts as Record<string, unknown>).all ? "a" : "");
  }

  test.eq("a", await testOptionsParse([]));
  test.eq("va", await testOptionsParse(["-va"]));

  test.eq({
    cmd: undefined,
    args: { file: "-b" },
    opts: { a: true, b: false },
    specifiedOpts: ["a"],
    globalOpts: { a: true, b: false },
    specifiedGlobalOpts: ["a"],
  }, parse({
    flags: {
      "a": { default: false },
      "b": { default: false },
    },
    options: {
    },
    arguments: [{ name: "[file]" }],
  }, ["-a", "--", "-b"]));

  test.eq({
    cmd: undefined,
    args: {},
    opts: { a: "--", b: true, c: false },
    specifiedOpts: ["a", "b"],
    globalOpts: { a: "--", b: true, c: false },
    specifiedGlobalOpts: ["a", "b"],
  }, parse({
    flags: {
      "b": { default: false },
      "c": { default: false },
    },
    options: {
      "a": { default: "" },
    },
    arguments: [{ name: "[file]" }],
  }, ["-a", "--", "-b"]));

  test.eq({
    cmd: undefined,
    args: { a: "a", c: [], d: "b" },
    opts: {},
    specifiedOpts: [],
    globalOpts: {},
    specifiedGlobalOpts: [],
  }, parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "[c...]" }, { name: "<d>" },],
  }, ["a", "b"]));

  test.eq({
    cmd: undefined,
    args: { a: "a", b: "b", c: ["c", "d", "e"], d: "f" },
    opts: {},
    specifiedOpts: [],
    globalOpts: {},
    specifiedGlobalOpts: [],
  }, parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "[c...]" }, { name: "<d>" },],
  }, ["a", "b", "c", "d", "e", "f"]));

  test.throws(/Required argument "c" cannot be placed between optional arguments/, () => parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "<c>" }, { name: "[d]" }],
  }, []));

  test.throws(/Optional argument "c" cannot follow a rest argument/, () => parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b...]" }, { name: "[c]" }],
  }, []));

  test.throws(/Argument "a" is specified twice/, () => parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[a...]" }],
  }, []));
}

async function testCLISubCommandParse() {
  test.throws(/No subcommand specified/, () => parse({
    options: {},
    subCommands: {
      "cmd": {
        options: {},
        arguments: [],
      },
    }
  }, []));

  test.eq({
    cmd: "cmd",
    args: {},
    opts: {},
    specifiedOpts: [],
    globalOpts: {},
    specifiedGlobalOpts: [],
  }, parse({
    options: {},
    subCommands: {
      "cmd": {
        options: {},
        arguments: [],
      },
    }
  }, ["cmd"]));

  test.eq({
    cmd: "cmd",
    args: { f1: "a", f2: "b" },
    opts: { v: true, a: true },
    specifiedOpts: ["v", "a"],
    globalOpts: { v: true },
    specifiedGlobalOpts: ["v"],
  }, parse({
    flags: { "v": { default: false } },
    subCommands: {
      "cmd": {
        flags: { a: { default: false } },
        arguments: [{ name: "<f1>" }, { name: "<f2>" }],
      },
      "cmd2": {
        flags: { b: { default: false } },
        arguments: [{ name: "<f3>" }],
      },
    }
  }, ["-v", "cmd", "-a", "a", "b"]));

  test.eq({
    cmd: undefined,
    args: {},
    opts: {},
    specifiedOpts: [],
    globalOpts: {},
    specifiedGlobalOpts: [],
  }, parse({
    name: "test",
    description: "Test command",
    options: {},
    arguments: [],
    main() { }
  }, []));

  test.throws(/Illegal value "d" specified for argument "f1"/, () => parse({
    arguments: [{ name: "<f1>", type: enumOption(["a", "b", "c"]) }]
  }, ["d"]));

  test.eq({
    cmd: undefined,
    args: {},
    opts: { a: [], b: ["a"], c: [], d: [3] },
    specifiedOpts: [],
    globalOpts: { a: [], b: ["a"], c: [], d: [3] },
    specifiedGlobalOpts: [],
  }, parse({
    options: {
      a: { multiple: true },
      b: { default: ["a"], multiple: true },
      c: { multiple: true, type: intOption() },
      d: { default: [3], multiple: true, type: intOption() },
    },
    flags: {},
  }, []));

  test.eq({
    cmd: undefined,
    args: {},
    opts: { a: ["1", "2"], b: ["1", "2"], c: [1, 2], d: [1, 2] },
    specifiedOpts: ["a", "b", "c", "d"],
    globalOpts: { a: ["1", "2"], b: ["1", "2"], c: [1, 2], d: [1, 2] },
    specifiedGlobalOpts: ["a", "b", "c", "d"],
  }, parse({
    options: {
      a: { multiple: true },
      b: { default: ["a"], multiple: true },
      c: { multiple: true, type: intOption() },
      d: { default: [3], multiple: true, type: intOption() },
    },
    flags: {},
  }, ["-a", "1", "-a", "2", "-b", "1", "-b", "2", "-c", "1", "-c", "2", "-d", "1", "-d", "2"]));

  test.eq({
    cmd: undefined,
    args: {},
    opts: { aa: ["1", "2"], bb: ["1", "2"], cc: [1, 2], dd: [1, 2] },
    specifiedOpts: ["aa", "bb", "cc", "dd"],
    globalOpts: { aa: ["1", "2"], bb: ["1", "2"], cc: [1, 2], dd: [1, 2] },
    specifiedGlobalOpts: ["aa", "bb", "cc", "dd"],
  }, parse({
    options: {
      aa: { multiple: true },
      bb: { default: ["a"], multiple: true },
      cc: { multiple: true, type: intOption() },
      dd: { default: [3], multiple: true, type: intOption() },
    },
    flags: {},
  }, ["--aa", "1", "--aa", "2", "--bb", "1", "--bb", "2", "--cc", "1", "--cc", "2", "--dd", "1", "--dd", "2"]));

}


function dontRun(a: () => void) {
  void a;
}

async function testCLITypes() {
  dontRun(() => {
    {
      const res = parse({
        flags: {
          "v,verbose": { default: false },
          "all": { default: false },
        },
        options: {
          "a": { default: 0, type: intOption({ start: 0, end: 10 }) },
          "b": { default: "a", type: enumOption(["a", "b", "c"]) },
          "d": { default: "aa" },
          "e": { type: intOption({ start: 0, end: 10 }) },
        },
        arguments: [{ name: "<f1>", type: enumOption(["x"]) }, { name: "[f2]" }, { name: "[f3...]" }],
      }, []);
      void res;

      test.typeAssert<test.Equals<{
        cmd?: undefined;
        args: {
          f1: "x";
          f2?: string;
          f3: string[];
        };
        opts: {
          a: number;
          b: "a" | "b" | "c";
          d: string;
          e?: number;
          verbose: boolean;
          all: boolean;
        };
        specifiedOpts: Array<"a" | "b" | "d" | "e" | "verbose" | "all">;
        globalOpts: {
          a: number;
          b: "a" | "b" | "c";
          d: string;
          e?: number;
          verbose: boolean;
          all: boolean;
        };
        specifiedGlobalOpts: Array<"a" | "b" | "d" | "e" | "verbose" | "all">;
      }, typeof res>>();
    }
    {
      const res = parse({
        options: {},
        flags: {},
        arguments: [{ name: "[f2]" }],
      }, []);
      void res;

      test.typeAssert<test.Equals<{
        cmd?: undefined;
        args: {
          f2?: string;
        };
        opts: object;
        specifiedOpts: never[];
        globalOpts: object;
        specifiedGlobalOpts: never[];
      }, typeof res>>();
    }

    {
      const res = parse({
        options: {},
        subCommands: {
          "cmd": {
            flags: { a: { default: false } },
            arguments: [{ name: "<f1>" }],
          },
          "cmd2": {
            flags: { b: { default: false } },
            options: { s: {}, m: { multiple: true, description: "16" } },
            arguments: [{ name: "<f2>", type: enumOption(["y"]) }],
          },
          "cmd3": {
            options: {},
            arguments: [],
          },
        }
      }, ["-v", "cmd", "-a"]);
      void res;

      test.typeAssert<test.Equals<{
        cmd: "cmd";
        args: { f1: string };
        opts: { a: boolean };
        specifiedOpts: Array<"a">;
        globalOpts: object;
        specifiedGlobalOpts: never[];
      } | {
        cmd: "cmd2";
        args: { f2: "y" };
        opts: { b: boolean; s?: string; m: string[] };
        specifiedOpts: Array<"b" | "s" | "m">;
        globalOpts: object;
        specifiedGlobalOpts: never[];
      } | {
        cmd: "cmd3";
        args: object;
        opts: object;
        specifiedOpts: never[];
        globalOpts: object;
        specifiedGlobalOpts: never[];
      }, typeof res>>();
    }

    {
      const res = parse({
        flags: { a: "description-a" },
        options: { b: "description-b" },
        subCommands: {
          "cmd": {
            flags: { c: "description-c" },
            options: { d: "description-d" },
          },
        }
      }, ["-v", "cmd", "-a"]);
      void res;

      test.typeAssert<test.Equals<{
        cmd: "cmd";
        args: object;
        opts: { a: boolean; c: boolean; b?: string; d?: string };
        specifiedOpts: Array<"a" | "b" | "c" | "d">;
        globalOpts: { a: boolean; b?: string };
        specifiedGlobalOpts: Array<"a" | "b">;
      }, typeof res>>();
    }

    {
      const res = parse({
        options: {
          a: { multiple: true },
          b: { default: ["a"], multiple: true },
          c: { default: 3, type: intOption() },
          d: { default: [3], multiple: true, type: intOption() },
        }
      }, []);
      void res;

      test.typeAssert<test.Equals<{
        cmd?: undefined;
        args: object;
        opts: { a: string[]; b: string[]; c: number; d: number[] };
        specifiedOpts: Array<"a" | "b" | "c" | "d">;
        globalOpts: { a: string[]; b: string[]; c: number; d: number[] };
        specifiedGlobalOpts: Array<"a" | "b" | "c" | "d">;
      }, typeof res>>();
    }

    parse({
      // @ts-expect-error default has the wrong type
      options: { a: { type: intOption({ start: 0, end: 10 }), default: "a" } },
    }, []);

    parse({
      options: {
        a: {
          // @ts-expect-error default has the wrong type
          default: true,
        },
        c: {
          // @ts-expect-error default has the wrong type
          default: "a",
          multiple: true,
        },
        d: {
          // @ts-expect-error default has the wrong type
          default: 3,
          type: intOption(),
          multiple: true,
        },
      }, flags: {
        b: {
          // @ts-expect-error default has the wrong type
          default: "a",
        },
      }
    }, []);
  });
}

async function waitRunDone<T extends { onDone?: () => void }>(r: T): Promise<{ data: T; output: string }> {
  let output = "";
  using ref = addConsoleCallback((data) => output += data);
  void ref;
  await new Promise<void>((resolve) => {
    r.onDone = resolve;
  });
  return { data: r, output };
}

async function testCLIRun() {
  {
    const res = run({
      name: "test",
      description: "Test command",
      flags: {},
      options: {},
      arguments: [],
      main(data) {
        test.typeAssert<test.Equals<{ args: object; opts: object; specifiedOpts: never[]; cmd?: undefined }, typeof data>>();
        test.eq({ args: {}, opts: {}, specifiedOpts: [], cmd: undefined }, data);
        test.typeAssert<test.Equals<{ onDone?: () => void; globalOpts: object; specifiedGlobalOpts: never[] }, typeof res>>();
        test.eqPartial({ globalOpts: {}, specifiedGlobalOpts: [] }, res);
      }
    }, { argv: [] });
    await waitRunDone(res);
  }
  {
    const res = run({
      name: "test",
      description: "Test command",
      flags: { "v,verbose": { default: false } },
      subCommands: {
        c: {
          description: "Command c",
          shortDescription: "c",
          flags: { a: {} },
          options: { s: {} },
          arguments: [{ name: "<f1>" }],
          main(data) {
            test.typeAssert<test.Equals<{ args: { f1: string }; opts: { verbose: boolean; a: boolean; s?: string }; specifiedOpts: Array<"a" | "s" | "verbose">; cmd: "c" }, typeof data>>();
            test.eq({ args: { f1: "a" }, opts: { a: true, verbose: false }, specifiedOpts: ["a"], cmd: "c" }, data);
            test.typeAssert<test.Equals<{ onDone?: () => void; globalOpts: { verbose: boolean }; specifiedGlobalOpts: Array<"verbose"> }, typeof res>>();
            test.eqPartial({ globalOpts: { verbose: false }, specifiedGlobalOpts: [] }, res);
          }
        }
      }
    }, { argv: ["c", "-a", "a"] });
    await waitRunDone(res);
  }

  // STORY: test CLIRuntimeError handling
  // TODO: intercept console.log and check for output
  test.eq(0, process.exitCode ?? 0);
  {
    const { output } = await waitRunDone(run({
      options: { a: "option-a", b: { description: "option-b" } },
      flags: { v: "flag-v", w: { description: "flag-w" } },
      main() { throw new CLIRuntimeError("Test error", { showHelp: true }); }
    }));

    test.eq(1, process.exitCode);
    test.eq(`Error: Test error

Options:
  -a                    option-a
  -b                    option-b
  -v                    flag-v
  -w                    flag-w
`, output);
  }
  await waitRunDone(run({
    main() { throw new CLIRuntimeError("Test error", { exitCode: 2 }); }
  }));
  test.eq(2, process.exitCode);
  await waitRunDone(run({
    main() { throw new CLIRuntimeError("", {}); }
  }));
  test.eq(2, process.exitCode);
  process.exitCode = 0;
}

async function testCLIOptionTypes() {
  test.throws(/s/, () => intOption().parseValue("s", { argName: "a" }));
  test.throws(/1.0/, () => intOption().parseValue("1.0", { argName: "a" }));
  test.throws(/11132143423432434343/, () => intOption().parseValue("11132143423432434343", { argName: "a" }));
  test.throws(/-11132143423432434343/, () => intOption().parseValue("-11132143423432434343", { argName: "a" }));
  test.eq(3, intOption().parseValue("3", { argName: "a" }));
  test.eq(-3, intOption().parseValue("-3", { argName: "a" }));
  test.throws(/0/, () => intOption({ start: 1 }).parseValue("0", { argName: "a" }));
  test.throws(/4/, () => intOption({ start: 1, end: 3 }).parseValue("4", { argName: "a" }));

  test.throws(/s/, () => floatOption().parseValue("s", { argName: "a" }));
  test.eq(1.01, floatOption().parseValue("1.01", { argName: "a" }));
  test.eq(11132143423432434000, floatOption().parseValue("11132143423432434343", { argName: "a" }));
  test.eq(3, floatOption().parseValue("3", { argName: "a" }));
  test.throws(/0/, () => floatOption({ start: 1 }).parseValue("0", { argName: "a" }));
  test.throws(/4/, () => floatOption({ start: 1, end: 3 }).parseValue("4", { argName: "a" }));

  test.throws(/s/, () => enumOption(["a", "b"]).parseValue("s", { argName: "a" }));
  test.eq("a", enumOption(["a", "b"]).parseValue("a", { argName: "a" }));
  test.eq(/off/, enumOption(["on", "off"]).parseValue("off", { argName: "a" })); // want a did you mean?
}

async function testCLIAutoCompletion() {
  // STORY: test auto completion

  const mockData: ParseData = {
    name: "testcli",
    description: "Test CLI",
    flags: {
      "verbose,v": {
        description: "Enable verbose mode",
        default: false,
      },
    },
    options: {
      "output,o": {
        description: "Output file",
        type: {
          parseValue: (arg: string) => arg,
          autoComplete: (arg: string) => ["file1.txt", "file2.txt"],
        },
      },
      "1by1": {
        description: "Parameter revealing one-by-one",
        type: {
          parseValue: (arg: string) => arg,
          autoComplete: (arg: string) => ["123456789".substring(0, arg.length + 1) + "*"],
        },
      }
    },
    subCommands: {
      "check": {
        description: "Check stuff",
        arguments: [
          {
            name: "<stuff...>",
            description: "Stuff to check",
            type: {
              parseValue: (arg: string) => arg,
              autoComplete: (arg: string) => arg.startsWith("sub:") ? ["sub:123", "sub:456"] : ["sub:*"],
            },
          }
        ],
        async main({ args: { stuff } }: { args: { stuff: string[] } }) { //TODO shouldn't args.assetpacks be inferred? wh assetpack seems to do it in practice
          stuff satisfies string[];
        }
      },
      "convert": {
        description: "Convert files",
        options: {
          "format,f": {
            description: "Output format",
            type: enumOption(["json", "xml"]),
          },
        },
        arguments: [
          {
            name: "<source>",
            description: "Source file",
            type: {
              parseValue: (arg: string) => arg,
              autoComplete: (arg: string) => ["source1.txt", "source2.txt"],
            },
          },
          {
            name: "[destination]",
            description: "Destination file",
            type: {
              parseValue: (arg: string) => arg,
              autoComplete: (arg: string, opts: { cwd: string }) => opts.cwd === "/" ? ["dest1.txt", "dest2.txt"] : ["dest3.txt", "dest4.txt"]
            },
          },
        ],
      },
    },
  };

  const cwd = "/";

  // Autocomplete options
  test.eq(["--1by1\n", "--output\n", "--verbose\n", "-o\n", "-v\n"], await runAutoComplete(mockData, ["-"], { cwd }));
  test.eq(["--output\n"], await runAutoComplete(mockData, ["--o"], { cwd }));
  test.eq(["-o\n"], await runAutoComplete(mockData, ["-o"], { cwd }));
  test.eq(["--output=file1.txt\n", "--output=file2.txt\n"], await runAutoComplete(mockData, ["--output="], { cwd }));
  test.eq(["--output=file1.txt\n", "--output=file2.txt\n"], await runAutoComplete(mockData, ["--output=f"], { cwd }));
  test.eq(["--output=file1.txt\n", "--output=file2.txt\n"], await runAutoComplete(mockData, ["--output=file"], { cwd }));

  // Autocomplete partial options
  test.eq(["--1by1=1234"], await runAutoComplete(mockData, ["--1by1=123"], { cwd }));
  test.eq(["--1by1=12345"], await runAutoComplete(mockData, ["--1by1=1234"], { cwd }));

  // Autocomplete subcommands
  test.eq(["check\n", "convert\n"], await runAutoComplete(mockData, [""], { cwd }));
  test.eq(["convert\n"], await runAutoComplete(mockData, ["con"], { cwd }));
  test.eq(["convert\n"], await runAutoComplete(mockData, ["convert"], { cwd }));

  // Autocomplete subcommand options
  test.eq(["--1by1\n", "--format\n", "--output\n", "--verbose\n", "-f\n", "-o\n", "-v\n"], await runAutoComplete(mockData, ["convert", "-"], { cwd }));
  test.eq(["--1by1\n", "--format\n", "--output\n", "--verbose\n"], await runAutoComplete(mockData, ["convert", "--"], { cwd }));
  test.eq(["--format\n"], await runAutoComplete(mockData, ["convert", "--f"], { cwd }));
  test.eq(["-f\n"], await runAutoComplete(mockData, ["convert", "-f"], { cwd }));
  test.eq(["--format=json\n", "--format=xml\n"], await runAutoComplete(mockData, ["convert", "--format="], { cwd }));
  test.eq(["--format=json\n"], await runAutoComplete(mockData, ["convert", "--format=j"], { cwd }));

  //Lists
  test.eq(["sub:"], await runAutoComplete(mockData, ["check", "sub:123", "sub"], { cwd }));
  test.eq(["sub:123\n", "sub:456\n"], await runAutoComplete(mockData, ["check", "sub:123", "sub:"], { cwd }));

  // Autocomplete arguments
  test.eq(["source1.txt\n", "source2.txt\n"], await runAutoComplete(mockData, ["convert", "source"], { cwd }));
  test.eq(["dest1.txt\n", "dest2.txt\n"], await runAutoComplete(mockData, ["convert", "source1.txt", "dest"], { cwd }));
  test.eq(["dest3.txt\n", "dest4.txt\n"], await runAutoComplete(mockData, ["convert", "source1.txt", "dest"], { cwd: "/other/" }));

  // Handle unknown options
  test.eq([] as string[], await runAutoComplete(mockData, ["--unknown"], { cwd }));
  test.eq([], await runAutoComplete(mockData, ["convert", "--unknown"], { cwd }));

  // Handle empty input
  test.eq([], await runAutoComplete(mockData, [], { cwd }));

  // Handle option terminator
  test.eq(["source1.txt\n", "source2.txt\n"], await runAutoComplete(mockData, ["--", "convert", ""], { cwd }));
  test.eq([], await runAutoComplete(mockData, ["--", "convert", "-"], { cwd }));

  // Edge cases
  test.eq(["file1.txt\n", "file2.txt\n"], await runAutoComplete(mockData, ["--output", ""], { cwd }));
  test.eq(["--format=json\n", "--format=xml\n"], await runAutoComplete(mockData, ["convert", "--format="], { cwd }));
  test.eq(["dest1.txt\n", "dest2.txt\n"], await runAutoComplete(mockData, ["convert", "source1.txt", ""], { cwd }));
  test.eq(["--output=file1.txt\n", "--output=file2.txt\n"], await runAutoComplete(mockData, ["--output=file"], { cwd }));
  test.eq(["json\n"], await runAutoComplete(mockData, ["convert", "--format", "j"], { cwd }));
}

function testAutoCompleteCommandLineParsing() {
  // Basic cases
  test.eq(["a"], parseCommandLine(`a`));
  test.eq(["a", "b"], parseCommandLine(`a b`));
  test.eq(["a", "b", "c"], parseCommandLine(`a b c`));

  // Quoted strings
  test.eq(["a", "b c"], parseCommandLine(`a "b c"`));
  test.eq(["a", "b c"], parseCommandLine(`a 'b c'`));
  test.eq(["a", "b", "c d"], parseCommandLine(`a b "c d"`));
  test.eq(["a", "b", "c d"], parseCommandLine(`a b 'c d'`));

  // Escaped characters
  test.eq(["a", "b c"], parseCommandLine(`a b\\ c`));
  test.eq(["a", "b\"c"], parseCommandLine(`a b\\"c`));
  test.eq(["a", "b'c"], parseCommandLine(`a b\\'c`));

  // Mixed quotes and escapes
  test.eq(["a", "b c", "d"], parseCommandLine(`a "b c" d`));
  test.eq(["a", "b c", "d"], parseCommandLine(`a 'b c' d`));
  test.eq(["a", "b\"c", "d"], parseCommandLine(`a "b\\"c" d`));
  test.eq(["a", "b\\c d"], parseCommandLine(`a 'b\\'c' d`));

  // Nested quotes
  test.eq(["a", "b'c"], parseCommandLine(`a "b'c"`));
  test.eq(["a", 'b"c'], parseCommandLine(`a 'b"c'`));

  // Escaped quotes within quotes
  test.eq(["a", "b\"c"], parseCommandLine(`a "b\\"c"`));
  test.eq(["a", "b\\c"], parseCommandLine(`a 'b\\'c'`));

  // Empty strings
  test.eq(["a", ""], parseCommandLine(`a ""`));
  test.eq(["a", ""], parseCommandLine(`a ''`));

  // Complex cases
  test.eq(["a", "b c", "d e f"], parseCommandLine(`a "b c" "d e f"`));
  test.eq(["a", "b c", "d e f"], parseCommandLine(`a 'b c' 'd e f'`));
  test.eq(["a", "b c", "d e f"], parseCommandLine(`a "b c" 'd e f'`));
  test.eq(["a", "b c", "d e f"], parseCommandLine(`a 'b c' "d e f"`));
}



async function runWHAutoComplete(line: string, point?: number) {
  const env: Record<string, string> = { ...process.env, COMP_LINE: line };
  if (point !== undefined) {
    env.COMP_POINT = point.toString();
  }
  const subProcess = child_process.spawn(backendConfig.installationRoot + "/bin/wh", ["__autocomplete_wh"], {
    stdio: ['ignore', 'pipe', 'pipe'],  //no STDIN, we catch the reset
    detached: true, //separate process group so a terminal CTRL+C doesn't get sent to our subs (And we get to properly shut them down)
    env,
  });

  let output = "";

  const result = Promise.withResolvers<{ code: number | null; output: string }>();

  subProcess.stdout!.on('data', data => output += data);
  subProcess.on("exit", (code, signal) => result.resolve({ code, output }));
  subProcess.on("error", err => result.reject(err));

  return await result.promise;
}

async function testWHAutoComplete() {
  test.eq({ code: 0, output: "assetpack \n" }, await runWHAutoComplete(`wh assetpack`));
  test.eq({ code: 0, output: "autocompile \n" }, await runWHAutoComplete(`wh assetpack au`));
  test.eq({ code: 0, output: "compile \n" }, await runWHAutoComplete(`wh assetpack compile`));
  test.eq({ code: 0, output: /platform:/ }, await runWHAutoComplete(`wh assetpack compile `));
  test.eq({ code: 0, output: "authormode \n" }, await runWHAutoComplete(`wh assetpack compile platform:aut`));
  // ':' is a word seperator when autocompleting, so only content after that should be returned
  test.eq({ code: 0, output: "system/scripts/whcommands/assetpack.ts \n" }, await runWHAutoComplete(`wh run mod::system/scripts/whcommands/asset`));
  test.eq({ code: 0, output: "autocompile \n" }, await runWHAutoComplete(`wh run mod::system/scripts/whcommands/assetpack.ts au`));
}

test.runTests([
  testCLIMainParse,
  testCLISubCommandParse,
  testCLITypes,
  testCLIRun,
  testCLIOptionTypes,
  testCLIAutoCompletion,
  testAutoCompleteCommandLineParsing,
  testWHAutoComplete,
]);
