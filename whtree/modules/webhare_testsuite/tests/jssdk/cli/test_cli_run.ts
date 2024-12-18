
import { intRange, parse, stringEnum, run, CLIRuntimeError } from "@webhare/cli/src/run";
import * as test from "@webhare/test-backend";

async function testCLIMainParse() {
  test.eq({
    args: {},
    opts: {},
    cmd: undefined,
    specifiedOpts: [],
  }, parse({
    options: {},
    arguments: [],
  }, []));

  test.eq({
    args: { file: "a" },
    opts: { verbose: false, withBlabla: "b" },
    cmd: undefined,
    specifiedOpts: ["withBlabla"],
  }, parse({
    options: {
      "v,verbose": { default: false, description: "Show verbose output" },
      "with-blabla": { default: "", description: "String param" }
    },
    arguments: [{ name: "<file>", description: "The file to process" }],
  }, ["a", "--with-blabla", "b"]));

  test.eq({
    args: { file: "a" },
    opts: {},
    cmd: undefined,
    specifiedOpts: [],
  }, parse({
    arguments: [{ name: "[file]", description: "Optional arg" }],
  }, ["a"]));

  test.eq({
    args: {},
    opts: { verbose: true, output: "test", num: 3 },
    cmd: undefined,
    specifiedOpts: ["verbose", "output", "num"],
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
    args: { file: "-b" },
    opts: { a: true, b: false },
    cmd: undefined,
    specifiedOpts: ["a"],
  }, parse({
    options: {
      "a": { default: false },
      "b": { default: false },
    },
    arguments: [{ name: "[file]" }],
  }, ["-a", "--", "-b"]));

  test.eq({
    args: {},
    opts: { a: "--", b: true, c: false },
    cmd: undefined,
    specifiedOpts: ["a", "b"],
  }, parse({
    options: {
      "a": { default: "" },
      "b": { default: false },
      "c": { default: false },
    },
    arguments: [{ name: "[file]" }],
  }, ["-a", "--", "-b"]));

  test.eq({
    opts: {},
    args: {
      a: "a",
      c: [],
      d: "b",
    },
    cmd: undefined,
    specifiedOpts: [],
  }, parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "[c...]" }, { name: "<d>" },],
  }, ["a", "b"]));

  test.eq({
    opts: {},
    args: {
      a: "a",
      b: "b",
      c: ["c", "d", "e"],
      d: "f",
    },
    cmd: undefined,
    specifiedOpts: [],
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
    args: {},
    opts: {},
    specifiedOpts: [],
    cmd: "cmd",
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
    args: { f1: "a" },
    opts: { v: true, a: true },
    specifiedOpts: ["v", "a"],
    cmd: "cmd",
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
    args: {},
    opts: {},
    specifiedOpts: [],
    cmd: undefined,
  }, parse({
    name: "test",
    description: "Test command",
    options: {},
    arguments: [],
    main() { }
  }, []));

  test.throws(/Illegal value "d" specified for argument "f1"/, () => parse({
    arguments: [{ name: "<f1>", format: stringEnum(["a", "b", "c"]) }]
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
          "a": { default: 0, format: intRange(0, 10) },
          "b": { default: "a", format: stringEnum(["a", "b", "c"]) },
          "c": { default: 0 },
          "d": { default: "aa" },
          "v,verbose": { default: false },
          "all": { default: false },
        },
        arguments: [{ name: "<f1>" }, { name: "[f2]" }, { name: "[f3...]" }],
      }, []);
      void res;

      test.typeAssert<test.Equals<{
        opts: {
          a: number;
          b: "a" | "b" | "c";
          c: number;
          d: string;
          verbose: boolean;
          all: boolean;
        };
        args: {
          f1: string;
          f2?: string;
          f3: string[];
        };
        specifiedOpts: Array<"a" | "b" | "c" | "d" | "verbose" | "all">;
        cmd?: undefined;
      }, typeof res>>();
    }
    {
      const res = parse({
        options: {},
        arguments: [{ name: "[f2]" }],
      }, []);
      void res;

      test.typeAssert<test.Equals<{
        opts: object;
        args: {
          f2?: string;
        };
        specifiedOpts: never[];
        cmd?: undefined;
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
      } | {
        cmd: "cmd2";
        args: { f2: string };
        opts: { b: boolean };
        specifiedOpts: Array<"b">;
      } | {
        cmd: "cmd3";
        args: object;
        opts: object;
        specifiedOpts: never[];
      }, typeof res>>();
    }
  });
}

async function waitRunDone(r: { onDone?: () => void }) {
  await new Promise<void>((resolve) => {
    r.onDone = resolve;
  });
}

async function testCLIRun() {
  await waitRunDone(run({
    name: "test",
    description: "Test command",
    options: {},
    arguments: [],
    main(data) {
      test.typeAssert<test.Equals<{ args: object; opts: object; specifiedOpts: never[]; cmd?: undefined }, typeof data>>();
      test.eq({ args: {}, opts: {}, specifiedOpts: [], cmd: undefined }, data);
    }
  }, { argv: [] }));

  await waitRunDone(run({
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
        }
      }
    }
  }, { argv: ["c", "-a", "a"] }));

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

test.run([
  testCLIMainParse,
  testCLISubCommandParse,
  testCLITypes,
  testCLIRun,
]);
