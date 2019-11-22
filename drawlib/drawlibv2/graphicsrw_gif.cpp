#include <drawlib/drawlibv2/allincludes.h>

#include <blex/utils.h>
#include "bitmapio.h"
#include "graphicsrw_gif.h"
#include <gif_lib.h>

#include <setjmp.h>
#include <stdexcept>

namespace DrawLib
{

static const int InterlacedOffset[] = { 0, 4, 2, 1 }; /* The way Interlaced image should. */
static const int InterlacedJumps[] = { 8, 8, 4, 2 };  /* be read - offsets and jumps... */

int GifStreamReader(GifFileType *gif, GifByteType *buffer, int buflen)
{
        GifDecompressor *decompressor=static_cast<GifDecompressor*>(gif->UserData);
        return decompressor->instream.Read(buffer,buflen);
}
int GifStreamWriter(GifFileType *gif, const GifByteType *buffer, int buflen)
{
        GifCompressor *compressor=static_cast<GifCompressor*>(gif->UserData);
        return compressor->outstream.Write(buffer,buflen);
}

//gifdecompressor based on gif2rgb.c from giflib utils
GifDecompressor::GifDecompressor(Blex::Stream &instream)
: instream(instream)
, gif(0)
#ifdef DEBUG
, ImageNum(0)
#endif
, BackGround(0)
, hastransparentcolor(false)
{
#if GIFLIB_MAJOR >= 5
        int errorcode=0;
        gif = DGifOpen(this, &GifStreamReader, &errorcode);
#else
        gif = DGifOpen(this, &GifStreamReader);
#endif
        if(!gif)
                throw std::runtime_error("Unable to open GIF file");
}
GifDecompressor::~GifDecompressor()
{
#if GIFLIB_MAJOR >= 5
        int errorcode;
        DGifCloseFile(gif, &errorcode);
#else
        DGifCloseFile(gif);
#endif
}
Bitmap32* GifDecompressor::ReadImage()
{
        int Row, Col, Width, Height;
        int ExtCode;
        GifByteType *Extension;
        std::vector<GifPixelType> screenbuffer;
        GifRecordType RecordType;

        DEBUGPRINT("GifDecompressor::ReadImage");

        do
        {
            if (DGifGetRecordType(gif, &RecordType) == GIF_ERROR)
            {
                    DEBUGPRINT("DGifGetRecordType failed");
                    return 0;
            }

            switch (RecordType)
            {
            case IMAGE_DESC_RECORD_TYPE:
                    if (DGifGetImageDesc(gif) == GIF_ERROR)
                    {
                            DEBUGPRINT("Could not read image descriptor");
                            return 0;
                    }

                    Row = gif->Image.Top; /* Image Position relative to Screen. */
                    Col = gif->Image.Left;
                    Width = gif->Image.Width;
                    Height = gif->Image.Height;
                    screenbuffer.resize(Width);

                    // These are currently ignored!
                    (void)Row;
                    (void)Col;

                    if (gif->Image.Left + gif->Image.Width > gif->SWidth ||
                       gif->Image.Top + gif->Image.Height > gif->SHeight)
                    {
                            DEBUGPRINT("Image " << ImageNum << " is not confined to screen dimension, aborted.");
                            return 0;
                    }

                    BackGround = gif->SBackGroundColor;
                    ColorMap = (gif->Image.ColorMap ? gif->Image.ColorMap : gif->SColorMap);

                    //Not sure what to do with these 'left' and 'top' things, probably moslty relevant to animation. If they're not 0, BackGround has the color code for unpainted pixels
                    newbitmap.reset(new Bitmap32(gif->Image.Width, gif->Image.Height));

                    if (gif->Image.Interlace)
                    {
                            // Need to perform 4 passes on the images:
                            int i,j;
                            for (i = 0; i < 4; i++)
                            {
                                    for (j = InterlacedOffset[i]; j < Height; j += InterlacedJumps[i])
                                    {
                                            if (DGifGetLine(gif, &screenbuffer[0], Width) == GIF_ERROR)
                                            {
                                                    DEBUGPRINT("DGifGetLine failure, i " << i << " j " << j);
                                                    return 0;
                                            }
                                            //now write screenbuffer to the output image
                                            WriteLine(j, &screenbuffer[0]);
                                    }
                            }
                    }
                    else
                    {
                            for (int i = 0; i < Height; i++)
                            {
                                    if (DGifGetLine(gif, &screenbuffer[0], Width) == GIF_ERROR)
                                    {
                                            DEBUGPRINT("DGifGetLine failure on line #" << i);
                                            return 0;
                                    }
                                    WriteLine(i, &screenbuffer[0]);
                            }
                    }
                    return newbitmap.release();

                case EXTENSION_RECORD_TYPE:
                    /* Skip any extension blocks in file: */
                    if (DGifGetExtension(gif, &ExtCode, &Extension) == GIF_ERROR)
                            return 0;

                    while (Extension != NULL)
                    {
                            if (ExtCode == GRAPHICS_EXT_FUNC_CODE && Extension[0] == 4)
                            {
                                      transparentcolor = Extension[4];
                                      hastransparentcolor = (Extension[1] & 0x01);
                                      //note: this block also has animation info
                            }

                            if (DGifGetExtensionNext(gif, &Extension) == GIF_ERROR)
                            {
                                    DEBUGPRINT("DGifGetExtensionNext failure");
                                    return 0;
                            }
                    }
                    break;
                case TERMINATE_RECORD_TYPE:
                    break;
                default:		    /* Should be traps by DGifGetRecordType. */
                    break;
            }
        } while (RecordType != TERMINATE_RECORD_TYPE);
        DEBUGPRINT("Unexpected end of GIF");
        return 0;
}

void GifDecompressor::WriteLine(unsigned rownum, GifPixelType const *linebuffer)
{
        unsigned width = newbitmap->GetWidth();
        Scanline32 tempscanline(newbitmap->GetWidth(), true);

        for(unsigned i=0;i<width;++i, ++ linebuffer)
        {
                GifColorType *ColorMapEntry = &ColorMap->Colors[*linebuffer];
                uint8_t alpha = hastransparentcolor && *linebuffer == transparentcolor ? 0 : 255 ;
                tempscanline.Pixel(i).SetRGBA(ColorMapEntry->Red, ColorMapEntry->Green, ColorMapEntry->Blue, alpha);
        }
        newbitmap->SetScanline32(rownum, tempscanline);
}



GifCompressor::GifCompressor(Blex::Stream &outstream)
: outstream(outstream)
, gif(0)
, OutputColorMap(0)
{
#if GIFLIB_MAJOR >= 5
        int errorcode=0;
        gif = EGifOpen(this, &GifStreamWriter, &errorcode);
#else
        gif = EGifOpen(this, &GifStreamWriter);
#endif
        if(!gif)
                throw std::bad_alloc();
}
GifCompressor::~GifCompressor()
{
        if(OutputColorMap)
        {
#if GIFLIB_MAJOR >= 5
                GifFreeMapObject(OutputColorMap);
#else
                FreeMapObject(OutputColorMap);
#endif
        }
        if(gif)
        {
#if GIFLIB_MAJOR >= 5
                int errorcode;
                EGifCloseFile(gif, &errorcode);
#else
                EGifCloseFile(gif);
#endif
        }
}

void GifCompressor::WriteImage(Bitmap32 const &bitmap)
{
        unsigned int width = bitmap.GetWidth(), height = bitmap.GetHeight();

        Octree my_octree;
        unsigned alphas = FillOctreeAndCountAlpha(bitmap, my_octree, 127);

        // now, build the palette..
        Palette my_palette;
        my_octree.BuildPalette(my_palette);

        // set up a giflib compatible bitmap
        int transparentColorIndex;

        if (alphas) //transparancy?
                transparentColorIndex = 0;
        else
                transparentColorIndex = -1;// No transparency

        // Old Octree generation code. works for me ? now we get to the gif setup..
        int ColorMapSize = 1 << ColorsToBpp(my_palette.TotalColors + 1);
#if GIFLIB_MAJOR >= 5
        OutputColorMap = GifMakeMapObject(ColorMapSize, NULL); //FIXME deallocate
#else
        OutputColorMap = MakeMapObject(ColorMapSize, NULL); //FIXME deallocate
#endif

        for(unsigned int i=0; i<my_palette.TotalColors && i<255; i++)
        {
                Pixel32 p = my_palette.entries[i];

                OutputColorMap->Colors[i+1].Red  = p.GetR();
                OutputColorMap->Colors[i+1].Green = p.GetG();
                OutputColorMap->Colors[i+1].Blue = p.GetB();
        }

        // Set the transperent color white:
        OutputColorMap->Colors[0].Red = 255;
        OutputColorMap->Colors[0].Green = 255;
        OutputColorMap->Colors[0].Blue = 255;

        // All set, let's encode it.
        if (EGifPutScreenDesc(gif, width, height, ColorMapSize, 0, OutputColorMap) == GIF_ERROR)
                throw std::runtime_error("GIF header encode error");

        if(transparentColorIndex == 0)//color #0 is transparent
        {
                unsigned char extension[] = {0x01, 0x00, 0x00, 0x00}; //bit 1 in byte 0: mark as transpraent. byte 3: background color
                EGifPutExtension(gif, GRAPHICS_EXT_FUNC_CODE, 4, extension);
        }
        if(EGifPutImageDesc(gif, 0, 0, width, height, false, NULL) == GIF_ERROR)
                throw std::runtime_error("GIF header encode error");

        // lookup all the colors using the octree..
        uint16_t last_palette_index = 0;
        Pixel32 last_color;
        std::vector<GifPixelType> rowbuffer(width);

        for(unsigned int y=0; y<height; y++)
        {
                /* FIXME: Code duplication between graphics_rw.gif and PNG graphics writer */

                const Scanline32 &scanline = bitmap.GetScanline32(y);
                for(unsigned int x=0; x<width; x++)
                {
                        Pixel32 pixel = scanline.Pixel(x);
                        uint8_t palette_index;

                        // if alpha>127 then the pixel is not transparent!
                        if ((pixel.GetA())>127)
                        {
                                // do some intelligent caching to minimize lookup calls!
                                if (DrawLib::ColorsAreEqual(last_color,pixel) && (last_palette_index!=0))
                                {
                                        palette_index = last_palette_index;
                                }
                                else
                                {
                                        palette_index = 1+my_octree.LookupColor(pixel);
                                        last_palette_index  = palette_index;
                                        last_color = pixel;
                                }
                        }
                        else
                                palette_index = 0;      // pixel is transparent and therefore has palette index 0!!

                        // write to the quantized bitmap!
                        rowbuffer[x] = palette_index;
                }

                if (EGifPutLine(gif, &rowbuffer[0], width) == GIF_ERROR)
                        throw std::runtime_error("GIF row encode error");
        }

#if GIFLIB_MAJOR >= 5
        int errorcode;
        if (EGifCloseFile(gif, &errorcode) == GIF_ERROR)
                throw std::runtime_error("GIF finalize error");
#else
        if (EGifCloseFile(gif) == GIF_ERROR)
                throw std::runtime_error("GIF finalize error");
#endif
        gif=NULL;
}

int GifCompressor::ColorsToBpp(int colors)
{
    int bpp = 0;

    if ( colors <= 2 )
        bpp = 1;
    else if ( colors <= 4 )
        bpp = 2;
    else if ( colors <= 8 )
        bpp = 3;
    else if ( colors <= 16 )
        bpp = 4;
    else if ( colors <= 32 )
        bpp = 5;
    else if ( colors <= 64 )
        bpp = 6;
    else if ( colors <= 128 )
        bpp = 7;
    else if ( colors <= 256 )
        bpp = 8;
    return bpp;
}

void SaveBitmap32AsGIF(Blex::Stream *stream, const Bitmap32 &bitmap)
{
        if (stream==NULL)
                throw(std::runtime_error("SaveBitmap32AsGIF called with NULL stream"));

        GifCompressor compressor(*stream);
        compressor.WriteImage(bitmap);
}

Bitmap32 * CreateBitmap32FromGIF(Blex::Stream *stream)
{
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32FromGIF called with NULL stream"));

        GifDecompressor decompressor(*stream);

        std::unique_ptr<Bitmap32 > newbitmap;
        newbitmap.reset(decompressor.ReadImage());
        if(!newbitmap.get())
                throw std::runtime_error("Unable to read GIF data");
        return newbitmap.release();
}


} // end namespace DrawLib
