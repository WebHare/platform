import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

let status_comp, clearbutton_node;

async function clearState()
{
  test.click(clearbutton_node);
  await test.wait("ui");
  test.eq("NO", status_comp.value);
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/dirty.dirtytest')
    , waits: ['ui']
    }

  , { test: async function()
      {
        // Get general components
        status_comp = test.compByName("dirtystatus").propTodd;
        clearbutton_node = test.compByName("clearbutton");
        await clearState();

        // Explicitly set the state
        let setbutton_node = test.compByName("setbutton");
        test.click(setbutton_node);
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Update textedit value
        let textedit_node = test.compByName("textedit").querySelector("input");
        test.fill(textedit_node, "some text");
        // Wait until the state changes (times out if it doesn't work)
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test composition
        let composition_node = test.compByName("textedit_composition").querySelector("input");
        test.fill(composition_node, "some text");
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test combobox
        let combobox_node = test.compByName("combobox").querySelector("input");
        test.click(combobox_node);
        await test.wait("ui");
        let combobox_menu = test.getDoc().querySelector(".t-selectlist__item");
        test.click(combobox_menu);
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test textarea
        let textarea_node = test.compByName("textarea").querySelector("textarea");
        test.fill(textarea_node, "some text");
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test checkbox
        let checkbox_node = test.compByName("checkbox");
        test.click(checkbox_node);
        await test.wait("ui"); // wait for onchange handler
        await clearState();

        // Test radiobutton
        let radiobutton_node = test.compByName("radiobutton");
        test.click(radiobutton_node);
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test radiogroup
        let radiogroup_node = test.compByName("radiobutton_group");
        test.click(radiogroup_node);
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test select pulldown
        let select_pulldown_node = test.getCurrentApp().win.document.querySelector("[data-name*=':select_pulldown$']");
        select_pulldown_node.value = "s";
        /*ADDME: Don't know how to trigger a select change; setting the node value doesn't do the trick
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        */
        await clearState();

        // Test select checkbox
        let select_checkbox_node = test.getCurrentApp().win.document.querySelector("[data-name*=':select_checkbox$']");
        test.click(select_checkbox_node);
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test select radio
        let select_radio_node = test.getCurrentApp().win.document.querySelector("[data-name*=':select_radio$']+[data-name*=':select_radio$']");
        test.click(select_radio_node);
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test select checkboxlist
        let select_checkboxlist_node = test.getCurrentApp().win.document.querySelector("[data-name*=':select_checkboxlist$']");
        test.click(select_checkboxlist_node.querySelector(".listrow"));
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test list celledit
        let list_node = test.compByName("list");
        test.click(list_node.querySelector(".listrow"));
        await test.wait(500); // prevent doubleclick
        test.click(list_node.querySelector(".listrow"));
        await test.wait("ui");
        await test.pressKey("Escape");
        await test.wait("ui");
        test.eq("NO", status_comp.value);
        await test.wait(500); // otherwise next click won't register?
        test.click(list_node.querySelector(".listrow"));
        await test.wait("ui");
        await test.pressKey("Enter");
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test list checkbox
        test.focus(list_node.querySelector(".listrow input")); //needed since around 22nov.. the test scrolls things so the next click failed() but hard to reproduce when manually clicing...
        test.click(list_node.querySelector(".listrow input"));
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test arrayedit add
        let arrayedit_addbutton_node = test.compByName("arrayedit!addbutton");
        test.click(arrayedit_addbutton_node);
        await test.wait("ui");
        let rowedit_column_node = test.compByName("rowedit_column").querySelector("input");
        test.fill(rowedit_column_node, "some text");
        await test.pressKey("Enter");
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test arrayedit edit
        let arrayedit_editbutton_node = test.compByName("arrayedit!editbutton");
        test.click(arrayedit_editbutton_node);
        await test.wait("ui");
        await test.pressKey("Escape");
        await test.wait("ui");
        test.eq("NO", status_comp.value);
        test.click(arrayedit_editbutton_node);
        await test.wait("ui");
        await test.pressKey("Enter");
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test arrayedit checkbox
        let arrayedit_node = test.compByName("arrayedit!list");
        test.focus(arrayedit_node.querySelector(".listrow input")); //needed since around 22nov.. the test scrolls things so the next click failed() but hard to reproduce when manually clicing...
        test.click(arrayedit_node.querySelector(".listrow input"));
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test arrayedit delete
        let arrayedit_deletebutton_node = test.compByName("arrayedit!deletebutton");
        test.click(arrayedit_deletebutton_node);
        await test.wait("ui");
        test.clickTolliumButton("Yes");
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test box
        let box_node = test.compByName("box!heading!cbox");
        test.click(box_node);
        await test.wait("ui"); // wait for enablecomponents
        test.eq("YES", status_comp.value);
        await clearState();

        // Test heading enabled after checking box
        let heading_node = test.compByName("heading!cbox");
        test.click(heading_node);
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test slider
        let slider_node = test.compByName("slider");
        slider_node.scrollIntoView();
        test.click(slider_node, {y:0, x:"51%"}); // just click in the middle to change the slider value from 0 (min) to 1 (max)
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test tagedit
        let tagedit_node = test.compByName("tagedit").querySelector("input");
        test.fill(tagedit_node, "some text");
        await test.wait(250);
        // Just typing some text doesn't make the field dirty
        test.eq("NO", status_comp.value);
        await test.pressKey("Enter");
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test date
        test.click(test.compByName("date").querySelector(".tollium__datetime__togglepicker"));
        test.qS('.tollium__datetime__picker__todaybutton').click(); //FIXME should use test.click but the date doesn't scroll into view... but not really the point of this test anyway
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test datetime date
        test.fill(test.compByName("datetime").querySelector("input.tollium__datetime__day"), "02");
        test.fill(test.compByName("datetime").querySelector("input.tollium__datetime__month"), "02");
        test.fill(test.compByName("datetime").querySelector("input.tollium__datetime__year"), "2020");
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test datetime time
        let datetimeh_node = test.compByName("datetime").querySelector(".tollium__datetime__hour");
        test.fill(datetimeh_node, "02");
        let datetimem_node = test.compByName("datetime").querySelector(".tollium__datetime__minute");
        test.fill(datetimem_node, "20");
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test time
        let timeh_node = test.compByName("time!dt").querySelector(".tollium__datetime__hour");
        test.fill(timeh_node, "02");
        let timem_node = test.compByName("time!dt").querySelector(".tollium__datetime__minute");
        test.fill(timem_node, "20");
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test imgedit upload
        let uploadpromise = test.prepareUpload(
            [ { url: "/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"
              , filename: "imgeditfile.jpeg"
              }
            ]);
        test.click(test.compByName("imgedit!uploadbutton"));
        await uploadpromise;
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test imgedit edit
        test.click(test.compByName("imgedit!editbutton"));
        await test.wait("ui");
        test.clickTolliumButton("Save");
        await test.wait("ui");
        test.eq("YES", status_comp.value);
        await clearState();

        // Test RTE
        let rte_comp = rtetest.getRTE(test.getCurrentApp().win, "rte");
        let rte_selection = rte_comp.getEditor().getSelectionRange();
        rte_selection.insertBefore(test.getCurrentApp().win.document.createTextNode("some text"));
        rte_comp._checkDirty();//ADDME: How can we trigger RTE dirtyness without having to call _checkDirty ourselves?
        await test.wait(() => status_comp.value == "YES");
        await clearState();

        // Test RTE again; its internal dirty state should be cleared again
        rte_selection.insertBefore(test.getCurrentApp().win.document.createTextNode("other text"));
        rte_comp._checkDirty();//ADDME: How can we trigger RTE dirtyness without having to call _checkDirty ourselves?
        await test.wait(() => status_comp.value == "YES");
        await clearState();
      }
    }
  ]);
