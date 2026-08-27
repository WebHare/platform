/** The box/chunk readers in this file Buffer subarrays and new DataView objects intensively.
 * This isn't the fastest method, passing offset & length/limits would be faster, but
 * this implementation is easier to reason about for now
 *
 * AVIF:
 *   ISO-MBFF stores integers in big-endian order.
 *   References:
 *   - ISO/IEC 14496:12-2015
 *   - ISO/IEC 23008:12-2017
 * WEBP:
 *   Stores integers in little-endian order.
 *   References:
 *   - https://developers.google.com/speed/webp/docs/riff_container
 *   - https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification
 *
*/

/// AVIF ISO-MBFF normal box
class IsoMBFFBoxBuf {
  type: string;
  data: Buffer;
  dataView: DataView;
  constructor(type: string, data: Buffer) {
    this.type = type;
    this.data = data;
    this.dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  asFullBox(): IsoMBFFFullBox { return new IsoMBFFFullBox(this); }
  subBoxes(offset?: number) { return readIsoMBFFBoxes(this, offset); }
}

/** AVIF ISO-MBFF full box (box with 4-byte field for version and flags) */
class IsoMBFFFullBox extends IsoMBFFBoxBuf {
  version: number;
  flags: number;
  constructor(box: IsoMBFFBoxBuf) {
    super(box.type, box.data.subarray(4));
    this.version = box.data[0];
    this.flags = box.dataView.getUint32(0) & 0x00ffffff;
  }
}

/// Reads all sub-boxes from a box, optionally starting at an offset
function* readIsoMBFFBoxes(buf: IsoMBFFBoxBuf, offset = 0) {
  let itr = offset;
  while (itr < buf.data.length - 8) {
    let size = buf.dataView.getUint32(itr);
    const type = buf.data.subarray(itr + 4, itr + 8).toString("ascii");
    const headerSize = size === 1 ? 16 : 8;
    if (headerSize === 16) {
      if (itr + headerSize > buf.data.length)
        break;
      size = Number(buf.dataView.getBigUint64(itr + 8));
    }
    size ||= buf.data.length - itr;
    if (size < headerSize || itr + size > buf.data.length)
      break;
    const content = buf.data.subarray(itr + headerSize, itr + size);
    yield new IsoMBFFBoxBuf(type, content);
    itr += size;
  }
}

/// Types of boxes this parser supports
type IsoMBFFBox = {
  type: "ftyp";
  majorBrand: string;
  minorVersion: number;
  compatibleBrands: string[];
} | {
  type: "iinf";
  boxes: IsoMBFFBox[];
} | {
  type: "iprp";
  boxes: IsoMBFFBox[];
} | {
  type: "ipco";
  boxes: IsoMBFFBox[];
} | {
  type: "meta";
  boxes: IsoMBFFBox[];
} | {
  type: "pitm";
  item_Id: number;
} | {
  type: "hdlr";
  handler_type: string;
  name: string;
} | {
  type: "iloc";
  version: 0;
  items: {
    item_ID: number;
    data_reference_index: number;
    base_offset: number;
    extents: {
      extent_offset: number;
      extent_length: number;
    }[];
  }[];
} | {
  type: "iloc";
  version: 1 | 2;
  items: {
    item_ID: number;
    construction_method: number;
    data_reference_index: number;
    base_offset: number;
    extents: {
      extent_index?: number;
      extent_offset: number;
      extent_length: number;
    }[];
  }[];
} | {
  type: "av1C";
  marker: 1;
  version: 1;
  seq_profile: number;
  seq_level_idx_0: number;
  seq_tier_0: number;
  high_bitdepth: number;
  twelve_bit: number;
  monochrome: number;
  chroma_subsampling_x: number;
  chroma_subsampling_y: number;
  chroma_sample_position: number;
  initial_presentation_delay_present: number;
  initial_presentation_delay_minus_one?: number;
  configOBUs: number[];
} | {
  type: `????`;
  unknownType: string;
};

/// Read an unsigned integer of variable length from a Uint8Array
function readUVariableLength(data: Uint8Array, offset: number, size: number): number {
  let res = 0;
  for (let i = 0; i < size; i++)
    res = (res << 8) | data[offset + i];
  return res;
}

/// ISO MBFF box parser
function parseIsoMBFFBox(buf: IsoMBFFBoxBuf): IsoMBFFBox {
  switch (buf.type) {
    case "ftyp": {
      return {
        type: "ftyp",
        majorBrand: buf.data.subarray(0, 4).toString("ascii"),
        minorVersion: buf.dataView.getUint32(4),
        compatibleBrands: Array.from({ length: (buf.data.length - 8) / 4 }, (_, i) => buf.data.subarray(8 + i * 4, 12 + i * 4).toString("ascii")),
      };
    }
    case "meta": {
      const fullBuf = buf.asFullBox();
      if (fullBuf.version !== 0)
        throw new Error(`Unsupported meta box version ${fullBuf.version}`);
      return {
        type: "meta",
        boxes: fullBuf.subBoxes().map(parseIsoMBFFBox).toArray(),
      };
    }
    case "pitm": {
      const fullBuf = buf.asFullBox();
      if (fullBuf.version !== 0)
        throw new Error(`Unsupported pitm box version ${fullBuf.version}`);
      return {
        type: "pitm",
        item_Id: fullBuf.dataView.getUint16(0),
      };
    }
    case "hdlr": {
      const fullBuf = buf.asFullBox();
      if (fullBuf.version !== 0)
        throw new Error(`Unsupported hdlr box version ${fullBuf.version}`);
      return {
        type: "hdlr",
        handler_type: fullBuf.data.subarray(4, 8).toString("ascii"),
        name: fullBuf.data.subarray(20).toString("ascii").split("\0")[0],
      };
    }
    case "iinf": {
      const fullBuf = buf.asFullBox();
      if (fullBuf.version > 1)
        throw new Error(`Unsupported iinf box version ${fullBuf.version}`);
      // skipping entry_count (2 bytes in v0, 4 in v1)
      const itr = fullBuf.version === 0 ? 2 : 4;
      return {
        type: "iinf",
        boxes: buf.subBoxes(itr).map(parseIsoMBFFBox).toArray(),
      };
    }
    case "iprp":
    case "ipco": {
      // Boxes within a normal box
      return {
        type: buf.type,
        boxes: buf.subBoxes().map(parseIsoMBFFBox).toArray(),
      };
    }
    case "iloc": {
      const fullBuf = buf.asFullBox();
      if (fullBuf.version > 2)
        throw new Error(`Unsupported iloc box version ${fullBuf.version}`);
      const offset_size = fullBuf.data[0] >> 4;
      const length_size = fullBuf.data[0] & 0x0f;
      const base_offset_size = fullBuf.data[1] >> 4;
      const index_size = fullBuf.version === 1 ? fullBuf.data[1] & 0x0f : 0;
      const item_count = fullBuf.dataView.getUint16(2);

      let itr = 4;
      const items = [];
      for (let i = 0; i < item_count; i++) {
        const item_ID = fullBuf.version <= 1 ?
          fullBuf.dataView.getUint16(itr) :
          fullBuf.dataView.getUint32(itr);
        itr += fullBuf.version <= 1 ? 2 : 4;
        let construction_method: number | undefined = undefined;
        if (fullBuf.version === 1 || fullBuf.version === 2) {
          construction_method = fullBuf.dataView.getUint16(itr) & 0x000f;
          itr += 2;
        }
        const data_reference_index = fullBuf.dataView.getUint16(itr);
        const base_offset = readUVariableLength(fullBuf.data, itr + 2, base_offset_size);
        const extent_count = fullBuf.dataView.getUint16(itr + 2 + base_offset_size);
        itr += 4 + base_offset_size;
        const extents = [];
        for (let e = 0; e < extent_count; e++) {
          let extent_index: number | undefined = undefined;
          if ((fullBuf.version === 1 || fullBuf.version === 2) && index_size) {
            extent_index = readUVariableLength(fullBuf.data, itr, index_size);
            itr += index_size;
          }
          const extent_offset = readUVariableLength(fullBuf.data, itr, offset_size);
          itr += offset_size;
          const extent_length = readUVariableLength(fullBuf.data, itr, length_size);
          itr += length_size;
          extents.push({ extent_index, extent_offset, extent_length });
        }
        items.push({ item_ID, construction_method, data_reference_index, base_offset, extents });
      }
      // Need cast here because we unified both parsing paths
      return {
        type: "iloc",
        version: fullBuf.version,
        items,
      } as IsoMBFFBox;
    }
    case "av1C": {
      const initial_presentation_delay_present = (buf.data[3] >> 4) & 0x01;
      return {
        type: "av1C",
        marker: ((buf.data[0] >> 7) & 0x01) as 1,
        version: ((buf.data[0]) & 0x7f) as 1,
        seq_profile: (buf.data[1] >> 5) & 0x07,
        seq_level_idx_0: (buf.data[1]) & 0x1f,
        seq_tier_0: (buf.data[2] >> 7) & 0x01,
        high_bitdepth: (buf.data[2] >> 6) & 0x01,
        twelve_bit: (buf.data[2] >> 5) & 0x01,
        monochrome: (buf.data[2] >> 4) & 0x01,
        chroma_subsampling_x: (buf.data[2] >> 3) & 0x01,
        chroma_subsampling_y: (buf.data[2] >> 2) & 0x01,
        chroma_sample_position: (buf.data[2] >> 0) & 0x03,
        initial_presentation_delay_present: (buf.data[3] >> 4) & 0x01,
        initial_presentation_delay_minus_one: initial_presentation_delay_present ? ((buf.data[3] >> 0) & 0x0f) : undefined,
        configOBUs: Array.from(buf.data.subarray(4)),
      } satisfies IsoMBFFBox;
    }
  }
  return { type: `????`, unknownType: buf.type };
}

export function isLosslessAvifImage(fileData: Buffer): boolean {
  /* Uses the heuristic that lossless does not use chroma subsampling
     Monochrome doesn't use chroma subsampling, so that will be a false positive.

     TODO: parse the bitstream. Gemini says:
    ```
    # Implementing a Pure JS Binary Buffer Parser
    If your architecture forbids external CLI tools like avifdec, you must read the file into a Node Buffer and parse the bits manually:
    - Scan for the mdat box header ([0x6d, 0x64, 0x61, 0x74]).
    - Read the next bytes, which contain AV1 OBUs.
    - Parse the OBU Header (typically a 1 or 2-byte header containing obu_type).
    - Look for OBU_FRAME_HEADER (type 3) or OBU_FRAME (type 6).
    - Read the uncompressed header bits to locate base_q_idx (which uses a fixed 8-bit unsigned integer slot if segmentation is disabled). If those 8 bits are 00000000, it is lossless.

    Rob: this isn't the complete picture, you should probably read the frame of the primary
      item (from the pitm box) and parse its frame header to find the base_q_idx.
  */
  try {
    const mainBox = new IsoMBFFBoxBuf("----", fileData);

    const parsed = mainBox.subBoxes().map(parseIsoMBFFBox).toArray();
    const meta = parsed.find((b) => b.type === "meta");
    if (!meta)
      throw new Error(`No meta box found`);
    const iprp = meta.boxes.find((b): b is IsoMBFFBox & { type: "iprp" } => b.type === "iprp");
    if (!iprp)
      throw new Error(`No pitm box found`);
    const ipco = iprp.boxes.find((b): b is IsoMBFFBox & { type: "ipco" } => b.type === "ipco");
    if (!ipco)
      throw new Error(`No ipco box found`);
    const av1C = ipco.boxes.find((b): b is IsoMBFFBox & { type: "av1C" } => b.type === "av1C");
    if (!av1C)
      throw new Error(`No av1C box found`);
    return av1C.chroma_subsampling_x === 0 && av1C.chroma_subsampling_y === 0;
  } catch (e) {
    // parse error
    return true;
  }
}


/// WebP RIFF chunk
class RiffChunk {
  type: string;
  data: Buffer;
  dataView: DataView;
  constructor(type: string, data: Buffer) {
    this.type = type;
    this.data = data;
    this.dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  subBoxes(offset?: number) { return readRiffChunks(this, offset); }
  subType() {
    if (this.type !== "RIFF" && this.type !== "LIST")
      throw new Error(`subType() can only be called on RIFF or LIST chunks`);
    return this.data.subarray(0, 4).toString("ascii");
  }
}

/// Reads all sub-chunks from a chunk, optionally starting at an offset
function* readRiffChunks(buf: RiffChunk, offset = 0) {
  let itr = offset;
  while (itr < buf.data.length - 8) {
    const type = buf.data.subarray(itr, itr + 4).toString("ascii");
    const size = buf.dataView.getUint32(itr + 4, true);
    if (itr + 8 + size > buf.data.length) {
      console.log(`too long chunk`, { itr, size, bufLength: buf.data.length });
      break;
    }
    const content = buf.data.subarray(itr + 8, itr + 8 + size);
    yield new RiffChunk(type, content);
    itr += 8 + size + (size % 2); // pad to even size
  }
}

export function isLosslessWebPImage(fileData: Buffer): boolean {
  try {
    const fileChunk = new RiffChunk("----", fileData);
    const firstChunk = fileChunk.subBoxes().next();
    if (firstChunk.done)
      throw new Error(`No sub-chunks found`);
    const riffChunk = firstChunk.value;
    if (riffChunk.type !== "RIFF")
      throw new Error(`Not a WEBP file`);
    if (riffChunk.subType() !== "WEBP")
      throw new Error(`Not a WEBP file`);

    // A WebP file is considered lossless if it contains a VP8L chunk. The first byte of the VP8L chunk should be 0x2f
    const parsed = riffChunk.subBoxes(4).toArray();
    return parsed.some((c) => c.type === "VP8L" && c.data[0] === 0x2f);
  } catch (e) {
    return true; // parse error, assume lossless
  }
}
