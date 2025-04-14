import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor, WebHareBlob } from "@webhare/services";
import * as test from "@webhare/test-backend";
import { createArchive, unpackArchive, unpackArchiveFromDisk } from "@webhare/zip";
import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as nodeCrypto from "node:crypto";
import { streamIntoBlob } from "@webhare/zip/src/utils";
import { storeDiskFile } from "@webhare/system-tools";


async function getTestFile(name: string) {
  return (await ResourceDescriptor.fromResource(`mod::webhare_testsuite/tests/baselibs/hsengine/data/${name}`)).resource;
}

/*
import { setAnsiCmdMode, ansiCmd, type AnsiCommand } from "@webhare/cli";

function dumpBuffer(buf: Uint8Array | ArrayBuffer, options?: { compareTo?: Uint8Array; diffColor?: AnsiCommand | AnsiCommand[] }) {
  if (buf instanceof ArrayBuffer)
    buf = new Uint8Array(buf);
  const colorCmd = (options?.diffColor ? (Array.isArray(options.diffColor) ? options.diffColor : [options.diffColor]) : []).map(c => ansiCmd(c)).join("");

  let str = "";
  for (let i = 0; i < buf.length; ++i) {
    if ((i % 16) === 0) {
      str += `${i.toString(16).padStart(4, "0")}: `;
    } else if ((i % 8) === 0)
      str += " ";
    if (options?.compareTo && options.compareTo[i] !== buf[i] && colorCmd)
      str += colorCmd + buf[i].toString(16).padStart(2, "0") + ansiCmd("reset") + " ";
    else
      str += buf[i].toString(16).padStart(2, "0") + " ";

    const lpos = i % 16;
    if (lpos === 15 || i === buf.length - 1) {
      str += "   ".repeat(15 - lpos);
      for (let j = i - lpos; j <= i; ++j) {
        if (buf[j] >= 32 && buf[j] < 127)
          str += String.fromCharCode(buf[j]);
        else
          str += ".";
      }
      str += "\n";
    }
  }
  console.log(str);
}

function dumpCompareBuffer(a: Uint8Array | ArrayBuffer, b: Uint8Array | ArrayBuffer) {
  if (a instanceof ArrayBuffer)
    a = new Uint8Array(a);
  if (b instanceof ArrayBuffer)
    b = new Uint8Array(b);

  setAnsiCmdMode("enabled");

  console.log("Buffer A:");
  dumpBuffer(a, { compareTo: b, diffColor: ["back-red", "white"] });
  console.log("Buffer B:");
  dumpBuffer(b, { compareTo: a, diffColor: ["back-green", "white"] });

  if (a.length === b.length && a.every((v, i) => v === b[i]))
    console.log(ansiCmd("green") + "Buffers are equal" + ansiCmd("reset"));
}
*/

async function archiveTest() {
  {
    const start = new Date();

    const newArchive = await streamIntoBlob(createArchive({
      async build(controller) {
        await controller.addFile("file1", "File nummer 1", null);
      }
    }));

    const unpacked = await unpackArchive(newArchive);
    test.assert(unpacked[0].modTime.epochMilliseconds >= start.getTime() - 2000, "modtime should have been set to 'now' if unspecified");
  }

  {
    // port of the HS code below
    const archive = await streamIntoBlob(createArchive({
      async build(newArchive) {
        await newArchive.addFile("file1", "File nummer 1", Temporal.Instant.from(("2002-01-01T00:00:00Z")));
        await newArchive.addFolder("folder1", Temporal.Instant.from(("2003-04-05T00:00:00Z")));
        await newArchive.addFile("folder1/file2", "File nummer 2", Temporal.Instant.from(("2004-05-06T00:00:00Z")));
        await newArchive.addFolder("folder2", Temporal.Instant.from(("2004-05-06T00:00:00Z")));
        await newArchive.addFolder("folder2/folder3", Temporal.Instant.from(("2005-06-07T00:00:00Z")));

        await test.throws(/Invalid path name/, () => newArchive.addFile(".", new Blob(), Temporal.Instant.from(("2002-01-01T00:00:00Z"))));
        await test.throws(/Invalid path name/, () => newArchive.addFolder(".", Temporal.Instant.from(("2002-01-01T00:00:00Z"))));
      }
    }));


    const newHSArchive = await loadlib("wh::filetypes/archiving.whlib").createNewArchive("zip");
    await newHSArchive.addFile("file1", WebHareBlob.from("File nummer 1"), new Date(Date.parse("2002-01-01T00:00:00Z")));
    await newHSArchive.addFolder("folder1", new Date(Date.parse("2003-04-05T00:00:00Z")));
    await newHSArchive.addFile("folder1/file2", WebHareBlob.from("File nummer 2"), new Date(Date.parse("2004-05-06T00:00:00Z")));
    await newHSArchive.addFolder("folder2", new Date(Date.parse("2004-05-06T00:00:00Z")));
    await newHSArchive.addFolder("folder2/folder3", new Date(Date.parse("2005-06-07T00:00:00Z")));
    const hsArchive = await newHSArchive.makeBlob();

    //dumpCompareBuffer(await archive.arrayBuffer(), await hsArchive.arrayBuffer());

    // Ensure the HS archive is the same as the JS archive
    test.eq([...new Uint8Array(await hsArchive.arrayBuffer())], [...new Uint8Array(await archive.arrayBuffer())]);


    const results = (await unpackArchive(archive)).sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    test.eqPartial([
      { fullPath: "file1", type: "file", modTime: Temporal.Instant.from(("2002-01-01T00:00:00Z")) },
      { fullPath: "folder1", type: "folder", modTime: Temporal.Instant.from(("2003-04-05T00:00:00Z")) },
      { fullPath: "folder1/file2", type: "file", modTime: results[2].modTime },
      { fullPath: "folder2", type: "folder", modTime: Temporal.Instant.from(("2004-05-06T00:00:00Z")) },
      { fullPath: "folder2/folder3", type: "folder", modTime: Temporal.Instant.from(("2005-06-07T00:00:00Z")) },
    ], results);
    test.assert(results[0].type === "file");
    test.eq("File nummer 1", await results[0].text());
    test.assert(results[2].type === "file");
    test.eq("File nummer 2", await results[2].text());
  }

  {
    const zipTestFile = await getTestFile("ziptest.zip");
    const unpacked = (await unpackArchive(zipTestFile)).sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    test.eqPartial([
      { fullPath: "file1.txt", type: "file", name: "file1.txt", modTime: Temporal.Instant.from(("2009-03-12T14:58:26Z")) },
      { fullPath: "folder1", type: "folder", name: "", modTime: Temporal.Instant.from(("2009-03-12T14:58:42Z")) },
      { fullPath: "folder1/file2.txt", type: "file", name: "file2.txt", modTime: Temporal.Instant.from(("2009-03-12T14:58:40Z")) },
      { fullPath: "folder2", type: "folder", name: "", modTime: Temporal.Instant.from(("2009-03-12T14:58:30Z")) },
      { fullPath: "folder2/folder3", type: "folder", name: "", modTime: Temporal.Instant.from(("2009-03-12T14:58:46Z")) },
      { fullPath: "folder2/folder3/file3.txt", type: "file", name: "file3.txt", modTime: Temporal.Instant.from(("2009-03-12T14:58:34Z")), }
    ], unpacked);
    test.assert(unpacked[0].type === "file");
    test.assert(unpacked[2].type === "file");
    test.assert(unpacked[5].type === "file");
    test.eq("dit is file1", await unpacked[0].text());
    test.eq("dit is file2", await unpacked[2].text());
    test.eq("dit is file3", await unpacked[5].text());
  }

  // Test unpacking a zip that was created by streaming
  {
    // zip file originally created by the following HS code:
    // // create a zip by streaming (will have compressed size and crc in local file header set to 0)
    // OBJECT proc := CreateProcess("zip", [ "-r", "-", "-" ], [ take_input := TRUE, take_output := TRUE, take_errors := TRUE ]);
    // proc->Start();
    // SendBlobTo(proc->input_handle, originaldata); // small enough for buffers
    // proc->CloseInput();
    // output := ReadFromFile(proc->output_handle, 1000000); // should fit
    // proc->Close();

    const streamingZip = Buffer.from("UEsDBC0ACAAIAMddKFcAAAAA__________8BABQALQEAEAAAAAAAAAAAAAAAAAAAAAAAMzA0MjYxNTO3sAQAUEsHCMbHhKYMAAAAAAAAAAoAAAAAAAAAUEsBAh4DLQAIAAgAx10oV8bHhKYMAAAACgAAAAEAAAAAAAAAAQAAALARAAAAAC1QSwUGAAAAAAEAAQAvAAAAVwAAAAAA", "base64url");
    const unpacked = (await unpackArchive(streamingZip)).sort((a, b) => a.fullPath.localeCompare(b.fullPath));

    test.eqPartial([{ name: "-", fullPath: "-", }], unpacked);
    test.assert(unpacked[0].type === "file");
    test.eq("0123456789", await unpacked[0].text());
  }

  // Encoding tests
  {
    const ziparchiveblob = await getTestFile("encoded.zip");
    const results = await unpackArchive(ziparchiveblob);
    test.eqPartial([{ fullPath: "t\u20ACst.txt", name: "t\u20ACst.txt", modTime: Temporal.Instant.from(("2009-05-29T16:06:48Z")) },], results);
    test.assert(results[0].type === "file");
    test.eq("test", await results[0].text());
  }

  {
    const zipResult = await streamIntoBlob(createArchive({
      async build(controller) {
        await controller.addFile("file", "1234".repeat(1024 * 1024), new Date);
      }
    }));

    test.assert(zipResult.size < 100000); // should compress reasonably
  }

  {
    const encoded = await streamIntoBlob(createArchive({
      async build(controller) {
        await controller.addFile("t\u20ACst", "File nummer 1", Temporal.Instant.from(("2002-01-01T00:00:00Z")));
      }
    }));

    const newHSArchive = await loadlib("wh::filetypes/archiving.whlib").createNewArchive("zip");
    await newHSArchive.addFile("t\u20ACst", WebHareBlob.from("File nummer 1"), new Date(Date.parse("2002-01-01T00:00:00Z")));
    const hsArchive = await newHSArchive.makeBlob();

    //setAnsiCmdMode("enabled");
    //dumpCompareBuffer(await encoded.arrayBuffer(), await hsArchive.arrayBuffer());

    // Ensure the HS archive is the same as the JS archive
    test.eq([...new Uint8Array(await encoded.arrayBuffer())], [...new Uint8Array(await hsArchive.arrayBuffer())]);

    const unpacked = await unpackArchive(encoded);
    test.eqPartial([{ fullPath: "t\u20ACst", name: "t\u20ACst", modTime: Temporal.Instant.from(("2002-01-01T00:00:00Z")) }], unpacked);
  }

  // Test writing to disk
  {
    const zipFilePath = path.join(os.tmpdir(), `test.${crypto.randomUUID()}.zip`);
    try {
      // Define the path for the zip file

      // Create a new zip archive and add files
      await storeDiskFile(zipFilePath, createArchive({
        async build(zip) {
          await zip.addFile("file1.txt", "This is file 1", Temporal.Instant.from("2025-01-01T00:00:00Z"));
          await zip.addFile("file2.txt", "This is file 2", Temporal.Instant.from("2025-01-02T00:00:00Z"));
        }
      }));

      // Verify the zip file exists on disk
      const stats = await fs.stat(zipFilePath);
      test.assert(stats.isFile(), "The zip file should exist on disk");

      // Read the zip file and unpack it
      const zipFileData = await fs.readFile(zipFilePath);
      const unpacked = (await unpackArchive(zipFileData)).sort((a, b) => a.fullPath.localeCompare(b.fullPath));

      // Verify the contents of the unpacked files
      test.eqPartial([
        { fullPath: "file1.txt", name: "file1.txt", type: "file", modTime: Temporal.Instant.from("2025-01-01T00:00:00Z") },
        { fullPath: "file2.txt", name: "file2.txt", type: "file", modTime: Temporal.Instant.from("2025-01-02T00:00:00Z") },
      ], unpacked);

      test.assert(unpacked[0].type === "file");
      test.assert(unpacked[1].type === "file");

      test.eq("This is file 1", await unpacked[0].text());
      test.eq("This is file 2", await unpacked[1].text());
    } finally {
      // Clean up the temporary directory
      await fs.rm(zipFilePath);
    }
  }

  const fileSize = 5 * 1024 * 1024;// 5MB
  const chunkSize = 1024 * 1024; // 1MB
  const chunk = new Uint8Array(chunkSize).map(() => Math.random() * 256);

  const getRandomDataStreamAndHash = () => {
    const hash = nodeCrypto.createHash("sha256");
    let remaining = fileSize;
    return {
      hash,
      stream:
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (remaining > 0) {
              //console.log(`written ${(fileSize - remaining).toString().padStart(12, " ")}, remaining: `, remaining.toString().padStart(12, " "));
              const size = Math.min(chunkSize, remaining);
              const chunkData = chunk.subarray(0, size);
              hash.update(chunkData);
              controller.enqueue(chunkData);
              remaining -= size;
            } else
              controller.close();
          }
        })
    };
  };

  console.log(`** write to stream and unpack stream`);
  // Test writing a large zip file with incompressable data to a temporary file. Test that the resulting blob is has the same size and
  // hash as the original data
  {
    const randomDataStreamAndHash = getRandomDataStreamAndHash();

    // Create a new zip archive and add a large file
    const stream = createArchive({
      async build(controller) {
        await controller.addFile("largefile.bin", randomDataStreamAndHash.stream, Temporal.Instant.from("2025-01-01T00:00:00Z"));
      }
    });

    const archive = await unpackArchive(stream);
    test.eqPartial([{ fullPath: "largefile.bin", name: "largefile.bin", type: "file", modTime: Temporal.Instant.from("2025-01-01T00:00:00Z") },], archive);
    test.assert(archive[0].type === "file");
    const unpackedStream = archive[0].stream();

    const unpackedHashStream = nodeCrypto.createHash("sha256");
    const reader = unpackedStream.getReader();

    let read = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      //console.log(`hashing result`, read, value.byteLength, `bytes to hash`);
      read += value.length;
      unpackedHashStream.update(value);
    }

    test.eq(fileSize, read);
    const unpackedHash = unpackedHashStream.digest("hex");
    test.eq(randomDataStreamAndHash.hash.digest("hex"), unpackedHash, "The unpacked file should have the same hash as the original data");
  }

  console.log(`** write to disk and unpack file`);
  // Test writing a large zip file with incompressable data to a fixed disk. Test that the resulting blob is has the same size and
  // has the same hash as the original data
  {
    const testPath = path.join(os.tmpdir(), `test.zip`);
    if (existsSync(testPath))
      await fs.unlink(testPath);

    const randomDataStreamAndHash = getRandomDataStreamAndHash();

    // Create a new zip archive and add a large file
    await storeDiskFile(testPath, createArchive({
      async build(controller) {
        await controller.addFile("largefile.bin", randomDataStreamAndHash.stream, Temporal.Instant.from("2025-01-01T00:00:00Z"));
      }
    }));

    // Read the zip file and unpack it
    const archive = await unpackArchiveFromDisk(testPath);
    test.eqPartial([{ fullPath: "largefile.bin", name: "largefile.bin", type: "file", modTime: Temporal.Instant.from("2025-01-01T00:00:00Z") },], archive);
    test.assert(archive[0].type === "file");
    const unpackedStream = archive[0].stream();

    const unpackedHashStream = nodeCrypto.createHash("sha256");
    const reader = unpackedStream.getReader();

    let read = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      //console.log(`hashing result`, read, value.byteLength, `bytes to hash`);
      read += value.length;
      unpackedHashStream.update(value);
    }

    test.eq(fileSize, read);
    const unpackedHash = unpackedHashStream.digest("hex");
    test.eq(randomDataStreamAndHash.hash.digest("hex"), unpackedHash, "The unpacked file should have the same hash as the original data");
  }
}

test.runTests([archiveTest]);
