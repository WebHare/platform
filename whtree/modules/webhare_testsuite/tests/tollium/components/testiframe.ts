/* eslint-disable */

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import { loadImage } from "@webhare/dompack";
import { isTruthy } from "@webhare/std";

let lasttextareavalue = '';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.iframetest");
    },

    {
      name: 'iframeloadwait',
      test: function () {
        lasttextareavalue = test.qSA('textarea')[0].value;
        //var iframe = test.qSA('iframe')[0];
        test.click(test.getMenu(['I00']));
      },
      waits: [function () { return test.qSA('textarea')[0].value !== lasttextareavalue; }]
    },

    'iframeinitialcall',
    async function () {
      const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
      const calls = iframe.contentWindow!.document.querySelector<HTMLInputElement>('#calls')!;
      test.eq('func1 1 test\n', calls.value);

      const textarea = test.qSA('textarea')[0];
      test.eq('{"args":[1,"test"],"type":"receivedcall"}', textarea.value.trim());

      test.click(test.getMenu(['I04']));
      await new Promise(resolve => iframe.contentWindow!.addEventListener('message', resolve, { once: true }));
      await test.waitUI();
    },

    {
      name: 'serverdataupdate',
      test: function ()//, callback)
      {
        const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
        const data = iframe.contentWindow!.document.querySelector<HTMLInputElement>('#data')!;
        test.eq('datab', data.value);
        //win.addEvent('message:once', callback);

        // execute 'add a' action
        iframe.contentWindow!.document.getElementById('adda')!.click();
        test.eq('databa', data.value); //this simply tests if the iframe processed its click correctly
        console.log('should start ui wait');
      },
      waits: [100, 'ui'] //100msec as we have no good wait to 'wait' for the postmessage. a less racy alternative would continously press I04 and see if the data is there yet
    },

    'clientdataupdate_prepare',
    async function () {
      const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];

      // Add 'b' to iframe data
      test.click(test.getMenu(['I04']));
      await new Promise(resolve => iframe.contentWindow!.addEventListener('message', resolve, { once: true }));
      await test.waitUI();
    },

    {
      name: 'clientdataupdate',
      test: function () {
        const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
        const data = iframe.contentWindow!.document.querySelector<HTMLInputElement>('#data')!;
        test.eq('databab', data.value);

        // SetHTMLContent
        test.click(test.getMenu(['I01']));
      },
      waits: [
        'ui', () => {
          const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
          const source = iframe.contentWindow!.document.getElementById('source');
          return source && source.dataset.source === 'htmlcontent2';
        }
      ]
    },

    {
      name: 'iframehtmlcontent',
      test: async function () {
        const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];

        // Test html content
        const sourceElement = iframe.contentWindow!.document.querySelector<HTMLElement>('#source')!;
        test.eq('htmlcontent2', sourceElement.dataset.source);
        const imgpreload = await loadImage(iframe.contentWindow!.document.querySelector<HTMLImageElement>('#image')!.src);
        test.eq(428, imgpreload.naturalWidth);

        // Do a JS call outside of loading stage
        test.click(test.getMenu(['I03']));
      },
      waits: [100, 'ui']
    },

    {
      name: 'normalcall',
      test: function () {
        // Test if call was handled properly
        const textarea = test.qSA('textarea')[0];
        test.eq('{"args":[1,"test"],"type":"receivedcall"}\n' +
          'data:data\n' +
          'data:databa\n' +
          '{"args":[3,"test"],"type":"receivedcall"}', textarea.value.trim());
      }
    },

    "contextmenu",
    async function () {
      const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
      const showMenuButton = test.qR(iframe.contentWindow!.document, 'button');

      test.assert(!await test.findElement(["ul.wh-menu.open li", /T01/]));
      test.click(showMenuButton);
      // Ensure menuitem T01 is visible
      const menuItem = await test.waitForElement(["ul.wh-menu.open", /T01/]);
    },

    "iframe blobcontent",
    async function () {
      // Next test: go to blob content
      test.click(test.getMenu(['I02']));

      //wait for blobcontent4 to appear
      const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
      await test.wait(() => iframe.contentWindow!.document.getElementById('source')
        && iframe.contentWindow!.document.getElementById('source')!.dataset.source === 'blobcontent4');

      const imgpreload = await loadImage(iframe.contentWindow!.document.querySelector<HTMLImageElement>('#image')!.src);
      test.eq(428, imgpreload.naturalWidth);

      //next tes: grab links
      test.click(test.getMenu(['I05']));
      await test.waitForUI();
    },

    {
      name: 'clicklink',
      test: async function () {
        const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
        //wait for us to have intercepted the click handler
        await test.wait(() => iframe.contentWindow && "whIframeAttached" in iframe.contentWindow);

        const iframdoc = iframe.contentWindow!.document;
        iframdoc.getElementById('link')?.click();
      },
      waits: ['ui']
    },

    {
      name: 'clicklink verify',
      test: function () {
        const textarea = test.qSA('textarea')[0];
        test.eq('{"args":[1,"test"],"type":"receivedcall"}\n' +
          'data:data\n' +
          'data:databa\n' +
          '{"args":[3,"test"],"type":"receivedcall"}\n' +
          'click:http://www.webhare.dev/', textarea.value.trim());
      }
    },

    {
      name: 'postmessage',
      test: async function () {
        test.click(test.getMenu(['I06'])); //postmessage
        await test.waitForUI();

        const result = await test.wait(() => test.compByName('callbacks').querySelector('textarea').value);
        const origin = test.getWin().location.origin;
        test.eq(`message:{"question":1764}\norigin:${origin}`, result);
      }
    },
    {
      name: 'postrequest',
      test: async function () {
        test.click(test.getMenu(['I07'])); //postrequest
        await test.waitForUI();

        await test.wait(function () { return Boolean(test.compByName('callbacks').querySelector('textarea').value); });

        const result = test.compByName('callbacks').querySelector('textarea').value;
        test.eq(`response:{"response":1764}`, result);
      }
    },

    {
      name: 'assetpack',
      test: async function () {
        test.compByName('callbacks').querySelector('textarea').value = '';
        test.click(test.getMenu(['I08', 'IA01'])); //testassetpack

        async function waitForLine(lineNum: number) {
          const line = await test.wait(() => test.compByName('callbacks').querySelector('textarea').value?.split('\n')[lineNum]);
          return JSON.parse(line);
        }

        test.eq({ greeting: { g: "Hello from the iframe!", initcount: 1, initinfo: "Hi Frame!" } }, await waitForLine(0));
        test.eq({ multiplied: { n: 1764 } }, await waitForLine(1));

        test.click(test.getMenu(['I08', 'IA02'])); //create image
        test.eq({ greeting: { g: "Hello from the iframe!", initcount: 2, initinfo: "another greeting" } }, await waitForLine(2));

        test.click(test.getMenu(['I08', 'IA03'])); //create image
        test.eqPartial({ imagedetails: { height: 16, width: 16, src: /^data:image\/svg\+xml;base64,/ } }, await waitForLine(3));

        //test iframe reload, should reinit with new init settings
        const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
        iframe.contentWindow!.location.reload();
        test.eq({ greeting: { g: "Hello from the iframe!", initcount: 1, initinfo: "another greeting" } }, await waitForLine(4));

        test.focus(test.compByName("input").querySelector("input"));
        await test.wait("ui");
        // The test action should be disabled if the iframe input doesn't have focus
        test.assert(test.compByName("testbutton").classList.contains("todd--disabled"), "test action should be disabled");

        const focusNode = iframe.contentWindow!.document.querySelector("span.focusnode")! as HTMLElement;
        test.focus(focusNode);
        await test.wait("ui");
        await new Promise(resolve => setTimeout(resolve, 1));
        test.assert(!test.compByName("testbutton").classList.contains("todd--disabled"), "test action should be enabled");
        // The iframe input now has focus, so the test action should no longer be disabled
        // (In 5.6 the frame focus code would steal the focus back from the iframe)
        test.clickTolliumButton("IA04");
        await test.wait("ui");
        // The test action should display a 'not implemented' message with a 'information' icon
        test.assert(test.qR(`img[data-toddimg^="tollium:messageboxes/information"]`), "'not implemented' message box should be visible");
        // Close the message
        test.clickTolliumButton("OK");
        await test.wait("ui");
        await new Promise(resolve => setTimeout(resolve, 1));
        test.assert(!test.compByName("testbutton").classList.contains("todd--disabled"), "test action should still be enabled");
        // The iframe should regain focus, run the test action again
        test.clickTolliumButton("IA04");
        await test.wait("ui");
        // The test action should display a 'not implemented' message with a 'information' icon
        test.assert(test.qR(`img[data-toddimg^="tollium:messageboxes/information"]`), "'not implemented' message box should be visible again");
        test.clickTolliumButton("OK");

        // Click the 'Confirm' button, which should display a confirm dialog within Tollium (outside of the iframe)
        test.click(iframe.contentWindow!.document.querySelector("button.confirmnode")!);
        // The button that was clicked will be displayed in the focus node
        await test.wait("ui");
        test.clickToddButton("Yes");
        await test.wait(() => focusNode.innerText === "yes");
      }
    },

    {
      name: 'iframe in contents',
      loadpage: test.getTestScreen('tests/basecomponents.iframetestincontents'),
      waits: [
        'ui', function () {
          const iframe = test.qSA<HTMLIFrameElement>('iframe')[0];
          return Boolean(iframe.contentWindow!.document.querySelector('#source, .wh-errorinfo'));
        }
      ]
    }
  ]);
