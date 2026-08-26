import { fetchPreviewAsDoc } from "@mod-webhare_testsuite/js/whfs";
import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import { throwError } from "@webhare/std";
import { beginWork, commitWork } from "@webhare/whdb";
import { listInstances, whfsType } from "@webhare/whfs";
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
  const tmp = await test.getTestSiteJSTemp();

  await beginWork();

  //We need a file that will remain HS HTML rendered so use the explicit test type
  const file = await tmp.createFile("widgetholder", { type: "webhare_testsuite:base_test.testsuite_rtd_hs", publish: true });
  await whfsType("platform:filetypes.richdocument").set(file.id, { data: [{ p: "This is version #1" }] });

  const workflowMgr = await openWorkflowManager(file.id, {
    useWorkflow: true,
    workflowTypes: ["platform:filetypes.richdocument"],
    assumeWriteAccess: true
  });

  await workflowMgr.set("platform:filetypes.richdocument", { data: [{ p: "This is version #2" }] });
  await workflowMgr.save();

  await commitWork();

  const livePreview = await fetchPreviewAsDoc(file.id);
  test.eq(/This is version #1/, livePreview.contentDiv?.textContent);

  const history = await file.listHistory();
  test.eqPartial([{ type: "import", version: "1.0" }, { type: "saved", version: "1.1" }], history);
  const draftPreview = await fetchPreviewAsDoc(history[1].snapshot ?? throwError("No snapshot for draft save?"));

  test.eq(/This is version #2/, draftPreview.contentDiv?.textContent);

}

test.runTests([
  test.reset,
  testVersionedForm,
  testVersionedStaticPage
]);
