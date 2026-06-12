import { whconstant_whfsid_registerslots } from "@mod-system/js/internal/webhareconstants";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { IntExtLink } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";
import { getAllWHFSRegisterSlots, lookupInWHFSRegister, setWHFSRegisterSlot } from "@webhare/whfs/src/register";

async function testRegister() {
  const testdir = await test.getWHFSTestRoot();

  //Get existing slots
  let slots = await getAllWHFSRegisterSlots();
  test.eqPartial({
    title: "webhare_testsuite:module.testsite.title",
    description: "webhare_testsuite:module.testsite.description",
    initialValue: "site::webhare_testsuite.testsite",
    isOrphan: false
  }, slots.find(s => s.name === "webhare_testsuite:testsite"));

  test.eqPartial({
    title: ":Test Slot",
    description: ":Test Description",
    initialValue: "whfs::/webhare-tests/webhare_testsuite.testfolder/testslot",
    isOrphan: false
  }, slots.find(s => s.name === "webhare_testsuite:testslot"));

  await test.throws(/No such slot/, lookupInWHFSRegister("webhare_testsuite:nosuchslot" + Math.floor(Math.random() * 65535)));

  //Make sure the testslot and testsite unset
  await beginWork();
  await setWHFSRegisterSlot("webhare_testsuite:testslot", null);
  await setWHFSRegisterSlot("webhare_testsuite:testsite", null);
  await commitWork();

  //Request testslot - should not be there yet...
  await test.throws(/has not been set/, lookupInWHFSRegister("webhare_testsuite:testslot"));
  test.eq((await test.getTestSiteHS()).id, await lookupInWHFSRegister("webhare_testsuite:testsite"));

  //Create the testslot's folder
  await beginWork();
  let testslotfolder = await testdir.createFolder("testslot");
  await test.throws(/has not been set/, lookupInWHFSRegister("webhare_testsuite:testslot"), "we do not permit referring to it in the same transactions, as its still globally invisible");
  await commitWork();

  test.eq(testslotfolder.id, await lookupInWHFSRegister("webhare_testsuite:testslot")); //NOW we're good to go!

  await beginWork();
  const testslotfolder2 = await testdir.createFolder("testslot2");
  await setWHFSRegisterSlot("webhare_testsuite:testslot", testslotfolder2.id);
  await commitWork();

  test.eq(testslotfolder2.id, await lookupInWHFSRegister("webhare_testsuite:testslot"));

  //test through our list api
  slots = await getAllWHFSRegisterSlots();
  test.eqPartial({
    title: ":Test Slot",
    description: ":Test Description",
    initialValue: "whfs::/webhare-tests/webhare_testsuite.testfolder/testslot",
    currentValue: testslotfolder2.id,
    currentPath: "/webhare-tests/webhare_testsuite.testfolder/testslot2/",
    isOrphan: false
  }, slots.find(s => s.name === "webhare_testsuite:testslot"));

  await beginWork();
  const testslotfile = await testdir.createFile("testslotfile");
  await test.throws(/is a file/, setWHFSRegisterSlot("webhare_testsuite:testslot", testslotfile.id));
  await commitWork();

  test.eq(testslotfolder2.id, await lookupInWHFSRegister("webhare_testsuite:testslot"), "should not have changed");

  await beginWork();
  await testslotfolder2.recycle();
  await commitWork();

  //deleted entry should recover if the target is recreated
  await beginWork();
  test.eq(testslotfolder.id, await lookupInWHFSRegister("webhare_testsuite:testslot"));
  await testslotfolder.update({ name: "testslot3" });
  await commitWork();

  test.eq(testslotfolder.id, await lookupInWHFSRegister("webhare_testsuite:testslot"), "should follow the new entry after rename");

  await beginWork();
  await testslotfolder.recycle();
  await commitWork();

  await test.throws(/refers to deleted*/, lookupInWHFSRegister("webhare_testsuite:testslot"));

  await beginWork();
  testslotfolder = await testdir.createFolder("testslot");
  await commitWork();

  test.eq(testslotfolder.id, await lookupInWHFSRegister("webhare_testsuite:testslot"));

  await beginWork();
  await testslotfolder.delete();
  const fallbackfolder = await testdir.createFolder("testslot-fallback");
  await commitWork();

  test.eq(fallbackfolder.id, await lookupInWHFSRegister("webhare_testsuite:testslot"), "should switch over to fallback folder");

  await beginWork();
  testslotfolder = await testdir.createFolder("testslot");
  await commitWork();

  //should switch over to 'real' location as the fallback isn't actually stored
  test.eq(testslotfolder.id, await lookupInWHFSRegister("webhare_testsuite:testslot"));
}

async function testOrphans() {
  const testdir = await test.getWHFSTestRoot();

  await beginWork();
  const testslotfile = await testdir.openFile("testslotfile");
  const testslotfolder = await testdir.openFolder("testslot");

  const rawslotfolder = await openFolder(whconstant_whfsid_registerslots);
  await (await rawslotfolder.openFile("webhare_testsuite--testslot")).delete();
  await rawslotfolder.ensureFile("webhare_testsuite--OrphanSlot", { type: "platform:filetypes.internallink", target: new IntExtLink(testslotfile.id) });
  await commitWork();

  test.eq(testslotfile.id, await lookupInWHFSRegister("webhare_testsuite:orphanslot"), "orphan lookups are allowed to reduce breakage when a moduledefinitions breaks");
  await test.throws(/No such slot*/, setWHFSRegisterSlot("webhare_testsuite:orphanslot", testslotfolder.id), "an orphan cannot currently be changed through the API");

  const slots = await getAllWHFSRegisterSlots();
  test.eq({
    name: "webhare_testsuite:orphanslot",
    currentValue: testslotfile.id,
    currentPath: testslotfile.whfsPath,
    isOrphan: true
  }, slots.find(s => s.name === "webhare_testsuite:orphanslot"));
}

test.runTests([
  test.resetWTS,
  testRegister,
  testOrphans
]);
