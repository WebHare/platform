//@ts-ignore - still needs porting
import * as compatupload from '@mod-system/js/compat/upload';
import * as test from '@mod-tollium/js/testframework';
import { createClient } from "@webhare/jsonrpc-client";

test.registerTests(
  [
    "Test upload",

    async function () {
      await test.load('/tollium_todd.res/webhare_testsuite/designfiles/net/upload/upload.shtml');

      test.assert(Boolean(window.Blob));

      // Create a blob
      const blob1 = new Blob(['1234'], { type: "text/plain" });
      const blob2 = new Blob(['23456'], { type: "" });

      // Just add some names to emulate file
      (blob1 as unknown as { name: string }).name = 'file1.txt';
      (blob2 as unknown as { name: string }).name = 'file2.txt';

      const group: any = await new Promise(resolve => {
        ///@ts-ignore -- Yes it exists
        const uploadgroup: any = test.getWin().test.runUpload([blob1, blob2], () => resolve(uploadgroup));

        const items = uploadgroup.getItems();
        test.eq(2, items.length);
        test.eq('text/plain', items[0].type);
        test.eq(4, items[0].size);
        test.eq('', items[1].type);
        test.eq(5, items[1].size);

      });

      //check result

      test.eq('loaded', group.status);
      test.eq('loaded', group.getItems()[0].status);
      test.eq('loaded', group.getItems()[1].status);

      const rpc = createClient("webhare_testsuite:testnoauth") as any;
      const requestresult = await rpc.getWebserverUploadedFiles(group.getFileTokens());

      // checkuploadedfiles
      test.eq(
        [
          {
            contenttype: "text/plain",
            data: "7110EDA4D09E062AA5E4A390B0A572AC0D2C0220",
            filename: "file1.txt"
          },
          {
            contenttype: "text/plain",
            data: "C24D0A1968E339C3786751AB16411C2C24CE8A2E",
            filename: "file2.txt"
          }
        ], requestresult);
    },

    "Test mega file",
    async function () {
      // Make 2 strings 64MB in length
      let megafile_1 = '12345678';
      let megafile_2 = '87654321';
      for (let i = 0; i < 26 - 4; ++i) {
        megafile_1 += megafile_1;
        megafile_2 += megafile_2;
      }

      // Create a blob
      const blob1 = new Blob([megafile_1]);
      const blob2 = new Blob([megafile_2]);

      // Just add some names to emulate file
      (blob1 as unknown as { name: string }).name = 'file1.txt';
      (blob2 as unknown as { name: string }).name = 'file2.txt';

      const group: any = await new Promise(resolve => {
        ///@ts-ignore -- Yes it exists
        const uploadgroup: any = test.getWin().test.runUpload([blob1, blob2], () => resolve(uploadgroup));

        const items = uploadgroup.getItems();
        test.eq(2, items.length);
        test.eq(megafile_1.length, items[0].size);
        test.eq(megafile_2.length, items[1].size);
      });

      //check the results
      test.eq('loaded', group.status);
      test.eq('loaded', group.getItems()[0].status);
      test.eq('loaded', group.getItems()[1].status);

      const rpc = createClient("webhare_testsuite:testnoauth") as any;
      const requestresult = await rpc.getWebserverUploadedFiles(group.getFileTokens());

      test.eq(
        [
          {
            contenttype: "text/plain",
            data: '1B656360F31543C2865AF0EC1ABBB1589091E481',
            filename: "file1.txt"
          },
          {
            contenttype: "text/plain",
            data: '9EDCB693038A5FEF733730ABB8BCD1542DF75276',
            filename: "file2.txt"
          }
        ], requestresult);
    },

    "testSelectAndUpload",
    async function () {
      test.prepareUploadTest(test.qS('#myinput'), [
        {
          url: '/tests/webhare.png',
          filename: 'webhare.png'
        }
      ]);

      const uploadfiles = await compatupload.selectFiles();
      (uploadfiles[0] as any).userdata = { hash: "1234" };
      const group = new compatupload.UploadSession(uploadfiles);

      const requestresult =
      {
        events: [] as string[],
        group: group,
        finishevent: null
      };

      group.addEventListener("wh:upload-start", function () { requestresult.events.push('loadstart'); });
      group.addEventListener("wh:upload-end", function () { requestresult.events.push('loadend'); });

      const files = await group.upload();

      test.eq(['loadstart', 'loadend'], requestresult.events);

      test.eq(1, files.length);
      test.eq('webhare.png', files[0].name);
      test.eq(4355, files[0].size);
      test.eq('image/png', files[0].type);
      test.eq({ hash: "1234" }, (files[0] as any).userdata);
    }
  ]);
