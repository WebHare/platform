/* This is an experimental tool to manage packages inside a WebHare module and allow further development/forking (through git submodules)
   Packages are automatically added as a workspace (so you should also take care to npm -i -w packages/xxx MODULE...)

   By default packages are installed in /vendor/ - which excludes them from linting rules. Install in /packages/ (TODO will that be the
   future convention and bring more benefits?) to include the module in our linting

   Example usage:
     wh devkit:addpackage --at /packages/ utwente_design git@gitlab.webhare.com:webhare-opensource/psp-pay.nl.git
     wh devkit:deletepackage packages/psp-pay.nl/

   TODO: pport installation of NPM packages, not jsut git urls?
   TODO: can we help with bootstrapping brand new modules?
   TODO: should addpackage/deletepackage be separate scripts or subcommands? eg we might want a 'listpackages' in the future?
*/

import { addPackage, parsePackageRef } from "@mod-devkit/js/scaffolding/addpackage";
import { run } from "@webhare/cli";
import { CLISyntaxError } from "@webhare/cli/src/run";


run({
  description: "Add a package to a module",
  flags: {
    "f,force": { description: "Force installation" }
  },
  options: {
    "at": { default: "/vendor/", description: "Location to install the package." },
  },
  arguments: [
    { name: "<module>", description: "The name of the module to update" },
    { name: "<package>", description: "The package to install. (currently only git: URLs supported which will be installed under /packages/)" }
  ],
  main: async ({ opts, args }) => {
    const parsed = parsePackageRef(args.package);
    if (!parsed)
      throw new CLISyntaxError("Invalid package reference - expecting '<git repository url>/package.git'");

    await addPackage(args.module, parsed, { at: opts.at, force: opts.force });
  }
});
