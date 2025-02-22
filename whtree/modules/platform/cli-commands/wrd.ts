/* CLI tool to manage WHFS */
import { WRDSchema, describeEntity } from '@webhare/wrd';
import { throwError } from '@webhare/std';
import { decodeHSON } from '@webhare/hscompat';
import { runInWork } from '@webhare/whdb';
import { CLIRuntimeError, run } from "@webhare/cli";

run({
  description: "Manage WRD",
  flags: {
    "j,json": { description: "Output in JSON format" }
  },
  subCommands: {
    "update": {
      description: "Update an entity",
      arguments: [
        { name: "<id>", description: "Entity ID" },
        { name: "<field>", description: "Field to set" },
        { name: "<value>", description: "Value to set" }
      ],
      main: async ({ opts, args }) => {
        const { id, field, value } = args;
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
            throw new CLIRuntimeError(`Unsupported attribute type '${attr.attributeType}'`);
        }

        await runInWork(() => wrdschema.update(entityinfo.type, parseInt(id), toset));
        console.log(opts.json ? '"updated"' : `Updated entity #${entityid}`);
      }
    }
  }
});
