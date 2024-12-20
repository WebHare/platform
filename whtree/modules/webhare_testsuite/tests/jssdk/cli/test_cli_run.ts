
import { intOption, enumOption, floatOption, parse, run, CLIRuntimeError } from "@webhare/cli/src/run";
import * as test from "@webhare/test-backend";

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

  test.eq({
    cmd: undefined,
    args: { file: "a" },
    opts: { verbose: false, withBlabla: "b" },
    specifiedOpts: ["withBlabla"],
    globalOpts: { verbose: false, withBlabla: "b" },
    specifiedGlobalOpts: ["withBlabla"],
  }, parse({
    options: {
      "v,verbose": { default: false, description: "Show verbose output" },
      "with-blabla": { default: "", description: "String param" }
    },
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
    args: {},
    opts: { verbose: true, output: "test", num: 3 },
    specifiedOpts: ["verbose", "output", "num"],
    globalOpts: { verbose: true, output: "test", num: 3 },
    specifiedGlobalOpts: ["verbose", "output", "num"],
  }, parse({
    options: {
      "v,no-verbose,verbose": { default: true, description: "Show verbose output" },
      "output": { default: "", description: "Override output location" },
      "num": { default: 0, description: "Override output location" },
    },
    arguments: [],
  }, ["-v", "--output", "test", "--num", "3"]));

  async function testOptionsParse(args: string[]) {
    const res = parse({
      options: {
        "v,verbose": { default: false, description: "Show verbose output" },
        "a,all": { default: true, description: "Show all" }
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
    options: {
      "a": { default: false },
      "b": { default: false },
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
    options: {
      "a": { default: "" },
      "b": { default: false },
      "c": { default: false },
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
    args: { f1: "a" },
    opts: { v: true, a: true },
    specifiedOpts: ["v", "a"],
    globalOpts: { v: true },
    specifiedGlobalOpts: ["v"],
  }, parse({
    options: { "v": { default: false } },
    subCommands: {
      "cmd": {
        options: { a: { default: false } },
        arguments: [{ name: "<f1>" }],
      },
      "cmd2": {
        options: { b: { default: false } },
        arguments: [{ name: "<f2>" }],
      },
    }
  }, ["-v", "cmd", "-a", "a"]));

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
}


function dontRun(a: () => void) {
  void a;
}

async function testCLITypes() {
  dontRun(() => {
    {
      const res = parse({
        options: {
          "a": { default: 0, type: intOption({ start: 0, end: 10 }) },
          "b": { default: "a", type: enumOption(["a", "b", "c"]) },
          "c": { default: 0 },
          "d": { default: "aa" },
          "v,verbose": { default: false },
          "all": { default: false },
        },
        arguments: [{ name: "<f1>" }, { name: "[f2]" }, { name: "[f3...]" }],
      }, []);
      void res;

      test.typeAssert<test.Equals<{
        cmd?: undefined;
        args: {
          f1: string;
          f2?: string;
          f3: string[];
        };
        opts: {
          a: number;
          b: "a" | "b" | "c";
          c: number;
          d: string;
          verbose: boolean;
          all: boolean;
        };
        specifiedOpts: Array<"a" | "b" | "c" | "d" | "verbose" | "all">;
        globalOpts: {
          a: number;
          b: "a" | "b" | "c";
          c: number;
          d: string;
          verbose: boolean;
          all: boolean;
        };
        specifiedGlobalOpts: Array<"a" | "b" | "c" | "d" | "verbose" | "all">;
      }, typeof res>>();
    }
    {
      const res = parse({
        options: {},
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
            options: { a: { default: false } },
            arguments: [{ name: "<f1>" }],
          },
          "cmd2": {
            options: { b: { default: false } },
            arguments: [{ name: "<f2>" }],
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
        args: { f2: string };
        opts: { b: boolean };
        specifiedOpts: Array<"b">;
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
  });
}

async function waitRunDone<T extends { onDone?: () => void }>(r: T): Promise<T> {
  await new Promise<void>((resolve) => {
    r.onDone = resolve;
  });
  return r;
}

async function testCLIRun() {
  {
    const res = run({
      name: "test",
      description: "Test command",
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
      options: { "v,verbose": { default: false } },
      subCommands: {
        c: {
          description: "Command c",
          shortDescription: "c",
          options: { a: { default: false } },
          arguments: [{ name: "<f1>" }],
          main(data) {
            test.typeAssert<test.Equals<{ args: { f1: string }; opts: { verbose: boolean; a: boolean }; specifiedOpts: Array<"a" | "verbose">; cmd: "c" }, typeof data>>();
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
  await waitRunDone(run({
    main() { throw new CLIRuntimeError("Test error", { showHelp: true }); }
  }));
  test.eq(1, process.exitCode);
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

test.run([
  testCLIMainParse,
  testCLISubCommandParse,
  testCLITypes,
  testCLIRun,
  testCLIOptionTypes,
]);
