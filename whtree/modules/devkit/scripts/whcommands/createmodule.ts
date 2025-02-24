import { createModule } from "@mod-devkit/js/scaffolding/module";
import { CLIRuntimeError, run } from "@webhare/cli";

run({
  description: "Create a new module",
  flags: {
    "nogit": { description: "Do not initialize a git repository" },
  },
  options: {
    "language": { description: "Specify the language for the module", default: "en" },
  },
  arguments: [{ name: "<module>", description: "The name of the module to create" }],
  main: async ({ opts, args }) => {
    const { 1: subpath, 2: module } = args.module.match(/^([^/]+)\/([^/]+)$/) || [];
    if (!subpath)
      throw new CLIRuntimeError("Invalid module name - expecting 'subpath/modulename'");

    const res = await createModule(subpath, module, {
      defaultLanguage: opts.language,
      initGit: !opts.nogit,
    });
    console.log("Created module in", res.destpath, opts.nogit ? "" : "(with empty git repository)");
  }
});
