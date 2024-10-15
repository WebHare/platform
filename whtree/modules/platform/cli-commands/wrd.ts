/* CLI tool to manage WHFS */
import { WRDSchema, describeEntity } from '@webhare/wrd';
import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { throwError } from '@webhare/std';
import { decodeHSON } from '@webhare/hscompat';
import { runInWork } from '@webhare/whdb';

program
  .name('wh wrd')
  .description('Manage WRD')
  .option('-j, --json', "Output in JSON format");

const json: boolean = program.opts().json;

program.command("update")
  .description("Update an entity")
  .argument("<id>", "Entity ID") //todo allow various other formats, eg schema:wrdGuid or schema:type:wrdTag ?
  .argument("<field>", "Field to set")
  .argument("<value>", "Value to set")
  .action(async (id: string, field: string, value: string) => {
    const entityid = parseInt(id);
    const entityinfo = await describeEntity(entityid) ?? throwError(`Entity #${entityid} not found`);
    const wrdschema = new WRDSchema(entityinfo.schema);
    // const type = await wrdschema.describeType(entityinfo.type) ?? throwError("Type not found");
    const attr = await wrdschema.getType(entityinfo.type).describeAttribute(field) ?? throwError(`Attribute '${field}' not found`);

    const toset: Record<string, unknown> = {};
    switch (attr.attributeType) {
      case "hson": {
        const parsed = decodeHSON(value);
        toset[field] = parsed;
        break;
      }
      default:
        throw new Error(`Unsupported attribute type '${attr.attributeType}'`);
    }

    await runInWork(() => wrdschema.update(entityinfo.type, parseInt(id), toset));
    console.log(json ? '"updated"' : `Updated entity #${entityid}`);
  });

program.parse();
