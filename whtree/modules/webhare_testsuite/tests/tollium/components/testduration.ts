import * as test from "@mod-tollium/js/testframework";
import * as tt from "@mod-tollium/js/tolliumtest";
import { dispatchDomEvent } from "@webhare/dompack";


test.runTests([
  "Load",
  async function () {
    await test.load(test.getCompTestPage("duration", { min_precision: "minutes", max_precision: "weeks" }));

    // Find the subcomponents
    let testPanel = test.compByName("componentpanel");
    let amountComp = testPanel.querySelector("t-textedit[data-name*=amount] input");
    let unitComp = testPanel.querySelector("select[data-name*=unit]");
    let periodComp = testPanel.querySelector("t-text[data-name*=period]");
    test.assert(amountComp);
    test.assert(unitComp);
    test.assert(!periodComp);

    // The unit component should only contain options for minutes, hours, days and weeks
    const unitOptions = unitComp.querySelectorAll("option");
    test.eq(4, unitOptions.length);
    test.eq("minutes", unitOptions[0].textContent);
    test.eq("hours", unitOptions[1].textContent);
    test.eq("days", unitOptions[2].textContent);
    test.eq("weeks", unitOptions[3].textContent);

    // Set the values
    amountComp.value = "15";
    unitComp.selectedIndex = 2;
    dispatchDomEvent(amountComp, 'input');
    dispatchDomEvent(unitComp, 'change');

    // Read the value
    tt.comp("readvaluebutton").click();
    await test.waitForUI();
    test.eq(`"P15D"`, tt.comp(":Value").querySelector("input")?.value);

    // Set the value
    tt.comp(":Value").set(`"PT59H"`);
    tt.comp("writevaluebutton").click();
    await test.waitForUI();
    amountComp = testPanel.querySelector("t-textedit[data-name*=amount] input");
    unitComp = testPanel.querySelector("select[data-name*=unit]");
    test.eq("59", testPanel.querySelector("t-textedit[data-name*=amount] input").value);
    test.eq(1, unitComp.selectedIndex);

    // Set the value with a unit that's not in the unit select
    tt.comp(":Value").set(`"P1234Y"`);
    tt.comp("writevaluebutton").click();
    await test.waitForUI();
    amountComp = testPanel.querySelector("t-textedit[data-name*=amount] input");
    unitComp = testPanel.querySelector("select[data-name*=unit]");
    test.eq("1234", testPanel.querySelector("t-textedit[data-name*=amount] input").value);
    test.eq(4, unitComp.selectedIndex);
    test.eq("years", unitComp.selectedOptions[0]?.textContent); // The 'years' option should be added as the last option

    tt.comp(":Value").set(`"PT0.001S"`);
    tt.comp("writevaluebutton").click();
    await test.waitForUI();
    amountComp = testPanel.querySelector("t-textedit[data-name*=amount] input");
    unitComp = testPanel.querySelector("select[data-name*=unit]");
    test.eq("1", testPanel.querySelector("t-textedit[data-name*=amount] input").value);
    test.eq(0, unitComp.selectedIndex);
    test.eq("milliseconds", unitComp.selectedOptions[0]?.textContent); // The 'milliseconds' option should be added as the first option

    // Set it to readonly
    tt.comp(":Readonly").click();
    await test.waitForUI();
    // The 'amount' and 'unit' comps should be replaced with a 'period' text showing the written out value
    testPanel = test.compByName("componentpanel");
    amountComp = testPanel.querySelector("t-textedit[data-name*=amount] input");
    unitComp = testPanel.querySelector("select[data-name*=unit]");
    periodComp = testPanel.querySelector("t-text[data-name*=period]");
    test.assert(!amountComp);
    test.assert(!unitComp);
    test.assert(periodComp);
    test.eq("1 millisecond", periodComp.textContent);
  },
]);
