import type { GenerateContext } from "@mod-system/js/internal/generation/shared";
import { listCatalogs } from "@webhare/consilio";
import { doCreateCatalog, removeCatalogs } from "@webhare/consilio/src/catalog";
import { getObsoleteCatalogs, getExpectedCatalogs } from "./consilio-config";
import { columnExists, runInWork } from "@webhare/whdb";


export async function updateConsilioCatalogs(generateContext: GenerateContext, { verbose = false }) {
  if (!await columnExists("consilio", "indexmanagers", "id"))
    return; //consilio is not initialized yet!

  const obsolete = getObsoleteCatalogs(generateContext);
  if (obsolete.length)
    await removeCatalogs(obsolete, { verbose });

  const expected = getExpectedCatalogs(generateContext);
  const currentCatalogs = await listCatalogs();

  //Apply any missing catalogs to the database
  await runInWork(async () => {
    for (const expect of expected.catalogs) {
      const match = currentCatalogs.find(_ => _.tag === expect.tag);
      if (!match) {
        if (verbose)
          console.log(`Creating Consilio catalog ${expect.tag}`);

        await doCreateCatalog(expect.tag, {
          priority: expect.priority,
          definedBy: expect.definedBy,
          managed: expect.managed,
          lang: expect.lang,
          suffixed: expect.suffixed
        });
      }
    } //TODO else: check settings, but any mismatching setting is requirely to require us to set a wh check issue - so move that there?
  });
}
