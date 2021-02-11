import * as test from '@mod-tollium/js/testframework';

var gesture_time = 25;

var testimg;

function testBackground(doc, win)
{
  // Check the background image dimensions by loading the background image url into an img element
  var preview = test.compByName("fragment1!preview");
  test.true(preview);
  var backgrounds = getComputedStyle(preview).backgroundImage.split("url(");
  test.eq(3, backgrounds.length); // empty, uploaded image, checkered background
  testimg = doc.createElement("img");
  let p = new Promise((resolve, reject) =>
  {
    testimg.addEventListener("load", resolve);
    testimg.addEventListener("error", e => reject(new Error("load error, " + e)));
  });
  // In Chrome, the url is enclosed in quotes, in Safari it's not
  let src = backgrounds[1];
  if (src[0] == "\"")
    src = src.split("\"")[1];
  else
    src = src.split("\"")[0];
  testimg.src = src;
  return p;
}

var TestImageEditor =
  [ { name: "image editor"
    , test: function(doc, win)
      {
        // Test if the image editor screen is now opened
        var editor = test.qS("t-custom[data-name='imageeditor']");
        test.true(editor);
        var toolbar = editor.querySelector(".wh-toolbar");
        test.true(toolbar);
        var surface = editor.querySelector(".wh-image-surface");
        test.true(surface);
      }
    }

  , { name: "activate image cropping"
    , test: function(doc, win)
      {
        var editor = test.qS("t-custom[data-name='imageeditor']");
        var toolbar = editor.querySelector(".wh-toolbar");
        var cropbutton = test.qSA(toolbar, ".wh-toolbar-button").filter(button => button.textContent.includes('Crop'))[0];
        test.click(cropbutton);

        // Resize the cropbox
        var cropbox = editor.querySelector(".wh-cropbox");
        test.true(cropbox);

        var coords = cropbox.getBoundingClientRect();
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 4, clienty: coords.top + 4 }
                              , { up: 0, clientx: coords.left + 156, clienty: coords.top + 257, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ "pointer", "animationframe" ]
    }

  , { test: function(doc, win)
      {
        // Resize the cropbox some more
        var editor = test.qS("t-custom[data-name='imageeditor']");
        var cropbox = editor.querySelector(".wh-cropbox");
        var coords = cropbox.getBoundingClientRect();
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.right - 4, clienty: coords.bottom - 4 }
                              , { up: 0, clientx: coords.right - 258, clienty: coords.bottom - 75, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ "pointer", "animationframe" ]
    }


  , test.testClickTolliumButton("Cancel", { name: "cancel crop" })
  , test.testClickTolliumButton("Save", { name: "save image" })

  , { name: "image crop cancelled"
    , test: function(doc, win)
      {
        // Check if the image size hasn't changed (it's set by the tollium backend based on the uploaded blob)
        var dimensions = test.compByName('fragment1!dimensions');
        test.true(dimensions);
        test.eq("1024X768", dimensions.textContent.replace(/[^0-9]/, "X"));

        test.click(test.compByName("fragment1!editbutton"));
      }
    , waits: [ "ui" ]
    }

  , { name: "activate image cropping again"
    , test: function(doc, win)
      {
        var editor = test.qS("t-custom[data-name='imageeditor']");
        var toolbar = editor.querySelector(".wh-toolbar");
        var cropbutton = test.qSA(toolbar, ".wh-toolbar-button").filter(button => button.textContent.includes('Crop'))[0];
        test.click(cropbutton);

        // Resize the cropbox
        var cropbox = editor.querySelector(".wh-cropbox");
        test.true(cropbox);

        var coords = cropbox.getBoundingClientRect();
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 4, clienty: coords.top + 4 }
                              , { up: 0, clientx: coords.left + 156, clienty: coords.top + 257, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ "pointer", "animationframe" ]
    }

  , { test: function(doc, win)
      {
        // Resize the cropbox some more
        var editor = test.qS("t-custom[data-name='imageeditor']");
        var cropbox = editor.querySelector(".wh-cropbox");
        var coords = cropbox.getBoundingClientRect();
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.right - 4, clienty: coords.bottom - 4 }
                              , { up: 0, clientx: coords.right - 258, clienty: coords.bottom - 75, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ "pointer", "animationframe" ]
    }


  , test.testClickTolliumButton("OK", { name: "apply crop" })
  , test.testClickTolliumButton("Save", { name: "save image" })

  , { name: "image saved"
    , test: function(doc, win)
      {
        // Check if the image size is set correctly (it's set by the tollium backend based on the uploaded blob)
        var dimensions = test.compByName('fragment1!dimensions');
        test.true(dimensions);
        test.eq("367X241", dimensions.textContent.replace(/[^0-9]/, "X"));

        var filename = test.compByName('fragment1!filename');
        test.true(filename);
        test.eq("imgeditfile.jpg", filename.textContent); // The ".jpeg" extension will be rewritten to ".jpg"
      }
    }

  , { test: testBackground }

  , { test: function(doc, win)
      {
        test.eq(367, testimg.width);
        test.eq(241, testimg.height);
        testimg = null;

        test.click(test.compByName("fragment1!editbutton"));
      }
    , waits: [ "ui" ]
    }

  , { name: "edit image"
    , test: function(doc, win)
      {
        // Test if the image editor screen is now opened
        var editor = test.qS("t-custom[data-name='imageeditor']");
        test.true(editor);
        var toolbar = editor.querySelector(".wh-toolbar");
        test.true(toolbar);
        var surface = editor.querySelector(".wh-image-surface");
        test.true(surface);
      }
    }

  , "Apply filters"
  , async function()
    {
      let filterbutton = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button").filter(button => button.textContent.includes('Apply Filters'))[0];
      test.true(filterbutton);
      test.click(filterbutton);

      let invertbutton = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button").filter(button => button.textContent.includes('Invert'))[0];
      test.true(invertbutton);
      test.click(invertbutton);
      await test.wait('ui');

      test.clickTolliumButton("OK");
      await test.wait('ui');

      test.clickTolliumButton("Save");
      await test.wait('ui');
    }
  ];

test.registerTests(
  [ { name: "load component test page"
    , loadpage: function()
      {
        // Delayed to pick up overridetoken
        return test.getCompTestPage("imgedit", { width: "250px"
                                               , height: "250px"
                                               }, "sut");
      }
    , waits: [ "ui" ]
    }

  , { name: "button status"
    , test: function(doc, win)
      {
        test.true(test.compByName("fragment1!uploadbutton"));
        test.true(test.compByName("fragment1!publisherbutton"));
        test.false(test.compByName("fragment1!editbutton"));
        test.false(test.compByName("fragment1!downloadbutton"));
        test.false(test.compByName("fragment1!clearbutton"));
      }
    }

  , { name: "upload image"
    , test: async function(doc, win)
      {
        let uploadpromise = test.prepareUpload(
            [ { url: "/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"
              , filename: "imgeditfile.jpeg"
              }
            ]);

        test.click(test.compByName("fragment1!uploadbutton"));
        await uploadpromise;
      }
    //, waits: [ "ui", "uploadprogress", "ui" ]
    , waits: ["ui"]
    }
    //note: the editor is skipped, because the image is already proper and then we won't auto-open
  , { test:function(doc,win)
      {
        console.log(doc.querySelectorAll("t-button"));
        test.true(test.compByName("fragment1!editbutton"));
        test.click(test.compByName("fragment1!editbutton"));
      }
    , waits: [ "ui" ]
    }

  , ...TestImageEditor

  , "Button status"
  , async function()
    {
      test.false(test.compByName("fragment1!uploadbutton"));
      test.false(test.compByName("fragment1!publisherbutton"));
      test.true(test.compByName("fragment1!editbutton"));
      test.click(test.compByName("fragment1!otherbutton"));
      test.true(test.canClick(test.getOpenMenuItem('Replace by upload')));
      test.true(test.canClick(test.getOpenMenuItem('Download')));
      test.true(test.canClick(test.getOpenMenuItem('Properties')));
    }

  , "Set properties"
  , async function()
    {
      test.click(test.getOpenMenuItem('Properties'));
      await test.wait('ui');
      test.eq("imgeditfile.jpg", test.compByName("filename").querySelector("input").value);
      test.compByName("filename").querySelector("input").value = "img2.jpg";
      //TODO test the color picker, refpoint eiditng...
      test.clickTolliumButton("OK");
      await test.wait('ui');

      var filename = test.compByName('fragment1!filename');
      test.true(filename);
      test.eq("img2.jpg", filename.textContent);
    }

  , { name: "visibility"
    , test: function(doc, win)
      {
        test.true(test.compByName("fragment1!preview"));
        test.click(test.compByName("visible"));
      }
    , waits: [ "ui" ]
    }

  , { test: function(doc, win)
      {
        test.false(test.compByName("fragment1!preview"));
        test.click(test.compByName("visible"));
      }
    , waits: [ "ui" ]
    }

  , { test: testBackground }

  , { test: function(doc, win)
      {
        test.eq(367, testimg.width);
        test.eq(241, testimg.height);
        testimg = null;
      }
    }

  , { name: "button status"
    , test: function(doc, win)
      {
        test.false(test.compByName("fragment1!uploadbutton"));
        test.false(test.compByName("fragment1!publisherbutton"));
        test.true(test.compByName("fragment1!editbutton"));
        //test.true(test.compByName("fragment1!downloadbutton"));
        //test.true(test.compByName("fragment1!clearbutton"));

        test.click(test.compByName("visible"));
      }
    , waits: [ "ui" ]
    }

  , { test: function(doc, win)
      {
        test.false(test.compByName("fragment1!uploadbutton"));
        test.false(test.compByName("fragment1!publisherbutton"));
        test.false(test.compByName("fragment1!editbutton"));
        //test.false(test.compByName("fragment1!downloadbutton"));
        //test.false(test.compByName("fragment1!clearbutton"));

        test.click(test.compByName("visible"));
      }
    , waits: [ "ui" ]
    }

  , { name: "clear image"
    , test: function(doc, win)
      {
        test.click(test.compByName("fragment1!clearbutton"));
      }
    , waits: [ "ui" ]
    }

  , test.testClickTolliumButton("Yes", { name: "confirm clear image", waits: [ "ui" ] })

  , { name: "imgedit status"
    , test: function(doc, win)
      {
        test.true(test.compByName("fragment1!uploadbutton"));
        test.true(test.compByName("fragment1!publisherbutton"));
        test.false(test.compByName("fragment1!editbutton"));
        //test.false(test.compByName("fragment1!downloadbutton"));
        //test.false(test.compByName("fragment1!clearbutton"));

        // Check the background image, there should be only one (the placeholder)
        var preview = test.compByName("fragment1!preview");
        test.true(preview);
        var backgrounds = getComputedStyle(preview).backgroundImage.split("url(");
        test.eq(2, backgrounds.length);
      }
    }

  , { name: "open browse for object"
    , test: function(doc, win)
      {
        test.click(test.compByName("fragment1!publisherbutton"));
      }
    , waits: [ "ui" ]
    }

  //, ToddTest.selectListRow("open root node", "folders!thelist", "{.fsroot}", { doubleclick: true, waits: [ "ui" ] })
  //, ToddTest.selectListRow("open testfolder node", "folders!thelist", "webhare_testsuite.testfolder", { doubleclick: true, waits: [ "ui" ] })
  , test.testSelectListRow("folders!thelist", "WebHare testsuite site", { name: "open testsite node", waits: [ "ui" ] })

  , { name: "select image"
    , test: async function(doc, win)
      {
        var testpagerow = test.getCurrentScreen().getListRow('folders!thelist', 'testpages');
        test.true(testpagerow);
        test.click(testpagerow);
        await test.wait('ui');

        var thumbnailtab = test.compByName("thumbnailtab");
        var textnodes = test.qSA(thumbnailtab, "t-text").filter(node => node.textContent === "imgeditfile.jpeg");
        test.eq(1, textnodes.length);
        test.click(textnodes[0]);
      }
    }

  , test.testClickTolliumButton("OK", "select file")
  , ...TestImageEditor

  , "Image dropping"
  , async function()
    {
      // Get the file to drop
      const imgurl = `/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg`;
      const file = await test.getFileFromURL(imgurl, "portrait_8.jpg");

      const droptarget = test.compByName("fragment1!droptarget");
      test.startExternalFileDrag(file);

      // drop it
      await test.sendMouseGesture([ { el: droptarget, up: 0 } ]);
      await test.wait('ui');

      // Check if the image arrived
      test.eq("portrait_8.jpg", test.compByName('fragment1!filename').textContent);
    }
  ]);
