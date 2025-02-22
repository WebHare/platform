import { describeWHFSType, openFileOrFolder, type WHFSFile } from '@webhare/whfs';
import { CLIRuntimeError, run } from "@webhare/cli";

run({
  description: 'Manage WebHare file system',
  flags: {
    "j,json": { description: "Output in JSON format" }
  },
  subCommands: {
    get: {
      description: "Get a file's data from the WHFS",
      arguments: [{ name: "<path>", description: "File path" }],
      main: async ({ opts, args }) => {
        const target = await openFileOrFolder(args.path);
        const typeinfo = await describeWHFSType(target.type);
        if (typeinfo.metaType !== "fileType")
          throw new CLIRuntimeError("Not a file");
        if (!typeinfo.hasData)
          throw new CLIRuntimeError("Not a downlodable file");
        if (opts.json)
          process.stdout.write(JSON.stringify({ data: Buffer.from(await (target as WHFSFile).data.resource.arrayBuffer()).toString("base64") }));
        else
          process.stdout.write(Buffer.from(await (target as WHFSFile).data.resource.arrayBuffer()));
      }
    }
  }
});
