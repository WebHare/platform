import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { buildInstance, buildRTD, IntExtLink } from "@webhare/services";
import { exportIntExtLink, importIntExtLink } from "@webhare/services/src/descriptor";
import { whconstant_whfsid_private } from "@mod-system/js/internal/webhareconstants";
import { whfsType, type TypedInstanceExport, type TypedInstanceSource } from "@webhare/whfs";
import { beginWork, commitWork } from "@webhare/whdb";
import type { CodecExportMemberType } from "@webhare/whfs/src/codecs";


async function testIntExtLink() {
  // no mapping
  test.eq({
    append: undefined,
    internalLink: "whfs::/webhare-private/"
  }, await exportIntExtLink(new IntExtLink(whconstant_whfsid_private), {}));

  // sync mapper
  test.eq({
    append: undefined,
    internalLink: "x-custom::xmap"
  }, await exportIntExtLink(new IntExtLink(whconstant_whfsid_private), {
    mapWhfsLink({ id, whfsPath }) {
      test.eq(whconstant_whfsid_private, id);
      test.eq("/webhare-private/", whfsPath);
      return `x-custom::xmap`;
    }
  }));

  // async mapper
  test.eq({
    append: undefined,
    internalLink: "x-custom::xmap"
  }, await exportIntExtLink(new IntExtLink(whconstant_whfsid_private), {
    async mapWhfsLink({ id, whfsPath }) {
      return `x-custom::xmap`;
    }
  }));

  // null-returning mapper, makes export return null
  test.eq(null, await exportIntExtLink(new IntExtLink(whconstant_whfsid_private), {
    async mapWhfsLink({ id, whfsPath }) {
      return null;
    }
  }));

  await test.throws(/WHFS link unmapper is required/, () => importIntExtLink({
    append: undefined,
    internalLink: "x-custom::xmap"
  }));

  test.eq(10, (await importIntExtLink({
    append: undefined,
    internalLink: "x-custom::xmap"
  }, {
    unmapWhfsLink(mappedLink) {
      test.eq("x-custom::xmap", mappedLink);
      return 10;
    }
  }))?.internalLink);

  test.eq(10, (await importIntExtLink({
    append: undefined,
    internalLink: "x-custom::xmap"
  }, {
    async unmapWhfsLink(mappedLink) {
      test.eq("x-custom::xmap", mappedLink);
      return 10;
    }
  }))?.internalLink);
}

const inputInstance: TypedInstanceSource<"webhare_testsuite:global.generic_test_type"> = {
  whfsType: "webhare_testsuite:global.generic_test_type",
  data: {
    myWhfsRef: "x-custom::xmap",
    myWhfsRefArray: ["x-custom::xmap2", "x-custom::xmap3"],
    anArray: [{ aWhfsRef: "x-custom::xmap4" }],
    myLink: { internalLink: "x-custom::xmap11" },
    anInstance: {
      whfsType: "webhare_testsuite:global.generic_test_type",
      data: {
        myWhfsRef: "x-custom::xmap5",
        aTypedRecord: {
          richMember: [
            {
              "p": [
                {
                  text: "Line 1",
                  link: {
                    internalLink: "x-custom::xmap6"
                  }
                }, {
                  image: {
                    data: {
                      base64: "eG1hcF9pbWFnZTE=", // "xmap_image1"
                    },
                    sourceFile: "x-custom::xmap10",
                  },
                }, {
                  inlineWidget: {
                    whfsType: "webhare_testsuite:global.generic_test_type",
                    data: {
                      myWhfsRef: "x-custom::xmap9",
                    }
                  }
                }
              ]
            }, {
              widget: {
                whfsType: "webhare_testsuite:global.generic_test_type",
                data: {
                  myWhfsRef: "x-custom::xmap7",
                  blubImg: {
                    data: {
                      base64: "eG1hcF9pbWFnZTI=", // "xmap_image2"
                    },
                  },
                }
              }
            }
          ],
          aWhfsRef: "x-custom::xmap8"
        },
      }
    }
  }
};

const exportMappedSubInstanceData = (storedOnDisk: boolean): test.RecursiveTestable<{ [x: string]: CodecExportMemberType } | undefined> => ({
  aTypedRecord: {
    richMember: [
      {
        tag: 'p',
        items: [
          {
            text: 'Line 1',
            link: { internalLink: 'x-custom::xmap' }
          }, {
            image: {
              data: {
                base64: "eG1hcF9pbWFnZTE=", // "xmap_image1"
              },
              mediaType: 'application/octet-stream',
              sourceFile: 'x-custom::xmap',
              ...(storedOnDisk ? {
                hash: 'J7v6wPn8pNgVSv03-2PdJN3jq4SzH1XuDcLu8VXwdDk',
                fileName: (fileName: unknown) => Boolean(typeof fileName === "string" && fileName !== ""),
              } : {}),
            },
          }, {
            inlineWidget: {
              whfsType: "webhare_testsuite:global.generic_test_type",
              data: {
                myWhfsRef: "x-custom::xmap",
              }
            }
          }
        ]
      },
      {
        widget: {
          whfsType: 'webhare_testsuite:global.generic_test_type',
          data: {
            myWhfsRef: 'x-custom::xmap',
            blubImg: {
              data: {
                base64: "eG1hcF9pbWFnZTI=", // "xmap_image2"
              },
              mediaType: 'application/octet-stream',
              ...(storedOnDisk ? { hash: 'AT6stwf8ZD-taEuDpGEBnDdX0b2aRmmZ2X4Ni21rGJA' } : {}),
            },
          }
        }
      }
    ],
    aWhfsRef: 'x-custom::xmap'
  },
  myWhfsRef: 'x-custom::xmap'
} satisfies test.RecursiveTestable<TypedInstanceExport<"webhare_testsuite:global.generic_test_type">["data"]>);

const exportMappedInstanceData = (storedOnDisk: boolean): test.RecursiveTestable<TypedInstanceExport<"webhare_testsuite:global.generic_test_type">["data"]> => ({
  anInstance: {
    whfsType: 'webhare_testsuite:global.generic_test_type',
    data: exportMappedSubInstanceData(storedOnDisk),
  },
  anArray: [{ aWhfsRef: 'x-custom::xmap' }],
  myLink: { internalLink: "x-custom::xmap" },
  myWhfsRef: 'x-custom::xmap',
  myWhfsRefArray: ['x-custom::xmap', 'x-custom::xmap']
});

const exportMappedInstance = (storedOnDisk: boolean): test.RecursiveTestable<TypedInstanceExport<"webhare_testsuite:global.generic_test_type">> => ({
  whfsType: 'webhare_testsuite:global.generic_test_type',
  data: exportMappedInstanceData(storedOnDisk)
});


async function testInstance() {
  const seenMapped: string[] = [];
  const instance = await buildInstance(inputInstance, {
    unmapWhfsLink(mappedLink) {
      seenMapped.push(mappedLink);
      return 10; // return webhare-private
    },
  });

  test.eq(11, seenMapped.length);
  test.eq(exportMappedInstance(false), await instance.export({
    mapWhfsLink(data) {
      test.eq(10, data.id);
      test.eq("/webhare-private/", data.whfsPath);
      return "x-custom::xmap";
    },
  }));
}

async function testRtd() {
  const seenMapped: string[] = [];
  const rtd = await buildRTD(
    [
      {
        "p": [
          {
            text: "Line 1",
            link: {
              internalLink: "x-custom::xmap6"
            }
          }, {
            image: {
              data: {
                base64: "eG1hcF9pbWFnZTE=", // "xmap_image1"
              },
              sourceFile: "x-custom::xmap10",
            },
          }, {
            inlineWidget: {
              whfsType: "webhare_testsuite:global.generic_test_type",
              data: {
                myWhfsRef: "x-custom::xmap9",
              }
            }
          }
        ]
      }, {
        widget: {
          whfsType: "webhare_testsuite:global.generic_test_type",
          data: {
            myWhfsRef: "x-custom::xmap7",
            blubImg: {
              data: {
                base64: "eG1hcF9pbWFnZTI=", // "xmap_image2"
              },
            }
          }
        }
      }
    ], {
    unmapWhfsLink(mappedLink) {
      seenMapped.push(mappedLink);
      return 10; // return webhare-private
    },
  });

  test.eq(4, seenMapped.length);
  test.eq([
    {
      tag: 'p',
      items: [
        {
          text: 'Line 1',
          link: { internalLink: 'x-custom::xmap' }
        }, {
          image: {
            data: {
              base64: "eG1hcF9pbWFnZTE=", // "xmap_image1"
            },
            mediaType: 'application/octet-stream',
            sourceFile: 'x-custom::xmap',
          }
        }, {
          inlineWidget: {
            whfsType: "webhare_testsuite:global.generic_test_type",
            data: {
              myWhfsRef: "x-custom::xmap",
            }
          }
        }
      ]
    },
    {
      widget: {
        whfsType: 'webhare_testsuite:global.generic_test_type',
        data: {
          myWhfsRef: 'x-custom::xmap',
          blubImg: {
            data: {
              base64: "eG1hcF9pbWFnZTI=", // "xmap_image2"
            },
            mediaType: 'application/octet-stream',
          },
        }
      }
    }
  ], await rtd.export({
    mapWhfsLink(data) {
      test.eq(10, data.id);
      test.eq("/webhare-private/", data.whfsPath);
      return "x-custom::xmap";
    },
  }));
}

async function testWHFSType() {
  await beginWork();
  const file = await (await test.getTestSiteJSTemp()).createFile("testwhfstypefile");
  const type = whfsType("webhare_testsuite:global.generic_test_type");

  const seenMapped: string[] = [];
  await type.set(file.id, inputInstance.data || {}, {
    unmapWhfsLink(mappedLink) {
      seenMapped.push(mappedLink);
      return 10; // return webhare-private
    },
  });
  await commitWork();

  test.eq(11, seenMapped.length);
  const expected = exportMappedInstanceData(true) ?? {};
  test.eq(expected, await type.get(file.id, {
    export: true,
    mapWhfsLink(data) {
      test.eq(10, data.id);
      test.eq("/webhare-private/", data.whfsPath);
      return "x-custom::xmap";
    },
  }));
}

test.runTests([
  testIntExtLink,
  testInstance,
  testRtd,
  test.resetWTS,
  testWHFSType,
]);
