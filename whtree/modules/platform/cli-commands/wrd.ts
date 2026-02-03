/* CLI tool to manage WHFS */
import { WRDSchema, describeEntity, listSchemas } from '@webhare/wrd';
import { regExpFromWildcards, throwError } from '@webhare/std';
import { decodeHSON } from '@webhare/hscompat';
import { runInWork } from '@webhare/whdb';
import { CLIRuntimeError, enumOption, run } from "@webhare/cli";
import { parseSchema } from '@webhare/wrd/src/schemaparser';
import { checkWRDSchema, type WRDIssue } from '@webhare/wrd/src/check';

run({
  description: "Manage WRD",
  flags: {
    "j,json": { description: "Output in JSON format" }
  },
  subCommands: {
    "check": {
      description: "Check a WRD schema for errors",
      arguments: [{ name: "<schemamask>", description: "Schema(s) to check" }],
      flags: {
        "v,verbose": {
          description: "Be verbose in output"
        },
        "metadata-only": {
          description: "Only check metadata, not data integrity"
        }
      },
      main: async ({ opts, args }) => {
        const issues: Array<WRDIssue & { schema: string }> = [];
        const tofind = regExpFromWildcards(args.schemamask, { caseInsensitive: true });
        const schemas = (await listSchemas()).filter(s => tofind.test(s.tag));
        if (schemas.length === 0)
          throw new CLIRuntimeError(`No schemas found matching '${args.schemamask}'`);

        for (const schema of schemas.toSorted((a, b) => a.tag.localeCompare(b.tag))) {
          if (opts.verbose)
            console.log(`Checking schema '${schema.tag}'...`);

          await checkWRDSchema(schema.tag, (issue: WRDIssue) => {
            issues.push({ ...issue, schema: schema.tag });
            if (!opts.json) //then we can print immediately
              console.log(`${schema.tag}: ${issue.message}`);
          }, { metadataOnly: opts.metadataOnly });
        }

        if (opts.json) {
          console.log(JSON.stringify({ issues }));
        } else if (issues.length === 0) {
          console.log("No issues found");
        }

        return issues.length === 0 ? 0 : 1;
      }
    },
    "parse-schema": {
      description: "Parse a WRD schema. dump the contents",
      arguments: [{ name: "<schemaresource>", description: "Schema to parse" }],
      main: async ({ args }) => {
        console.log(JSON.stringify(await parseSchema(args.schemaresource, true, null), null, 2));
      }
    },
    "export": {
      description: "Export an entity",
      options:
      {
        resources: { description: "Export resources for fetch (default) or inline as base64", type: enumOption(["fetch", "base64"]), default: "fetch" }
      },
      arguments: [{ name: "<id>", description: "Entity ID" }],
      main: async ({ opts, args }) => {
        const entityid = parseInt(args.id);
        const entityinfo = await describeEntity(entityid) ?? throwError(`Entity #${entityid} not found`);
        const wrdschema = new WRDSchema(entityinfo.schema);
        const attrs = await wrdschema.getType(entityinfo.type).listAttributes();
        const entity = await wrdschema.getFields(entityinfo.type, entityid, attrs.map(_ => _.tag), { export: true, historyMode: "unfiltered", exportResources: opts.resources });
        console.log(JSON.stringify(entity, null, 2));
      }
    },
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
