import * as dompack from "@webhare/dompack";
import type { WHDBContentData } from "@mod-devkit/tolliumapps/browsemodule/browsemodule";

/* NOTE: to debug these pages, I recommend using the Open Frame extension (or similar) and opening the iframe in a new tab in the Module browser
         then you can just refresh that tab */

export function initBrowseModuleWHDB() {
  const whdbdef = JSON.parse(document.querySelector("#data")!.textContent!) as WHDBContentData;
  console.log(whdbdef);

  document.body.append(<main>
    <h1>Database schema: {whdbdef.module}</h1>
    <p>To access this data from TypeScript in the WebHare backend:</p>
    <pre>{`
import { db } from "@webhare/whdb";
import type { ${whdbdef.interface} } from "${whdbdef.importPath}";
`}</pre>
    <h2>Recipes</h2>
    <h3>select</h3>
    <pre>{`
rows = await db<${whdbdef.interface}>().selectFrom("<tablename>").selectAll().execute();

rows = await db<${whdbdef.interface}>()
  .selectFrom("<tablename>")
  .where("parent", "=", id)
  .select(["id", "title"])
  .orderBy("name")
  .execute();
  `}</pre>
    <h3>insert</h3>
    <pre>{`
await db<${whdbdef.interface}>()
  .insertInto("<tablename>")
  .values({
    name,
    title: metadata?.title || "",
  })
  .execute();
  `}</pre>


    <h3>schemas</h3>
    <ul>
      {Object.entries(whdbdef.schemas).map(([schema, schemadef]) =>
        <li>{schema}
          <ul>{Object.entries(schemadef.tables).map(([table, tabledef]) =>
            <li>{table}
              <ul>{Object.entries(tabledef.columns).map(([column, columndef]) =>
                <li>{column} <code>{JSON.stringify(columndef)}</code></li>)}
              </ul>
            </li>)}</ul>
        </li>)
      }
    </ul>
    <pre>{`${JSON.stringify(whdbdef, null, 2)}`}</pre>
  </main>);
}
