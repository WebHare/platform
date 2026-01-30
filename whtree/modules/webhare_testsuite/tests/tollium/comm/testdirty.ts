import * as test from "@mod-tollium/js/testframework";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";
import { sleep } from "@webhare/std";
import { prepareUpload } from '@webhare/test-frontend';
///@ts-ignore -- not yet ported (and currently being refactored externally)
import * as rtetest from "@mod-tollium/js/testframework-rte";

let status_comp: any, clearbutton_node: any, apptab: any;

async function clearState() {
  test.click(clearbutton_node);
  await test.wait("ui");
  test.eq("NO", status_comp.value);
  test.eq(false, apptab.classList.contains("t-apptab--dirty"));
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/dirty.dirtytest');
      await test.waitForUI();

      // Get general components
      status_comp = test.compByName("dirtystatus").propTodd;
      clearbutton_node = test.compByName("clearbutton");
      apptab = test.qSA(".t-apptab")[1];
      await clearState();

      // Explicitly set the state
      const setbutton_node = test.compByName("setbutton");
      test.click(setbutton_node);
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Update textedit value
      const textedit_node = test.compByName("textedit").querySelector("input");
      test.fill(textedit_node, "some text");
      // Wait until the state changes (times out if it doesn't work)
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Regression: merely selecting text made the textedit dirty
      textedit_node.selectionStart = 0;
      textedit_node.selectionEnd = textedit_node.value.length;
      // We cannot wait until something hasn't happened, so just wait a second and check the status
      await sleep(1000);
      test.eq("NO", status_comp.value);
      test.eq(false, apptab.classList.contains("t-apptab--dirty"));

      // Test composition
      const composition_node = test.compByName("textedit_composition").querySelector("input");
      test.fill(composition_node, "some text");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test combobox
      const combobox_node = test.compByName("combobox").querySelector("input");
      test.click(combobox_node);
      await test.wait("ui");
      test.click(".t-selectlist__item");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test textarea
      const textarea_node = test.compByName("textarea").querySelector("textarea");
      test.fill(textarea_node, "some text");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test checkbox
      const checkbox_node = test.compByName("checkbox");
      test.click(checkbox_node);
      await test.wait("ui"); // wait for onchange handler
      await clearState();

      // Test radiobutton
      const radiobutton_node = test.compByName("radiobutton");
      test.click(radiobutton_node);
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test radiogroup
      const radiogroup_node = test.compByName("radiobutton_group");
      test.click(radiogroup_node);
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test select pulldown
      const select_pulldown_node = test.qS<HTMLSelectElement>("[data-name*=':select_pulldown$']");
      select_pulldown_node!.value = "s";
      /*ADDME: Don't know how to trigger a select change; setting the node value doesn't do the trick
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      */
      await clearState();

      // Test select checkbox
      test.click("[data-name*=':select_checkbox$']");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test select radio
      test.click("[data-name*=':select_radio$']+[data-name*=':select_radio$']");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test select checkboxlist
      test.click(test.qSA("[data-name*=':select_checkboxlist$'] .listrow")[0]);
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test list celledit
      const list_node = test.compByName("list");
      test.click(list_node.querySelector(".listrow"));
      await test.sleep(500); // prevent doubleclick
      test.click(list_node.querySelector(".listrow"));
      await test.wait("ui");
      await test.pressKey("Escape");
      await test.wait("ui");
      test.eq("NO", status_comp.value);
      test.eq(false, apptab.classList.contains("t-apptab--dirty"));
      await test.sleep(500); // otherwise next click won't register?
      test.click(list_node.querySelector(".listrow"));
      await test.wait("ui");
      await test.pressKey("Enter");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test list checkbox
      test.focus(list_node.querySelector(".listrow input")); //needed since around 22nov.. the test scrolls things so the next click failed() but hard to reproduce when clicking manually...
      test.click(list_node.querySelector(".listrow input"));
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test arrayedit add
      const arrayedit_addbutton_node = test.compByName("arrayedit!addbutton");
      test.click(arrayedit_addbutton_node);
      await test.wait("ui");
      const rowedit_column_node = test.compByName("rowedit_column").querySelector("input");
      test.fill(rowedit_column_node, "some text");
      await test.pressKey("Enter");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test arrayedit edit
      const arrayedit_editbutton_node = test.compByName("arrayedit!editbutton");
      test.click(arrayedit_editbutton_node);
      await test.wait("ui");
      await test.pressKey("Escape");
      await test.wait("ui");
      test.eq("NO", status_comp.value);
      test.eq(false, apptab.classList.contains("t-apptab--dirty"));
      test.click(arrayedit_editbutton_node);
      await test.wait("ui");
      await test.pressKey("Enter");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test arrayedit checkbox
      const arrayedit_node = test.compByName("arrayedit!list");
      test.focus(arrayedit_node.querySelector(".listrow input")); //needed since around 22nov.. the test scrolls things so the next click failed() but hard to reproduce when clicking manually...
      test.click(arrayedit_node.querySelector(".listrow input"));
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test arrayedit delete
      const arrayedit_deletebutton_node = test.compByName("arrayedit!deletebutton");
      test.click(arrayedit_deletebutton_node);
      await test.wait("ui");
      test.clickTolliumButton("Yes");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test box
      const box_node = test.compByName("box!heading!cbox");
      box_node.click();
      await test.wait("ui"); // wait for enablecomponents
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test heading enabled after checking box
      const heading_node = test.compByName("heading!cbox");
      heading_node.click();
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test slider
      const slider_node = test.compByName("slider");
      test.click(slider_node, { y: 0, x: "51%" }); // just click in the middle to change the slider value from 0 (min) to 1 (max)
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test tagedit
      const tagedit_node = test.compByName("tagedit").querySelector("input");
      test.fill(tagedit_node, "some text");
      await test.sleep(250);
      // Just typing some text doesn't make the field dirty
      test.eq("NO", status_comp.value);
      test.eq(false, apptab.classList.contains("t-apptab--dirty"));
      await test.pressKey("Enter");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test date
      test.click(test.compByName("date").querySelector(".tollium__datetime__togglepicker"));
      test.qS<HTMLElement>('.tollium__datetime__picker__todaybutton')!.click(); //FIXME should use test.click but the date doesn't scroll into view... but not really the point of this test anyway
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test datetime date
      test.fill(test.compByName("datetime").querySelector("input.tollium__datetime__day"), "02");
      test.fill(test.compByName("datetime").querySelector("input.tollium__datetime__month"), "02");
      test.fill(test.compByName("datetime").querySelector("input.tollium__datetime__year"), "2020");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test datetime time
      const datetimeh_node = test.compByName("datetime").querySelector(".tollium__datetime__hour");
      test.fill(datetimeh_node, "02");
      const datetimem_node = test.compByName("datetime").querySelector(".tollium__datetime__minute");
      test.fill(datetimem_node, "20");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test time
      const timeh_node = test.compByName("time!dt").querySelector(".tollium__datetime__hour");
      test.fill(timeh_node, "02");
      const timem_node = test.compByName("time!dt").querySelector(".tollium__datetime__minute");
      test.fill(timem_node, "20");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test imgedit upload
      prepareUpload(["/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"]);
      test.click(test.compByName("imgedit!uploadbutton"));
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test imgedit edit
      test.click(test.compByName("imgedit!editbutton"));
      await test.wait("ui");
      test.clickTolliumButton("Save");
      await test.wait("ui");
      test.eq("YES", status_comp.value);
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test codeedit
      const codeedit_node = test.compByName("code").querySelector("textarea");
      test.fill(codeedit_node, "some text");
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test RTE
      const rte_comp = rtetest.getRTE(test.getCurrentApp().win, "rte");
      const rte_selection = rte_comp.getEditor().getSelectionRange();
      rte_selection.insertBefore(test.getCurrentApp().win.document.createTextNode("some text"));
      rte_comp._checkDirty();//ADDME: How can we trigger RTE dirtyness without having to call _checkDirty ourselves?
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();

      // Test RTE again; its internal dirty state should be cleared again
      rte_selection.insertBefore(test.getCurrentApp().win.document.createTextNode("other text"));
      rte_comp._checkDirty();//ADDME: How can we trigger RTE dirtyness without having to call _checkDirty ourselves?
      await test.wait(() => status_comp.value === "YES");
      test.eq(true, apptab.classList.contains("t-apptab--dirty"));
      await clearState();
    }
  ]);
