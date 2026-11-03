import { fetchPreviewAsDoc } from "@mod-webhare_testsuite/js/whfs";
import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { throwError } from "@webhare/std";
import { beginWork, commitWork } from "@webhare/whdb";
import { listInstances, lookupURL, whfsType, type WHFSTypeName } from "@webhare/whfs";
import { openWorkflowManager } from "@webhare/whfs/src/workflow";
import { generateForm } from "../data/whfs-testhelpers";

async function testVersionedForm() {
  const tmp = await test.getTestSiteJSTemp();

  await beginWork();
  //TODO we need a way to createFile with history (or it should do it implicit, TS is new anyway)
  const form = await tmp.createFile("form", { type: "platform:filetypes.form", publish: true });
  await whfsType("platform:filetypes.form").set(form.id, { data: await generateForm({ text: "This is test #1" }) });

  const workflowMgr = await openWorkflowManager(form.id, {
    useWorkflow: true,
    workflowTypes: ["platform:filetypes.form"],
    assumeWriteAccess: true
  });

  await workflowMgr.set("platform:filetypes.form", { data: await generateForm({ text: "This is test #2" }) });
  await workflowMgr.save({ finalize: true });

  await commitWork();

  //Preview the historic variant
  const history = await form.listHistory();
  test.eqPartial([{ type: "import", version: "1.0" }, { type: "final", version: "2.0" }], history);
  test.eq([
    {
      fsObject: form.id,
      namespace: "http://www.webhare.net/xmlns/publisher/formwebtool",
      scopedType: "platform:filetypes.form",
      clone: "onDraft",
      orphan: false,
      workflow: false
    }
  ], await listInstances([form.id]));


  const historicPreview = await fetchPreviewAsDoc(history[0].snapshot ?? throwError("No snapshot for original import?"));
  test.eq(/This is test #1/, historicPreview.contentDiv?.textContent);

  const currentPreview = await fetchPreviewAsDoc(form.id);
  test.eq(/This is test #2/, currentPreview.contentDiv?.textContent);
}

async function testVersionedStaticPage() {
  for (const tmp of [await test.getTestSiteJSTemp(), await test.getTestSiteHSTemp()]) {
    using p1 = test.scopedPrefix(tmp.whfsPath); void (p1);
    for (const type of ["webhare_testsuite:base_test.testsuite_rtd_hs", "webhare_testsuite:base_test.testsuite_rtd_ts"] as WHFSTypeName[]) {
      using p2 = test.scopedPrefix(type); void (p2);

      await using work = await beginWork();

      const file = await tmp.createFile(type.split('.')[1], { type, publish: true });
      await whfsType("platform:filetypes.richdocument").set(file.id, { data: [{ p: "This is version #1" }] });
      await whfsType("webhare_testsuite:base_test.base_test_props").set(file.id, { anyField: "V1" });

      const workflowMgr = await openWorkflowManager(file.id, {
        useWorkflow: true,
        workflowTypes: ["platform:filetypes.richdocument", "webhare_testsuite:base_test.base_test_props"],
        assumeWriteAccess: true
      });

      await workflowMgr.set("platform:filetypes.richdocument", { data: [{ p: "This is version #2" }] });
      await workflowMgr.set("webhare_testsuite:base_test.base_test_props", { anyField: "V2" });
      await workflowMgr.save();

      await work.commit();

      const livePreview = await fetchPreviewAsDoc(file.id);
      test.eq(/This is version #1/, livePreview.contentDiv?.textContent);
      test.eq("V1", livePreview.contentDiv?.attributes["data-betatestprops-anyfield"]);

      // Make sure lookupURL resolves back to the original file.
      const previewLookup = await lookupURL(new URL(livePreview.url));
      test.eq(file.id, previewLookup.file);

      const history = await file.listHistory();
      test.eqPartial([{ type: "import", version: "1.0" }, { type: "saved", version: "1.1" }], history);
      const draftPreview = await fetchPreviewAsDoc(history[1].snapshot ?? throwError("No snapshot for draft save?"));

      test.eq(/This is version #2/, draftPreview.contentDiv?.textContent);
      test.eq("V2", draftPreview.contentDiv?.attributes["data-betatestprops-anyfield"]);
    }
  }
}

test.runTests([
  test.reset,
  testVersionedForm,
  testVersionedStaticPage
]);
