import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { getSEOReport } from "@mod-publisher/tolliumapps/filemanager/reports/seoreport";
import { openFile, whfsType } from "@webhare/whfs";
import { beginWork, commitWork } from "@webhare/whdb";
import { generateReport } from "@mod-platform/js/reports/reports";

const emptyRow = { title: "", seotitle: "", pageheading: "", noindex: "", nofollow: "", noarchive: "", canonical: "", customrobots: "", comments: "", words: "" };

async function testSiteReport() {
  const site = await test.getTestSiteJS();
  const report = await getSEOReport({ folder: site.id }, {}, { langCode: "en" });

  test.eq("SEO report for webhare_testsuite.testsitejs", report.title);
  test.eq(["id", "fullpath", "link", "filefoldertype", "title", "seotitle", "pageheading", "noindex", "nofollow", "noarchive", "canonical", "customrobots", "comments", "words"],
    report.columns?.map(col => col.name));
  test.eq(["Object ID", "Site path", "URL", "File/Folder", "Navigation title", "Meta title", "Page heading", "noindex", "nofollow", "noarchive", "Canonical URL", "Additional robot tags", "Comments", "Additional keywords"],
    report.columns?.map(col => col.title));

  //First row is the root, rows are sorted by site path
  test.eq({ ...emptyRow, id: site.id, fullpath: "/", link: site.webRoot, filefoldertype: "Folder" }, report.rows[0]);
  const fullpaths = report.rows.map(row => row.fullpath as string);
  test.eq(fullpaths.toSorted((lhs, rhs) => lhs < rhs ? -1 : lhs > rhs ? 1 : 0), fullpaths);

  const staticpage = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage");
  test.eq({ ...emptyRow, id: staticpage.id, fullpath: "/TestPages/StaticPage", link: staticpage.link, filefoldertype: "File" },
    report.rows.find(row => row.id === staticpage.id));

  //Generating it as platform:seosettings report should give the same result
  test.eq(report, await generateReport("platform:seosettings", { folder: site.id }, null, { langCode: "en" }));
}

async function testSEOSettings() {
  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const seofolder = await tmpfolder.createFolder("seofolder", { title: "SEO folder" });
  const subfolder = await seofolder.createFolder("subfolder");
  const subfile = await subfolder.createFile("subfile", { type: "platform:filetypes.richdocument", publish: true });
  const target = await tmpfolder.createFile("target", { type: "platform:filetypes.richdocument", publish: true });
  const seofile = await tmpfolder.createFile("seofile", { type: "platform:filetypes.richdocument", publish: true, title: "SEO file" });
  await tmpfolder.createFile("unpublished", { type: "platform:filetypes.richdocument", publish: false });

  await whfsType("platform:web.config").set(seofolder.id, { noIndex: true, noArchive: true });
  await whfsType("platform:web.config").set(target.id, { canonical: target.id }); //pointing to yourself is not reported
  await whfsType("platform:web.config").set(seofile.id, { noFollow: true, canonical: target.id, customRobots: "noimageindex", comments: "Some comments" });
  await whfsType("platform:web.metadata").set(seofile.id, { seoTitle: "The SEO title", pageHeading: "The page heading" });
  await whfsType("platform:consilio.boostwords").set(seofile.id, { words: ["beta", "alpha", "beta"] });
  await commitWork();

  const report = await getSEOReport({ folder: tmpfolder.id }, {}, { langCode: "en" });
  const tmpUrl = (await test.getTestSiteJS()).webRoot + "tmp/";
  test.eq(null, tmpfolder.link, "tmpfolder has no index so no link, but the report should still give its URL");
  test.eq("SEO report for /tmp/", report.title);
  test.eq([
    { ...emptyRow, id: tmpfolder.id, fullpath: "/tmp/", link: tmpUrl, filefoldertype: "Folder" },
    {
      ...emptyRow, id: seofile.id, fullpath: "/tmp/seofile", link: seofile.link, filefoldertype: "File",
      title: "SEO file", seotitle: "The SEO title", pageheading: "The page heading", nofollow: "Is set",
      canonical: target.link, customrobots: "noimageindex", comments: "Some comments", words: "alpha; beta"
    },
    { ...emptyRow, id: seofolder.id, fullpath: "/tmp/seofolder/", link: tmpUrl + "seofolder/", filefoldertype: "Folder", title: "SEO folder", noindex: "Is set", noarchive: "Is set" },
    { ...emptyRow, id: subfolder.id, fullpath: "/tmp/seofolder/subfolder/", link: tmpUrl + "seofolder/subfolder/", filefoldertype: "Folder", noindex: "Is set from /tmp/seofolder/", noarchive: "Is set from /tmp/seofolder/" },
    { ...emptyRow, id: subfile.id, fullpath: "/tmp/seofolder/subfolder/subfile", link: subfile.link, filefoldertype: "File", noindex: "Is set from /tmp/seofolder/", noarchive: "Is set from /tmp/seofolder/" },
    { ...emptyRow, id: target.id, fullpath: "/tmp/target", link: target.link, filefoldertype: "File" }
  ], report.rows);
}

test.runTests([
  test.resetWTS,
  testSiteReport,
  testSEOSettings
]);
