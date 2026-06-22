import { resizeImage } from "@mod-platform/js/cache/imgcache";
import { runCli, enumOption, CLIRuntimeError, intOption } from "@webhare/cli";
import { ResourceDescriptor, PackMethods, type outputFormats, type ResizeMethodName } from "@webhare/services/src/descriptor";
import { storeDiskFile } from "@webhare/system-tools/src/fs";

function getImageTypeForPath(path: string): typeof outputFormats[number] {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    default:
      return "keep";
  }
}

runCli({
  subCommands: {
    "resize": {
      flags: {
        "ignore-errors": { description: "Ignore errors in source image" }
      },
      options: {
        method: { description: "The method to use for resizing the image", default: "none", type: enumOption(Object.keys(PackMethods)) },
        width: { description: "Target width in pixels", type: intOption() },
        height: { description: "Target height in pixels", type: intOption() },
      },
      arguments: [
        { name: "<input>", description: "The input file to convert" },
        { name: "<output>", description: "The output file to write" }
      ],
      description: "Render an image file using the imagecache's algorithm",
      async main({ opts, args }) {
        const desc = await ResourceDescriptor.fromDisk(args.input, { getImageMetadata: true });
        const outputFormat = getImageTypeForPath(args.output);
        const result = await resizeImage(desc, args.input, {
          method: opts.method as ResizeMethodName,
          format: outputFormat,
          width: opts.width,
          height: opts.height
        }, { ignoreErrors: opts.ignoreErrors });
        if (!result)
          throw new CLIRuntimeError(`Nothing to do given these resize instructions`);

        await storeDiskFile(args.output, await result.toBuffer(), { overwrite: true });
      }
    }
  }
});
