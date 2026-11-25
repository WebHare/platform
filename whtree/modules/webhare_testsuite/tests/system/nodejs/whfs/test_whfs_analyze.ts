import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { ResourceDescriptor, WebHareBlob } from "@webhare/services";
import { flushTasks, listTasks } from "@webhare/tasks";
import { beginWork, commitWork } from "@webhare/whdb";
import { importIntoWHFS } from "@webhare/whfs";
import { unpackArchive } from "@webhare/zip";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Build a minimal one-page PDF with the specified Info dictionary Title (a PDF string object, eg. `(Title)`) */
function makePDFWithTitle(titleObject: string): Buffer<ArrayBuffer> {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>", `<< /Title ${titleObject} >>`];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((obj, idx) => {
    const offset = pdf.length;
    pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
    return offset;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function testPDFTitles() {
  const start = Temporal.Now.instant();
  const pdfWithTitle = await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/publisher/testdata/pdf-with-title.pdf");
  //A PDF cut off halfway can't be parsed, but is still recognized as a PDF
  const loremIpsum = await (await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/baselibs/hsengine/data/loremipsum.pdf")).resource.arrayBuffer();
  const brokenPDF = await ResourceDescriptor.from(WebHareBlob.from(Buffer.from(loremIpsum.slice(0, loremIpsum.byteLength / 2))), { fileName: "broken.pdf", mediaType: "application/pdf" });
  //PostgreSQL rejects NUL characters in text, which PDF titles may contain
  const nulTitlePDF = await ResourceDescriptor.from(WebHareBlob.from(makePDFWithTitle("(Hello\\000World\\000)")), { fileName: "nul-title.pdf", mediaType: "application/pdf" });

  await beginWork();
  const tmpFolder = await test.getTestSiteJSTemp();
  const untitled = await tmpFolder.createFile("untitled.pdf", { data: pdfWithTitle });
  const titled = await tmpFolder.createFile("titled.pdf", { data: pdfWithTitle, title: "My own title" });
  const broken = await tmpFolder.createFile("broken.pdf", { data: brokenPDF });
  const nulTitle = await tmpFolder.createFile("nul-title.pdf", { data: nulTitlePDF });
  test.eq("", untitled.title, "The title is only set after commit");
  await commitWork();

  test.eq(1, (await listTasks("platform:analyzefiles", { createdAfter: start })).length, "Files created in the same work should be analyzed by a single task");

  await flushTasks(["platform:analyzefiles"], { createdAfter: start }); //throws if the task failed

  await untitled.refresh();
  test.eq("this pdf has a certain title", untitled.title);
  test.eq(untitled.created, untitled.modified, "Setting the title shouldn't change the modification date");

  await titled.refresh();
  test.eq("My own title", titled.title);

  await broken.refresh();
  test.eq("", broken.title);

  await nulTitle.refresh();
  test.eq("Hello World", nulTitle.title);
}

async function testArchiveImport() {
  //importIntoWHFS can't import an unpacked archive yet, so extract it to disk first
  const archive = await unpackArchive(await (await ResourceDescriptor.fromResource("mod::webhare_testsuite/tests/system/testdata/no_metadata.zip")).resource.arrayBuffer());
  const workdir = await mkdtemp(join(tmpdir(), "test_whfs_analyze-"));
  for (const entry of archive)
    if (entry.type === "file" && entry.name !== " goud|vis.png ") { //skip the file with a name that's invalid in the WHFS
      await mkdir(join(workdir, entry.directory), { recursive: true });
      await writeFile(join(workdir, entry.fullPath), await entry.bytes());
    }

  const start = Temporal.Now.instant();
  await beginWork();
  const importTree = await (await test.getTestSiteJSTemp()).createFolder("analyze-import");
  const importResult = await importIntoWHFS(workdir, importTree);
  test.eq([], importResult.messages);
  await commitWork();

  await flushTasks(["platform:analyzefiles"], { createdAfter: start });

  const importedFolder = await importTree.openFolder("no_metadata");
  test.eq("Kastjes en muren 2", (await importedFolder.openFile("Kastjes en muren 2.pdf")).title);
  test.eq("", (await importedFolder.openFile("lorum_ipsum.doc")).title);
}

test.runTests([
  test.resetWTS,
  testPDFTitles,
  testArchiveImport
]);
