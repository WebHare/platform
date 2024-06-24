/* CLI tool to manage WHFS */
import { describeWHFSType, openFileOrFolder, type WHFSFile } from '@webhare/whfs';
import { program } from 'commander'; //https://www.npmjs.com/package/commander

program
  .name('wh whfs')
  .description('Manage WebHare file system')
  .option('-j, --json', "Output in JSON format");

const json: boolean = program.opts().json;

program.command("get")
  .description("Get a file's data from the WHFS")
  .argument("<path>", "File path")
  .action(async (path: string) => {
    const target = await openFileOrFolder(path);
    const typeinfo = await describeWHFSType(target.type);
    if (typeinfo.metaType !== "fileType")
      throw new Error("Not a file");
    if (!typeinfo.hasData)
      throw new Error("Not a downlodable file");
    if (json)
      process.stdout.write(JSON.stringify({ data: Buffer.from(await (target as WHFSFile).data.resource.arrayBuffer()).toString("base64") }));
    else
      process.stdout.write(Buffer.from(await (target as WHFSFile).data.resource.arrayBuffer()));
  });

program.parse();
