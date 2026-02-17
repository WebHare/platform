import * as dompack from "@webhare/dompack";
import type { WRDContentData } from "@mod-devkit/tolliumapps/browsemodule/browsemodule";

export function initBrowseModuleWRD() {
  const wrddef = JSON.parse(document.querySelector("#data")!.textContent!) as WRDContentData;
  console.log(wrddef);

  document.body.append(<main>
    <h1>WRD schema: {wrddef.wrdSchema}</h1>
    <p>To access this data from TypeScript in the WebHare backend:</p>
    <pre>{`import { ${wrddef.schemaObject} } from "${wrddef.importPath}";
`}</pre>
    <h2>Recipes</h2>
    <h3>Search and get</h3>
    <pre>{`const orgid = await ${wrddef.schemaObject}.find("wrdOrganization", { wrdOrgName: orgname });
const fields = await ${wrddef.schemaObject}.getFields("wrdOrganization", orgid, ["data"]);

// Or combining find + search
const fields2 = await ${wrddef.schemaObject}.getFields("wrdOrganization", { wrdOrgName: orgname }, ["data"]);

`}</pre>
    <h3>query</h3>
    <pre>{`const orgProgram = await ${wrddef.schemaObject}
  .query("wrdOrganization")
  .select(["data"])
  .match({ wrdOrgName: orgname })
  .where("wrdCreationDate", "<", new Date("2024-01-01"))
  .execute();
`}</pre>

    <h3>insert</h3>
    <pre>{`const orgId = await ${wrddef.schemaObject}
  .insert("wrdOrganization", { wrdOrgName: "Root org", wrdTag: "ROOTORG" });
`}</pre>

    <h3>update</h3>
    <pre>{`await ${wrddef.schemaObject}
  .update("wrdOrganization", orgId, { wrdOrgName: "Renamed organization" });

// Or matching directly:
await ${wrddef.schemaObject}
  .update("wrdOrganization", { wrdTag: "ROOTORG" }, { wrdOrgName: "Renamed organization #2" });

// Upsert: update if exists, create if not
await ${wrddef.schemaObject}
  .upsert("wrdOrganization", { wrdTag: "SUBORG" }, { wrdOrgName: "The new Sub Org" });

  `}</pre>

    <h3>schemas</h3>
    <ul>
      {Object.entries(wrddef.types).map(([type, typedef]) =>
        <li>{type}
          <ul>{Object.entries(typedef.attrdefs).map(([attr, attrdef]) =>
            <li>{attr} { /* FIXME - recurse into child attributes }*/}
              <code>{JSON.stringify(attrdef)}</code>
            </li>)}</ul>
        </li>)
      }
    </ul>

    <pre>{`${JSON.stringify(wrddef, null, 2)}`}</pre>

  </main >);
}
