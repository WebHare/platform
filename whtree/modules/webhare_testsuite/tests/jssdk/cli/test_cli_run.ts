
import { intRange, parse, stringEnum } from "@webhare/cli/src/run";
import * as test from "@webhare/test-backend";

async function testCLIMainParse() {
  test.eq({
    args: {},
    opts: {},
  }, parse({
    options: {},
    arguments: [],
  }, []));

  test.eq({
    args: { file: "a" },
    opts: { verbose: false, withBlabla: "b" },
  }, parse({
    options: {
      "v,verbose": { default: false, description: "Show verbose output" },
      "with-blabla": { default: "", description: "String param" }
    },
    arguments: [{ name: "<file>", description: "The file to process" }],
  }, ["a", "--with-blabla", "b"]));

  test.eq({
    args: {},
    opts: { verbose: true, output: "test", num: 3 },
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
    }
  }, parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "...c" }, { name: "<d>" },],
  }, ["a", "b"]));

  test.eq({
    opts: {},
    args: {
      a: "a",
      b: "b",
      c: ["c", "d", "e"],
      d: "f",
    }
  }, parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "...c" }, { name: "<d>" },],
  }, ["a", "b", "c", "d", "e", "f"]));

  test.throws(/Required argument "c" cannot be placed between optional arguments/, () => parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "[b]" }, { name: "<c>" }, { name: "[d]" }],
  }, []));

  test.throws(/Optional argument "c" cannot follow a rest argument/, () => parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "...b" }, { name: "[c]" }],
  }, []));

  test.throws(/Argument "a" is specified twice/, () => parse({
    options: {},
    arguments: [{ name: "<a>" }, { name: "...a" }],
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
    command: "cmd",
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
    command: "cmd",
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

  parse({
    name: "test",
    description: "Test command",
    options: {},
    arguments: [],
    main() { }
  }, []);
}


function dontRun(a: () => void) {
  void a;
}

async function testTypes() {
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
        arguments: [{ name: "<f1>" }, { name: "[f2]" }, { name: "...f3" }],
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
        command?: undefined;
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
        command: "cmd";
        args: { f1: string };
        opts: { a: boolean };
      } | {
        command: "cmd2";
        args: { f2: string };
        opts: { b: boolean };
      } | {
        command: "cmd3";
        args: object;
        opts: object;
      }, typeof res>>();
    }
  });
}

test.run([
  testCLIMainParse,
  testCLISubCommandParse,
  testTypes,
]);
