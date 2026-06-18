import * as test from "@mod-tollium/js/testframework";
import * as tt from "@mod-tollium/js/tolliumtest";


test.runTests(
  [ // ---------------------------------------------------------------------------
    //
    // "Chips"
    //

    "Load",
    async function () {
      await test.load(test.getCompTestPage('chips', { rowkeytype: 34, icons: ["tollium:actions/center"] })); // TypeID(STRING) = 34
      tt.comp(":Visible").click();
      await test.waitForUI();
      tt.comp(":Visible").click();
      await test.waitForUI();

      const testpanel = test.compByName("componentpanel");
      const comp = testpanel.querySelector('t-chips');
      test.assert(comp, "Chips component should be present in the component panel");
    },

    "Update the chips",
    async function () {
      const testpanel = test.compByName("componentpanel");
      tt.comp(":Update chips").click();
      await test.waitForUI();

      // check if there are 5 chips
      let comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.eq(5, comp.querySelectorAll("div.t-chips__chip").length, "There should be 5 chips after update");

      // select the first chip
      console.warn(`clicking first chip`);
      test.click(test.qS(comp, "div.t-chips__chip")!);
      await test.waitForUI();
      console.warn(`clicking value read`);
      tt.comp("readvaluebutton").click();
      await test.waitForUI();
      test.eq(`"first"`, tt.comp(":Value").querySelector("input")?.value);

      comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.click(test.qSA(comp, "div.t-chips__chip")[1]);
      await test.waitForUI();
      tt.comp("readvaluebutton").click();
      await test.waitForUI();
      test.eq(`"second"`, tt.comp(":Value").querySelector("input")?.value);

      tt.comp(":listen openaction").click();
      await test.waitForUI();
      // triggers component reload, so need to retrieve the component again
      comp = testpanel.querySelector('t-chips') as HTMLDivElement;

      test.click(test.qSA(comp, "div.t-chips__chip")[2]);
      await test.waitForUI(); // onselect handler triggers modality layer

      comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.click(test.qSA(comp, "div.t-chips__chip")[2]);
      await test.waitForUI();
      test.eq("1", tt.comp("opencounter").querySelector("input")?.value);

      // layout:
      // 111111 222222 3333
      // 4444 55555

      await test.pressKey("ArrowLeft");
      await test.waitForUI();
      test.eq(/Another long/, test.getDoc().activeElement?.textContent || "");
      await test.pressKey("ArrowDown");
      await test.waitForUI();
      test.eq(/fifth/, test.getDoc().activeElement?.textContent || "");
      await test.pressKey("ArrowUp");
      await test.waitForUI();
      // up/down remember their original chip, and should go to the node that overlaps the starting x of that node
      test.eq(/Another long/, test.getDoc().activeElement?.textContent || "");
      await test.pressKey(" ");
      await test.waitForUI();
      test.eq("second", JSON.parse(tt.comp(":Selection").querySelector("input")?.value || "{}").rowkey);
      await test.pressKey("Enter");
      await test.waitForUI();
      test.eq("2", tt.comp("opencounter").querySelector("input")?.value);
      await test.pressKey("ArrowRight");
      await test.waitForUI();
      test.eq(/third/, test.getDoc().activeElement?.textContent || "");
    },

    "Enableon",
    async function () {
      const testpanel = test.compByName("componentpanel");

      tt.comp(":included1").click();
      await test.waitForUI();
      tt.comp(":included2").click();
      await test.waitForUI();

      const comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.click(comp.querySelectorAll("div.t-chips__chip")[0]!);
      await test.waitForUI();

      test.eq(false, tt.comp(":EnableOnTarget1").querySelector("input")?.readOnly);
      test.eq(true, tt.comp(":EnableOnTarget2").querySelector("input")?.readOnly);

      test.click(comp.querySelectorAll("div.t-chips__chip")[1]!);
      await test.waitForUI();

      test.eq(false, tt.comp(":EnableOnTarget1").querySelector("input")?.readOnly);
      test.eq(false, tt.comp(":EnableOnTarget2").querySelector("input")?.readOnly);
    },

    "Disabled",
    async function () {
      const testpanel = test.compByName("componentpanel");

      tt.comp(":Enabled").click();
      await test.waitForUI();

      const comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.assert(comp.classList.contains("t-chips--disabled"), "Component should have disabled class when disabled");
      test.click(comp.querySelectorAll("div.t-chips__chip")[0]!);
      await test.waitForUI();

      test.eq("second", JSON.parse(tt.comp(":Selection").querySelector("input")?.value || "{}").rowkey, "Clicking chip when disabled should not change selection");

      // renable
      tt.comp(":Enabled").click();
      await test.waitForUI();
    },

    "Set selection",
    async function () {
      const testpanel = test.compByName("componentpanel");

      tt.comp(":Value").querySelector("input")!.value = `"third"`;
      tt.comp("writevaluebutton").click();
      await test.waitForUI();

      const comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.assert(test.qSA(comp, "div.t-chips__chip")[2].classList.contains("t-chips__chip--selected"));
    },

    "Height resize",
    async function () {
      const splith_splitter = tt.comp("splith").querySelector(":scope > t-split__splitter");
      test.assert(splith_splitter, "Horizontal splitter should be present");

      await test.sendMouseGesture([
        { el: splith_splitter, down: 0 },
        { relx: -250, up: 0, delay: 10 }
      ]);

      // should resize to 3 lines
      const testpanel = test.compByName("componentpanel");
      const comp = testpanel.querySelector('t-chips') as HTMLDivElement;
      test.assert(comp.clientHeight > 56); // larger than 2 grid lines

      await test.sendMouseGesture([
        { el: splith_splitter, down: 0 },
        { el: comp, x: 200, up: 0, delay: 10 }
      ]);

      // no overflow of the chips
      test.assert((comp.querySelector("div.t-chips__chip") as HTMLDivElement).offsetWidth === 200);
    },

    "Load with integer keys",
    async function () {
      await test.load(test.getCompTestPage('chips', { rowkeytype: 16, icons: ["tollium:actions/center"] })); // TypeID(STRING) = 34
      tt.comp(":Visible").click();
      await test.waitForUI();
      tt.comp(":Visible").click();
      await test.waitForUI();

      const testpanel = test.compByName("componentpanel");
      let comp = testpanel.querySelector('t-chips');
      test.assert(comp, "Chips component should be present in the cozmponent panel");

      // see if update also works with integer keys
      tt.comp(":Update chips").click();
      await test.waitForUI();

      // select the first chip
      comp = testpanel.querySelector('t-chips');
      console.warn(`clicking first chip`);
      test.click(test.qS(comp, "div.t-chips__chip")!);
      await test.waitForUI();
      console.warn(`clicking value read`);
      tt.comp("readvaluebutton").click();
      await test.waitForUI();
      test.eq(`1`, tt.comp(":Value").querySelector("input")?.value);
    },

    "Enableon with readonly",
    async function () {
      tt.comp(":included1").click();
      await test.waitForUI();
      tt.comp(":included2").click();
      await test.waitForUI();

      test.assert(tt.comp(":EnableOnTarget1").querySelector<HTMLInputElement>("input")?.readOnly === false);
      tt.comp(":Value").querySelector("input")!.value = "3";
      await test.waitForUI();
      tt.comp("writevaluebutton").click();
      await test.waitForUI();

      test.assert(tt.comp(":EnableOnTarget1").querySelector<HTMLInputElement>("input")?.readOnly);
    }
  ]);
