/* Based on https://github.com/shaozilee/bmp-js/blob/master/lib/decoder.js
            and https://github.com/ssnangua/sharp-bmp/blob/main/index.js

   As these projects appear to be inactive (and rightfully so, who wants X-BMP), we'll just clone our solution based on these
   We're only adding X-BMP as Drawlib did it and it's probably too much effort to go out there and convert already stored BMPs in WebHare databases
*/

class BmpDecoder {
  is_with_alpha: boolean;
  pos = 0;
  flag: string;
  bottom_up = true;
  data: Buffer;
  fileSize: number;
  reserved: number;
  offset: number;
  headerSize: number;
  width: number;
  height: number;
  planes: number;
  bitPP: number;
  compress: number;
  rawSize: number;
  hr: number;
  vr: number;
  colors: number;
  importantColors: number;
  palette: Array<
    {
      red: number;
      green: number;
      blue: number;
      quad: number;
    }> = [];
  maskRed = 0;
  maskGreen = 0;
  maskBlue = 0;
  mask0 = 0;

  constructor(private buffer: Buffer, is_with_alpha?: boolean) {
    this.pos = 0;
    this.buffer = buffer;
    this.is_with_alpha = Boolean(is_with_alpha);
    this.flag = this.buffer.toString("utf-8", 0, this.pos += 2);
    if (this.flag !== "BM")
      throw new Error("Invalid BMP File");

    this.fileSize = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.reserved = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.offset = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.headerSize = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.width = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.height = this.buffer.readInt32LE(this.pos);
    this.pos += 4;
    this.planes = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    this.bitPP = this.buffer.readUInt16LE(this.pos);
    this.pos += 2;
    this.compress = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.rawSize = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.hr = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.vr = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.colors = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    this.importantColors = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;

    if (this.bitPP === 16 && this.is_with_alpha) {
      this.bitPP = 15;
    }
    if (this.bitPP < 15) {
      const len = this.colors === 0 ? 1 << this.bitPP : this.colors;
      this.palette = new Array(len);
      for (let i = 0; i < len; i++) {
        const blue = this.buffer.readUInt8(this.pos++);
        const green = this.buffer.readUInt8(this.pos++);
        const red = this.buffer.readUInt8(this.pos++);
        const quad = this.buffer.readUInt8(this.pos++);
        this.palette[i] = {
          red: red,
          green: green,
          blue: blue,
          quad: quad
        };
      }
    }
    if (this.height < 0) {
      this.height *= -1;
      this.bottom_up = false;
    }


    const bitn = "bit" + this.bitPP;
    const len = this.width * this.height * 4;
    this.data = Buffer.alloc(len);
    (this as unknown as Record<string, () => void>)[bitn]();
  }

  bit1() {
    const xlen = Math.ceil(this.width / 8);
    const mode = xlen % 4;
    for (let y = this.height - 1; y >= 0; y--) {

      const line = this.bottom_up ? y : this.height - 1 - y;
      for (let x = 0; x < xlen; x++) {
        const b = this.buffer.readUInt8(this.pos++);
        const location = line * this.width * 4 + x * 8 * 4;
        for (let i = 0; i < 8; i++) {
          if (x * 8 + i < this.width) {
            const rgb = this.palette[((b >> (7 - i)) & 0x1)];

            this.data[location + i * 4] = 0;
            this.data[location + i * 4 + 1] = rgb.blue;
            this.data[location + i * 4 + 2] = rgb.green;
            this.data[location + i * 4 + 3] = rgb.red;

          } else {
            break;
          }
        }
      }

      if (mode !== 0) {
        this.pos += (4 - mode);
      }
    }
  }

  bit4() {
    let location = 0;
    const setPixelData = (rgbIndex: number) => {
      const rgb = this.palette[rgbIndex];
      this.data[location] = 0;
      this.data[location + 1] = rgb.blue;
      this.data[location + 2] = rgb.green;
      this.data[location + 3] = rgb.red;
      location += 4;
    };

    //RLE-4
    if (this.compress === 2) {
      this.data.fill(0xff);

      let lines = this.bottom_up ? this.height - 1 : 0;
      let low_nibble = false;//for all count of pixel

      while (location < this.data.length) {
        const a = this.buffer.readUInt8(this.pos++);
        const b = this.buffer.readUInt8(this.pos++);
        //absolute mode
        if (a === 0) {
          if (b === 0) {//line end
            if (this.bottom_up) {
              lines--;
            } else {
              lines++;
            }
            location = lines * this.width * 4;
            low_nibble = false;
            continue;
          } else if (b === 1) {//image end
            break;
          } else if (b === 2) {
            //offset x,y
            const x = this.buffer.readUInt8(this.pos++);
            const y = this.buffer.readUInt8(this.pos++);
            if (this.bottom_up) {
              lines -= y;
            } else {
              lines += y;
            }

            location += (y * this.width * 4 + x * 4);
          } else {
            let c = this.buffer.readUInt8(this.pos++);
            for (let i = 0; i < b; i++) {
              if (low_nibble) {
                setPixelData.call(this, (c & 0x0f));
              } else {
                setPixelData.call(this, (c & 0xf0) >> 4);
              }

              if ((i & 1) && (i + 1 < b)) {
                c = this.buffer.readUInt8(this.pos++);
              }

              low_nibble = !low_nibble;
            }

            if ((((b + 1) >> 1) & 1) === 1) {
              this.pos++;
            }
          }

        } else {//encoded mode
          for (let i = 0; i < a; i++) {
            if (low_nibble) {
              setPixelData.call(this, (b & 0x0f));
            } else {
              setPixelData.call(this, (b & 0xf0) >> 4);
            }
            low_nibble = !low_nibble;
          }
        }

      }




    } else {

      const xlen = Math.ceil(this.width / 2);
      const mode = xlen % 4;
      for (let y = this.height - 1; y >= 0; y--) {
        const line = this.bottom_up ? y : this.height - 1 - y;
        for (let x = 0; x < xlen; x++) {
          const b = this.buffer.readUInt8(this.pos++);
          location = line * this.width * 4 + x * 2 * 4;

          const before = b >> 4;
          const after = b & 0x0F;

          let rgb = this.palette[before];
          this.data[location] = 0;
          this.data[location + 1] = rgb.blue;
          this.data[location + 2] = rgb.green;
          this.data[location + 3] = rgb.red;


          if (x * 2 + 1 >= this.width) break;

          rgb = this.palette[after];

          this.data[location + 4] = 0;
          this.data[location + 4 + 1] = rgb.blue;
          this.data[location + 4 + 2] = rgb.green;
          this.data[location + 4 + 3] = rgb.red;

        }

        if (mode !== 0) {
          this.pos += (4 - mode);
        }
      }

    }

  }

  bit8() {
    let location = 0;

    const setPixelData = (rgbIndex: number) => {
      const rgb = this.palette[rgbIndex];
      this.data[location] = 0;
      this.data[location + 1] = rgb.blue;
      this.data[location + 2] = rgb.green;
      this.data[location + 3] = rgb.red;
      location += 4;
    };

    //RLE-8
    if (this.compress === 1) {
      this.data.fill(0xff);

      let lines = this.bottom_up ? this.height - 1 : 0;

      while (location < this.data.length) {
        const a = this.buffer.readUInt8(this.pos++);
        const b = this.buffer.readUInt8(this.pos++);
        //absolute mode
        if (a === 0) {
          if (b === 0) {//line end
            if (this.bottom_up) {
              lines--;
            } else {
              lines++;
            }
            location = lines * this.width * 4;
            continue;
          } else if (b === 1) {//image end
            break;
          } else if (b === 2) {
            //offset x,y
            const x = this.buffer.readUInt8(this.pos++);
            const y = this.buffer.readUInt8(this.pos++);
            if (this.bottom_up) {
              lines -= y;
            } else {
              lines += y;
            }

            location += (y * this.width * 4 + x * 4);
          } else {
            for (let i = 0; i < b; i++) {
              const c = this.buffer.readUInt8(this.pos++);
              setPixelData.call(this, c);
            }
            if ((b & 1) === 1) {
              this.pos++;
            }

          }

        } else {//encoded mode
          for (let i = 0; i < a; i++) {
            setPixelData.call(this, b);
          }
        }

      }




    } else {
      const mode = this.width % 4;
      for (let y = this.height - 1; y >= 0; y--) {
        const line = this.bottom_up ? y : this.height - 1 - y;
        for (let x = 0; x < this.width; x++) {
          const b = this.buffer.readUInt8(this.pos++);
          location = line * this.width * 4 + x * 4;
          if (b < this.palette.length) {
            const rgb = this.palette[b];

            this.data[location] = 0;
            this.data[location + 1] = rgb.blue;
            this.data[location + 2] = rgb.green;
            this.data[location + 3] = rgb.red;

          } else {
            this.data[location] = 0;
            this.data[location + 1] = 0xFF;
            this.data[location + 2] = 0xFF;
            this.data[location + 3] = 0xFF;
          }
        }
        if (mode !== 0) {
          this.pos += (4 - mode);
        }
      }
    }
  }

  bit15() {
    const dif_w = this.width % 3;
    const _11111 = 0b11111, _1_5 = _11111;
    for (let y = this.height - 1; y >= 0; y--) {
      const line = this.bottom_up ? y : this.height - 1 - y;
      for (let x = 0; x < this.width; x++) {

        const B = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;
        const blue = (B & _1_5) / _1_5 * 255 | 0;
        const green = (B >> 5 & _1_5) / _1_5 * 255 | 0;
        const red = (B >> 10 & _1_5) / _1_5 * 255 | 0;
        const alpha = (B >> 15) ? 0xFF : 0x00;

        const location = line * this.width * 4 + x * 4;

        this.data[location] = alpha;
        this.data[location + 1] = blue;
        this.data[location + 2] = green;
        this.data[location + 3] = red;
      }
      //skip extra bytes
      this.pos += dif_w;
    }
  }

  bit16() {
    const dif_w = (this.width % 2) * 2;
    //default xrgb555
    this.maskRed = 0x7C00;
    this.maskGreen = 0x3E0;
    this.maskBlue = 0x1F;
    this.mask0 = 0;

    if (this.compress === 3) {
      this.maskRed = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      this.maskGreen = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      this.maskBlue = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      this.mask0 = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
    }


    const ns = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
      if ((this.maskRed >> i) & 0x01) ns[0]++;
      if ((this.maskGreen >> i) & 0x01) ns[1]++;
      if ((this.maskBlue >> i) & 0x01) ns[2]++;
    }
    ns[1] += ns[0]; ns[2] += ns[1]; ns[0] = 8 - ns[0]; ns[1] -= 8; ns[2] -= 8;

    for (let y = this.height - 1; y >= 0; y--) {
      const line = this.bottom_up ? y : this.height - 1 - y;
      for (let x = 0; x < this.width; x++) {

        const B = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;

        const blue = (B & this.maskBlue) << ns[0];
        const green = (B & this.maskGreen) >> ns[1];
        const red = (B & this.maskRed) >> ns[2];

        const location = line * this.width * 4 + x * 4;

        this.data[location] = 0;
        this.data[location + 1] = blue;
        this.data[location + 2] = green;
        this.data[location + 3] = red;
      }
      //skip extra bytes
      this.pos += dif_w;
    }
  }

  bit24() {
    for (let y = this.height - 1; y >= 0; y--) {
      const line = this.bottom_up ? y : this.height - 1 - y;
      for (let x = 0; x < this.width; x++) {
        //Little Endian rgb
        const blue = this.buffer.readUInt8(this.pos++);
        const green = this.buffer.readUInt8(this.pos++);
        const red = this.buffer.readUInt8(this.pos++);
        const location = line * this.width * 4 + x * 4;
        this.data[location] = 0;
        this.data[location + 1] = blue;
        this.data[location + 2] = green;
        this.data[location + 3] = red;
      }
      //skip extra bytes
      this.pos += (this.width % 4);
    }

  }

  /**
   * add 32bit decode func
   */
  bit32() {
    //BI_BITFIELDS
    if (this.compress === 3) {
      this.maskRed = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      this.maskGreen = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      this.maskBlue = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      this.mask0 = this.buffer.readUInt32LE(this.pos);
      this.pos += 4;
      for (let y = this.height - 1; y >= 0; y--) {
        const line = this.bottom_up ? y : this.height - 1 - y;
        for (let x = 0; x < this.width; x++) {
          //Little Endian rgba
          const alpha = this.buffer.readUInt8(this.pos++);
          const blue = this.buffer.readUInt8(this.pos++);
          const green = this.buffer.readUInt8(this.pos++);
          const red = this.buffer.readUInt8(this.pos++);
          const location = line * this.width * 4 + x * 4;
          this.data[location] = alpha;
          this.data[location + 1] = blue;
          this.data[location + 2] = green;
          this.data[location + 3] = red;
        }
      }

    } else {
      for (let y = this.height - 1; y >= 0; y--) {
        const line = this.bottom_up ? y : this.height - 1 - y;
        for (let x = 0; x < this.width; x++) {
          //Little Endian argb
          const blue = this.buffer.readUInt8(this.pos++);
          const green = this.buffer.readUInt8(this.pos++);
          const red = this.buffer.readUInt8(this.pos++);
          const alpha = this.buffer.readUInt8(this.pos++);
          const location = line * this.width * 4 + x * 4;
          this.data[location] = alpha;
          this.data[location + 1] = blue;
          this.data[location + 2] = green;
          this.data[location + 3] = red;
        }
      }

    }




  }

  getData() {
    return this.data;
  }
}


function scan(bitmap: BmpDecoder, f: (index: number) => void) {
  const w = Math.round(bitmap.width);
  const h = Math.round(bitmap.height);
  for (let _y = 0; _y < h; _y++) {
    for (let _x = 0; _x < w; _x++) {
      const index = (bitmap.width * _y + _x) << 2;
      f.call(bitmap, index);
    }
  }
  return bitmap;
}



function fromAGBR(bitmap: BmpDecoder) {
  return scan(bitmap, (index: number) => {
    const alpha = bitmap.data[index + 0];
    const blue = bitmap.data[index + 1];
    const green = bitmap.data[index + 2];
    const red = bitmap.data[index + 3];
    bitmap.data[index + 0] = red;
    bitmap.data[index + 1] = green;
    bitmap.data[index + 2] = blue;
    bitmap.data[index + 3] = bitmap.is_with_alpha ? alpha : 0xff;
  });
}


export function decodeBMP(bmpData: Buffer) {
  return fromAGBR(new BmpDecoder(bmpData));
}
