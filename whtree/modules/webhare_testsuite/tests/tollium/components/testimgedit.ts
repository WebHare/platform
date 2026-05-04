import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";
import { prepareUpload, fetchAsFile } from '@webhare/test-frontend';

const gesture_time = 25;

let testimg: HTMLImageElement | null = null;

function testBackground() {
  // Check the background image dimensions by loading the background image url into an img element
  const preview = test.compByName("fragment1!preview");
  test.assert(preview);
  const backgrounds = getComputedStyle(preview).backgroundImage.split("url(");
  test.eq(3, backgrounds.length); // empty, uploaded image, checkered background
  testimg = test.getDoc().createElement("img");
  const p = new Promise((resolve, reject) => {
    testimg!.addEventListener("load", resolve);
    testimg!.addEventListener("error", e => reject(new Error("load error, " + e)));
  });
  // In Chrome, the url is enclosed in quotes, in Safari it's not
  let src = backgrounds[1];
  if (src[0] === "\"")
    src = src.split("\"")[1];
  else
    src = src.split("\"")[0];
  testimg.src = src;
  return p;
}

const TestImageEditor =
  [
    {
      name: "image editor",
      test: function () {
        // Test if the image editor screen is now opened
        const editor = test.qR("t-custom[data-name='imageeditor']");
        const toolbar = editor.querySelector(".wh-toolbar");
        test.assert(toolbar);
        const surface = editor.querySelector(".wh-image-surface");
        test.assert(surface);
      }
    },

    {
      name: "activate image cropping",
      test: async function () {
        const editor = test.qR("t-custom[data-name='imageeditor']");
        test.click(await test.waitForElement([editor, ".wh-toolbar-button", /Crop/]));

        // Resize the cropbox
        const cropbox = editor.querySelector(".wh-cropbox");
        test.assert(cropbox);

        const coords = cropbox.getBoundingClientRect();
        await test.sendMouseGesture([
          { down: 0, clientx: coords.left + 4, clienty: coords.top + 4 },
          { up: 0, clientx: coords.left + 156, clienty: coords.top + 257, delay: gesture_time, transition: test.dragTransition }
        ]);
        await test.wait("animationframe");
      }
    },

    {
      test: async function () {
        // Resize the cropbox some more
        const cropbox = test.qR("t-custom[data-name='imageeditor'] .wh-cropbox");
        const coords = cropbox.getBoundingClientRect();
        await test.sendMouseGesture([
          { down: 0, clientx: coords.right - 4, clienty: coords.bottom - 4 },
          { up: 0, clientx: coords.right - 258, clienty: coords.bottom - 75, delay: gesture_time, transition: test.dragTransition }
        ]);
        await test.wait("animationframe");

        //cancel crop
        tt.comp(":Cancel").click();
        await test.waitForUI();
        //save image
        tt.comp(":Save").click();
        await test.waitForUI();
      }
    },

    {
      name: "image crop cancelled",
      test: async function () {
        // Check if the image size hasn't changed (it's set by the tollium backend based on the uploaded blob)
        const dimensions = test.compByName('fragment1!dimensions');
        test.assert(dimensions);
        test.eq("1024X768", dimensions.textContent.replace(/[^0-9]/, "X"));

        test.click(test.compByName("fragment1!editbutton"));
        await test.waitForUI();
      }
    },

    {
      name: "activate image cropping again",
      test: async function () {
        const toolbar = test.qR("t-custom[data-name='imageeditor'] .wh-toolbar");
        const cropbutton = test.qSA(toolbar, ".wh-toolbar-button").filter(button => button.textContent?.includes('Crop'))[0];
        test.click(cropbutton);

        // Resize the cropbox
        const cropbox = test.qR("t-custom[data-name='imageeditor'] .wh-cropbox");
        test.assert(cropbox);

        const coords = cropbox.getBoundingClientRect();
        await test.sendMouseGesture([
          { down: 0, clientx: coords.left + 4, clienty: coords.top + 4 },
          { up: 0, clientx: coords.left + 156, clienty: coords.top + 257, delay: gesture_time, transition: test.dragTransition }
        ]);
        await test.wait("animationframe");
      }
    },

    {
      test: async function () {
        // Resize the cropbox some more
        const cropbox = test.qR("t-custom[data-name='imageeditor'] .wh-cropbox");
        const coords = cropbox.getBoundingClientRect();
        await test.sendMouseGesture([
          { down: 0, clientx: coords.right - 4, clienty: coords.bottom - 4 },
          { up: 0, clientx: coords.right - 258, clienty: coords.bottom - 75, delay: gesture_time, transition: test.dragTransition }
        ]);
        await test.wait("animationframe");
        //apply crop
        tt.comp(":OK").click();
        await test.waitForUI();
        //save image
        tt.comp(":Save").click();
        await test.waitForUI();
      }
    },

    {
      name: "image saved",
      test: function () {
        // Check if the image size is set correctly (it's set by the tollium backend based on the uploaded blob)
        const dimensions = test.compByName('fragment1!dimensions');
        test.assert(dimensions);
        test.eq("367X241", dimensions.textContent.replace(/[^0-9]/, "X"));

        const filename = test.compByName('fragment1!filename');
        test.assert(filename);
        test.assert(["rangetestfile.jpg", "imgeditfile.jpeg"].includes(filename.textContent));
      }
    },

    { test: testBackground },

    {
      test: async function () {
        test.eq(367, testimg?.width);
        test.eq(241, testimg?.height);
        testimg = null;

        test.click(test.compByName("fragment1!editbutton"));
        await test.waitForUI();
      }
    },

    {
      name: "edit image",
      test: function () {
        // Test if the image editor screen is now opened
        const editor = test.qR("t-custom[data-name='imageeditor']");
        test.assert(editor);
        const toolbar = editor.querySelector(".wh-toolbar");
        test.assert(toolbar);
        const surface = editor.querySelector(".wh-image-surface");
        test.assert(surface);
      }
    },

    "Save",
    async function () {
      test.clickTolliumButton("Save");
      await test.waitForUI();
    }
  ] satisfies test.RegisteredTestSteps;

test.runTests(
  [
    {
      name: "load component test page",
      test: async function () {
        await test.load(test.getCompTestPage("imgedit", {
          width: "250px",
          height: "250px"
        }));
        await test.waitForUI();
      }
    },

    {
      name: "button status",
      test: function () {
        test.assert(test.compByName("fragment1!uploadbutton"));
        test.assert(test.compByName("fragment1!publisherbutton"));
        test.assert(!test.compByName("fragment1!editbutton"));
        test.assert(!test.compByName("fragment1!downloadbutton"));
        test.assert(!test.compByName("fragment1!clearbutton"));
      }
    },

    {
      name: "upload image",
      test: async function () {
        prepareUpload(["/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"]);
        test.click(test.compByName("fragment1!uploadbutton"));
        await test.wait(() => test.compByName("fragment1!editbutton"));
        await test.waitForUI();
      }
    },
    //note: the editor is skipped, because the image is already proper and then we won't auto-open
    {
      test: async function () {
        test.assert(test.compByName("fragment1!editbutton"));
        test.click(test.compByName("fragment1!editbutton"));
        await test.waitForUI();
      }
    },

    ...TestImageEditor,

    "Button status",
    async function () {
      test.assert(!test.compByName("fragment1!uploadbutton"));
      test.assert(!test.compByName("fragment1!publisherbutton"));
      test.assert(test.compByName("fragment1!editbutton"));
      test.click(test.compByName("fragment1!otherbutton"));
      test.assert(test.canClick(test.getOpenMenuItem('Replace by upload')!));
      test.assert(test.canClick(test.getOpenMenuItem('Download')!));
      test.assert(test.canClick(test.getOpenMenuItem('Properties')!));
    },

    "Set properties",
    async function () {
      test.click(test.getOpenMenuItem('Properties')!);
      await test.waitForUI();
      test.eq("rangetestfile.jpg", test.compByName("filename").querySelector("input").value);
      test.compByName("filename").querySelector("input").value = "img2.jpg";
      //TODO test the color picker, refpoint eiditng...
      test.clickTolliumButton("OK");
      await test.waitForUI();

      const filename = test.compByName('fragment1!filename');
      test.assert(filename);
      test.eq("img2.jpg", filename.textContent);
    },

    {
      name: "visibility",
      test: async function () {
        test.assert(test.compByName("fragment1!preview"));
        test.click(test.compByName("visible"));
        await test.waitForUI();
      }
    },

    {
      test: async function () {
        test.assert(!test.compByName("fragment1!preview"));
        test.click(test.compByName("visible"));
        await test.waitForUI();
      }
    },

    { test: testBackground },

    {
      test: function () {
        test.eq(367, testimg?.width);
        test.eq(241, testimg?.height);
        testimg = null;
      }
    },

    {
      name: "button status",
      test: async function () {
        test.assert(!test.compByName("fragment1!uploadbutton"));
        test.assert(!test.compByName("fragment1!publisherbutton"));
        test.assert(test.compByName("fragment1!editbutton"));
        //test.assert(test.compByName("fragment1!downloadbutton"));
        //test.assert(test.compByName("fragment1!clearbutton"));

        test.click(test.compByName("visible"));
        await test.waitForUI();
      }
    },

    {
      test: async function () {
        test.assert(!test.compByName("fragment1!uploadbutton"));
        test.assert(!test.compByName("fragment1!publisherbutton"));
        test.assert(!test.compByName("fragment1!editbutton"));
        //test.assert(!test.compByName("fragment1!downloadbutton"));
        //test.assert(!test.compByName("fragment1!clearbutton"));

        test.click(test.compByName("visible"));
        await test.waitForUI();
      }
    },

    {
      name: "clear image",
      test: async function () {
        test.click(test.compByName("fragment1!clearbutton"));
        await test.waitForUI();
      }
    },

    "confirm clear image",
    async function () {
      test.clickTolliumButton("Yes");
      await test.waitForUI();
    },

    {
      name: "imgedit status",
      test: function () {
        test.assert(test.compByName("fragment1!uploadbutton"));
        test.assert(test.compByName("fragment1!publisherbutton"));
        test.assert(!test.compByName("fragment1!editbutton"));
        //test.assert(!test.compByName("fragment1!downloadbutton"));
        //test.assert(!test.compByName("fragment1!clearbutton"));

        // Check the background image, there should be only one (the placeholder)
        const preview = test.compByName("fragment1!preview");
        test.assert(preview);
        const backgrounds = getComputedStyle(preview).backgroundImage.split("url(");
        test.eq(2, backgrounds.length);
      }
    },

    {
      name: "open browse for object",
      test: async function () {
        test.click(test.compByName("fragment1!publisherbutton"));
        await test.waitForUI();
      }
    },

    "open testsite node",
    async function () {
      await test.selectListRow("folders!thelist", "webhare_testsuite.testsite");
      await test.waitForUI();
    },

    {
      name: "select image",
      test: async function () {
        const testpagerow = test.getCurrentScreen().getListRow('folders!thelist', 'TestPages');
        test.assert(testpagerow);
        test.click(testpagerow);
        await test.waitForUI();

        const thumbnailtab = test.compByName("thumbnailtab");
        const textnodes = test.qSA(thumbnailtab, "t-text").filter(node => node.textContent === "imgeditfile.jpeg");
        test.eq(1, textnodes.length);
        test.click(textnodes[0]);

        //select file
        tt.comp(":OK").click();
        await test.waitForUI();
      }
    },

    ...TestImageEditor,

    "Image dropping",
    async function () {
      // Get the file to drop
      const file = await fetchAsFile(`/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg`);

      const droptarget = test.compByName("fragment1!droptarget");
      test.startExternalFileDrag(file);

      // drop it
      await test.sendMouseGesture([{ el: droptarget, up: 0 }]);
      await test.wait(() => test.compByName('fragment1!filename')?.textContent === "portrait_8.jpg");
    }
  ]);
