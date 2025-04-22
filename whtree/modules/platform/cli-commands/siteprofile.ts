// @webhare/cli: Manage and debug site profiles
import { run } from "@webhare/cli";
import { getApplyTesterForObject } from '@webhare/whfs/src/applytester';
import { openFileOrFolder } from '@webhare/whfs';
import { describeMetaTabs } from '@mod-publisher/lib/internal/siteprofiles/metatabs';

run({
  subCommands: {
    "dump-applies": {
      description: "Get rules applicable to the specific object",
      flags: { yaml: "List only rules sourced from YAML files" },
      arguments: [{ name: "<object>", description: "Object to evaluate" }],
      main: async ({ args, opts }) => {
        const toopen = args.object.match(/^[\d]+$/) ? parseInt(args.object) : args.object;
        const applyester = await getApplyTesterForObject(await openFileOrFolder(toopen, { allowRoot: true, allowHistoric: true }));
        console.log(JSON.stringify(await applyester.__getAllMatches({ yamlonly: opts.yaml }), null, 2));
      }
    },
    "dump-fields": {
      description: "Get metadata fields applicable to the specific object",
      arguments: [{ name: "<object>", description: "Object to evaluate" }],
      main: async ({ args, opts }) => {
        const toopen = args.object.match(/^[\d]+$/) ? parseInt(args.object) : args.object;
        const applyester = await getApplyTesterForObject(await openFileOrFolder(toopen, { allowRoot: true, allowHistoric: true }));
        const tabs = await describeMetaTabs(applyester);
        console.log(JSON.stringify(tabs, null, 2));
      }
    }
  }
});
