#include <drawlib/drawlibv2/allincludes.h>

#include <blex/podvector.h>
#include <blex/utils.h>
#include "bitmapio.h"
#include <tiffio.h>
#include "graphicsrw_jpeg.h"
#include "streamingdecimator.h"
#include "streamingresizer.h"
#include "wmf_emfrecords.h"
#include "wmfrenderer.h"

namespace DrawLib {


/*******************************************************************************
        TGA STUFF....
*******************************************************************************/

void SaveBitmap32AsTGA(Blex::Stream *stream, const Bitmap32 &bitmap)
{
        uint16_t u16temp;       // temporary used for alignment safe writing!
        unsigned char header[] = {0,0,2,0,0,0,0,0,0,0,0,0};

        // check if the stream wasn't NULL.
        if (stream==NULL)
                throw(std::runtime_error("SaveBitmap32AsTGA called with NULL stream"));

        // TGA can only save pictures smaller than 65535x65535.
        // check for safety!

        if ((bitmap.GetWidth()>65535) || (bitmap.GetHeight()>65535))
                throw(std::runtime_error("SaveBitmap32AsTGA called with large bitmap"));

        // write part of the TGA header..
        stream->Write(header, 12);

        // write the bitmap width in pixels!
        Blex::putu16lsb(&u16temp, static_cast<uint16_t>(bitmap.GetWidth()));
        stream->Write(&u16temp,2);

        // write the bitmap height in pixels!
        Blex::putu16lsb(&u16temp,static_cast<uint16_t>(bitmap.GetHeight()));
        stream->Write(&u16temp,2);

        uint8_t u8temp;

        // write bits per pixel!
        u8temp = 24;
        stream->Write(&u8temp,1);

        // write bits to signify upper-left corner is origin
        u8temp = 32;
        stream->Write(&u8temp,1);

        // now, write the actual picture data!
        // TGA doesn't support an alpha layer to we have to disregard it!

        std::unique_ptr<uint8_t[]> linearray(new uint8_t[bitmap.GetWidth()*3]);

        for(uint32_t y=0; y<bitmap.GetHeight(); y++)
        {
                Scanline32 const &scanline = bitmap.GetScanline32(y);
                uint8_t *lptr = linearray.get();
                for(uint32_t x=0; x<bitmap.GetWidth(); x++)
                {
                        // copy line from bitmap to linearray, skipping alpha layer!
                        lptr[x*3  ] = scanline.Pixel(x).GetB();
                        lptr[x*3+1] = scanline.Pixel(x).GetG();
                        lptr[x*3+2] = scanline.Pixel(x).GetR();
                }
                // write the actual scanline (without the alpha layer)
                stream->Write(lptr, bitmap.GetWidth()*3);
        }
}

/*******************************************************************************
        BMP STUFF....
*******************************************************************************/
Bitmap32* CreateBitmap32FromBMP(Blex::RandomStream *stream, bool fromfile, bool paletted)
{
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32FromBMP called with NULL stream"));

        /* Eat header */
        if (fromfile)
        {
                uint8_t buf[14]; //if read from a file, the bmp contains a fileheader
                            //of 14 bytes. it contains no real useful info. so skip it
                stream->Read(&buf[0], 14);
        }

        DIB_GraphicsReader dibreader(stream, fromfile || paletted);
        // test the height and width
        Bitmap32 *newbitmap = new Bitmap32(dibreader.GetWidth(), dibreader.GetHeight());
        // get a temporary scanline.
        Scanline32 tempscanline(dibreader.GetWidth(),true);
        for(uint32_t y=0; y<dibreader.GetHeight(); y++)
        {
                // read a scanline from the file..
                dibreader.GetScanline32(tempscanline);
                // write the scanline to the new bitmap
                newbitmap->SetScanline32(y, tempscanline);
        }
        return newbitmap;
}

/*******************************************************************************
        PNG STUFF....
*******************************************************************************/

void SaveBitmap32AsPNG(Blex::Stream *stream, const Bitmap32 &bitmap,
        bool paletted, bool discard_alpha)
{
        if (stream==NULL)
                throw(std::runtime_error("SaveBitmap32AsPNG called with NULL stream"));

        PNG_GraphicsWriter pngwriter(!discard_alpha);
        if (paletted==true)
                pngwriter.WritePalettedBitmap(*stream, bitmap);
        else
                pngwriter.WriteBitmap(*stream, bitmap);
}

Bitmap32* CreateBitmap32FromPNG(Blex::Stream *stream)
{
        return CreateBitmap32FromPNGWithCallback(stream, PNG_GraphicsReader::ChunkCallback());
}

Bitmap32* CreateBitmap32FromPNGWithCallback(Blex::Stream *stream, PNG_GraphicsReader::ChunkCallback const &callback)
{
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32FromPNG called with NULL stream"));

        PNG_GraphicsReader pngreader(stream, callback);
        // test the height and width
        std::unique_ptr<Bitmap32> newbitmap (new Bitmap32(pngreader.GetWidth(), pngreader.GetHeight()));
        // get a temporary scanline.
        Scanline32 tempscanline(pngreader.GetWidth(),true);
        for(uint32_t y=0; y<pngreader.GetHeight(); y++)
        {
                // read a scanline from the file..
                pngreader.GetScanline32(tempscanline);
                // write the scanline to the new bitmap
                newbitmap->SetScanline32(y, tempscanline);
        }
        return newbitmap.release();
}

void ConvertScanline(uint8_t *data, unsigned numpixels, std::string const &format, bool isexport, bool premultiplied)
{

        if(format == "ARGB") //native: 0xAABBGGRR, export: 0xBBGGRRAA
        {
                uint32_t *dataptr = reinterpret_cast<uint32_t*>(data);
                uint32_t *dataendptr = dataptr+numpixels;

                if(isexport)
                {
                        for(;dataptr<dataendptr;++dataptr)
                            Blex::putu32lsb(dataptr, (Blex::getu32lsb(dataptr) << 8) | ((Blex::getu32lsb(dataptr) & 0xFF000000) >> 24));
                }
                else
                {
                        for(;dataptr<dataendptr;++dataptr)
                            Blex::putu32lsb(dataptr, (Blex::getu32lsb(dataptr) >> 8) | ((Blex::getu32lsb(dataptr) & 0xFF) << 24));
                }
        }
        else if(format != "RGBA") //our native format
        {
                throw std::runtime_error("Unsupported rawpixel format " + format);
        }

        if(premultiplied && !isexport)
        {
                uint8_t *dataptr = data;
                uint8_t *dataendptr = dataptr+numpixels*4;

                for(;dataptr<dataendptr;dataptr+=4)
                {
                        //Pixels should be in RGBA now.
                        uint8_t alpha = dataptr[3];
                        if(alpha==0 || alpha==255)
                                continue;

                        uint8_t alpha2 = alpha/2;
                        dataptr[0] = static_cast<uint8_t>(Blex::Bound(0, 255, (dataptr[0] * 255 + alpha2) / alpha));
                        dataptr[1] = static_cast<uint8_t>(Blex::Bound(0, 255, (dataptr[1] * 255 + alpha2) / alpha));
                        dataptr[2] = static_cast<uint8_t>(Blex::Bound(0, 255, (dataptr[2] * 255 + alpha2) / alpha));
                }
        }
}

void SaveBitmap32AsRaw(Blex::Stream &stream, const Bitmap32 &bitmap, std::string const &format)
{
        // now, write the actual picture data
        Blex::PodVector<uint8_t> scanlinedata(bitmap.GetWidth()*4);

        Blex::BufferedStream writebuffer(stream);

        for(uint32_t y=0; y<bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanline = bitmap.GetScanline32(y);

                uint8_t *dest = &(scanlinedata[0]);

                scanline.ExportScanline(dest);
                ConvertScanline(dest, scanline.GetWidth(), format, true, false);

                // write the actual scanline
                writebuffer.Write(dest, scanline.GetWidth()*4);
        }
}

Bitmap32 * CreateBitmap32FromRaw(Blex::Stream &stream, unsigned width, unsigned height, std::string const &format, bool premultiplied)
{
        //create a bitmap
        std::unique_ptr<Bitmap32> bitmap ( new Bitmap32(width,height) );

        Blex::BufferedStream readbuffer(stream);

        Blex::PodVector<uint8_t> scanlinedata(width*4);
        Scanline32 tempscanline(width,false);
        for(uint32_t y=0; y<height; y++)
        {
                if (readbuffer.Read(&scanlinedata[0], width*4) != width*4)
                    return NULL;

                ConvertScanline(&scanlinedata[0], width, format, false, premultiplied);

                tempscanline.ImportScanline(&scanlinedata[0]);
                bitmap->SetScanline32(y, tempscanline);
        }
        return bitmap.release();
}


/* INTERNAL FUNCTION: detects GFX file type of file contained in a Blex::RandomStream.. */
GfxFileType DetectGfxFileType(Blex::RandomStream *stream)
{
        GfxFileType gfxtype = GFX_UNKNOWN;

        // check if the stream wasn't NULL.
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32Magic called with NULL stream"));

        uint8_t buf[1024];
        unsigned bytesread = stream->DirectRead(0,&buf,sizeof buf);
        stream->SetOffset(0);

        //read first 4 bytes.
        if (bytesread >= 4 && (buf[0]==0x42) &&  (buf[1]==0x4D))         //if 'BM' (hex: load DIB/BMP as FILE
        {
                gfxtype = GFX_BMP;
                DEBUGPRINT("Detectgfxtype: found BMP/DIB");
                return gfxtype;
        }

        if (bytesread >= 4 && (buf[0]==0x47) &&  (buf[1]==0x49) &&  (buf[2]==0x46))       //if 'GIF' load GIF (read 3 extra byts to get the exact type)
        {
                gfxtype = GFX_GIF;
                DEBUGPRINT("Detectgfxtype: found GIF");
                return gfxtype;
        }
        if (bytesread >= 4 && (buf[0]==0xFF) &&  (buf[1]==0xD8) &&  (buf[2]==0xFF))       //if FFD8FF load JPG
        {
                gfxtype = GFX_JPG;
                DEBUGPRINT("Detectgfxtype: found JPG");
                return gfxtype;
        }
        if (bytesread >= 4 && (buf[0]==0x89) &&  (buf[1]==0x50) &&  (buf[2]==0x4E))       //if 89504e load PNG (read 5 extra bytes to verify PNG?)
        {
                gfxtype = GFX_PNG;
                DEBUGPRINT("MagicLoader found a PNG");
                return gfxtype;
        }
        if (bytesread >= 4 && (memcmp(buf,"II*\0",4)==0 || memcmp(buf,"MM\0*",4)==0))
        {
                gfxtype = GFX_TIFF;
                DEBUGPRINT("MagicLoader found a TIFF");
                return gfxtype;
        }
        if (bytesread >= 4 && Blex::getu32lsb(&buf[0]) == 1 && memcmp(buf+40," EMF",4)==0)
        {
                gfxtype = GFX_EMF;
                DEBUGPRINT("MagicLoader found a EMF");
                return gfxtype;
        }
        return gfxtype; // return GFX_UNKNOWN!
}

GraphicsReader* GetDetectedGraphicsReader(Blex::RandomStream *stream, DrawLib::ISize outsize)
{
        switch(DetectGfxFileType(stream))
        {
        case GFX_BMP:
                {
                // eat BMP header so we get a DIB format only..
                uint8_t buf[14]; //if read from a file, the bmp contains a fileheader
                            //of 14 bytes. it contains no real useful info. so skip it
                stream->Read(&buf[0], 14);
                return new DIB_GraphicsReader(stream, true);
                }

        case GFX_JPG:
                {
                        //FIXME: dirty hack -> JPG reader is instantiated twice!
                        //This is because we need the width and height to determine the decimation factor.
                        //However, the JPEG library needs the decimation factor on init.
                        //This is a chicken-and-egg problem. Therefore, we must init the JPEG_Reader
                        //twice. The overhead has been measured and was found to be negligable.
                        std::unique_ptr<JPG_GraphicsReader> myreader;
                        myreader.reset(new JPG_GraphicsReader(stream,1));

                        if (outsize.width==0 || outsize.height==0) //no decimation hint available
                            return myreader.release();

                        uint32_t w = myreader->GetWidth();
                        uint32_t h = myreader->GetHeight();

                        // 2^min_exponent = the required decimation factor. (possible values = 2,4 or 8).
                        double min_exponent = 0;

                        // Avoid the log of zero.
                        if ((w==0) || (h==0))
                        {
                                min_exponent = std::min(std::log(static_cast<double>(w/outsize.width)),
                                        std::log(static_cast<double>(h/outsize.height)))/std::log(2.0);
                        }
                        // do we need to decimate?
                        if (min_exponent>1.0)
                        {
                                // limit the exponent to 3.
                                min_exponent = std::min(min_exponent, 3.0);
                                DEBUGPRINT("  Decimating JPG by " << std::pow(2.0,std::floor(min_exponent)));
                                // destroy JPGReader..
                                myreader.reset(NULL);
                                //rewind the stream.
                                stream->SetOffset(0);
                                //reopen the JPEG reader with the correct decimation factor.
                                myreader.reset(new JPG_GraphicsReader(stream,std::pow(2.0,std::floor(min_exponent))));
                        }
                        return myreader.release();
                }

        case GFX_PNG:
                // Stream is PNG.
                return new PNG_GraphicsReader(stream, PNG_GraphicsReader::ChunkCallback());
        case GFX_GIF:
                //FIXME: The GIF reader doesn't support streaming read operations.
                //The GIF bitmap is completely read into memory and resized by a non-streaming resizer.
                {
                        std::unique_ptr<Bitmap32Owning_GraphicsReader> myreader;
                        std::unique_ptr<Bitmap32> gifbitmap;
                        gifbitmap.reset(CreateBitmap32FromGIF(stream));
                        return gifbitmap.get() ? new Bitmap32Owning_GraphicsReader(*gifbitmap) : NULL;
                }

        case GFX_TIFF:
                //FIXME: The TIFF reader doesn't support streaming read operations.
                //The TIFF bitmap is completely read into memory and resized by a non-streaming resizer.
                {
                        std::unique_ptr<Bitmap32Owning_GraphicsReader> myreader;
                        std::unique_ptr<Bitmap32> gifbitmap;
                        gifbitmap.reset(CreateBitmap32FromTIFF(stream));
                        return gifbitmap.get() ? new Bitmap32Owning_GraphicsReader(*gifbitmap) : NULL;
                }

        case GFX_EMF:
                {
                        std::unique_ptr<Bitmap32Owning_GraphicsReader> myreader;
                        std::unique_ptr<Bitmap32> gifbitmap;
                        gifbitmap.reset(CreateBitmap32FromEMF(stream));
                        return gifbitmap.get() ? new Bitmap32Owning_GraphicsReader(*gifbitmap) : NULL;
                }


        default:
                return NULL;
        }
}

Bitmap32 * CreateBitmap32Magic(Blex::RandomStream *stream)
{
        // check if the stream wasn't NULL.
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32Magic called with NULL stream"));

        switch(DetectGfxFileType(stream))
        {
        case GFX_BMP:
                return CreateBitmap32FromBMP(stream, true, true);
        case GFX_JPG:
                return CreateBitmap32FromJPG(stream, 1);
        case GFX_PNG:
                return CreateBitmap32FromPNG(stream);
        case GFX_GIF:
                return CreateBitmap32FromGIF(stream);
        case GFX_TIFF:
                return CreateBitmap32FromTIFF(stream);
        case GFX_EMF:
                return CreateBitmap32FromEMF(stream);
        default:
                return NULL;
        }
}

Bitmap32* CreateBitmap32Magic(Blex::RandomStream *stream, DrawLib::ISize outsize)
{
        // check if the stream wasn't NULL.
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32Magic called with NULL stream"));

        std::unique_ptr<GraphicsReader> myreader;
        myreader.reset(GetDetectedGraphicsReader(stream, outsize));
        if (!myreader.get())
            return NULL;

        return CreateResizedBitmapFromReader(*myreader, outsize);
}

Bitmap32* CreateResizedBitmapFromReader(GraphicsReader &reader, DrawLib::ISize outsize)
{
        // Determine separate x and y decimation factors. For JPEG it is usually not necessary.
        // But for PNG this must be done in order to be able to reduce PNGs by a factor larger than 8.
        // If X or Y decimation is not needed, the decimator in question is simply not added to the
        // input filter.

        DEBUGPRINT(" Graphic input size = ( " << reader.GetWidth() << " x " << reader.GetHeight() << " )");
        if (outsize.width<=0 || outsize.height<=0)
            return NULL; //cannot create an empty bitmap..

        uint32_t xdecim = 0;
        uint32_t ydecim = 0;

        // check if we should use decimation before resizing..
        if (unsigned(outsize.width) < reader.GetWidth())
            xdecim = reader.GetWidth()  / (outsize.width*2);
        if (unsigned(outsize.height) < reader.GetHeight())
            ydecim = reader.GetHeight() / (outsize.height*2);

        BitmapIOFilter *filtersource = &reader;

        std::unique_ptr<XDecimationFilter> xdecimator;
        std::unique_ptr<YDecimationFilter> ydecimator;

        // Do we need an X decimator?
        if (xdecim > 1)
        {
                DEBUGPRINT("  Adding DRAWLIB XDecimationFilter (decim = " << xdecim <<")");
                xdecimator.reset(new XDecimationFilter(filtersource,xdecim));
                filtersource = xdecimator.get();
        }
        // Do we need an Y decimator?
        if (ydecim > 1)
        {
                DEBUGPRINT("  Adding DRAWLIB YDecimationFilter (decim = " << ydecim <<")");
                ydecimator.reset(new YDecimationFilter(filtersource,ydecim));
                filtersource = ydecimator.get();
        }

        DEBUGPRINT(" Resizer input size = ( " << filtersource->GetWidth() << " x " <<
                filtersource->GetHeight() << " )");

        // create the streaming resizer filter..
        std::unique_ptr<ResizeFilter> resizefilter;
        if (filtersource->GetWidth() != unsigned(outsize.width) || filtersource->GetHeight() != unsigned(outsize.height))
        {
                resizefilter.reset(new ResizeFilter(filtersource, outsize.width, outsize.height));
                filtersource=resizefilter.get();
        }

        DEBUGPRINT(" Desired output size = "<<outsize);

        // create the output bitmap.
        std::unique_ptr<Bitmap32> output_bitmap ( new Bitmap32(outsize.width, outsize.height) );

        // Pull the scanlines from the streaming filter and put them into the bitmap.
        Scanline32 tempscanline(outsize.width, true);
        for(unsigned y=0; y < unsigned(outsize.height); ++y)
        {
                // pull a scanline from the resizer..
                filtersource->GetScanline32(tempscanline);
                // put it into the output bitmap..
                output_bitmap->SetScanline32(y, tempscanline);
        }
        // return the bitmap to the world! Goodbye my old friend...
        return output_bitmap.release();
}
tsize_t MyTIFFReadProc(thandle_t handle , tdata_t data, tsize_t len)
{
        Blex::RandomStream *rs = static_cast<Blex::RandomStream *>(handle);
        return rs->Read(data,len);
}
tsize_t MyTIFFWriteProc(thandle_t  , tdata_t , tsize_t )
{
        return 0;
}
toff_t MyTIFFSeekProc(thandle_t handle, toff_t seek_offset, int seek_where)
{
        Blex::RandomStream *rs = static_cast<Blex::RandomStream *>(handle);
        switch(seek_where)
        {
        case SEEK_CUR:
                rs->SetOffset(rs->GetOffset()+seek_offset);
                break;
        case SEEK_END:
                rs->SetOffset(rs->GetFileLength() + seek_offset);
                break;
        case SEEK_SET:
                rs->SetOffset(seek_offset);
                break;
        }
        return rs->GetOffset();
}
int MyTIFFCloseProc(thandle_t)
{
        return 0;
}
toff_t MyTIFFSizeProc(thandle_t handle)
{
        Blex::RandomStream *rs = static_cast<Blex::RandomStream *>(handle);
        return rs->GetFileLength();
}
//int MyTIFFMapFileProc(thandle_t, tdata_t*, toff_t*);
//int MyTIFFUnmapFileProc)(thandle_t, tdata_t, toff_t);

Bitmap32* CreateBitmap32FromTIFF(Blex::RandomStream *stream)
{
        TIFFSetErrorHandler(NULL);
        TIFFSetWarningHandler(NULL);

        TIFF *tif = TIFFClientOpen("clientfile.tif", "rm", stream, MyTIFFReadProc, MyTIFFWriteProc, MyTIFFSeekProc, MyTIFFCloseProc, MyTIFFSizeProc, NULL, NULL);
        if(!tif)
            return NULL;

        uint32 w, h;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &w);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &h);

        std::unique_ptr<Bitmap32> newbitmap;
        newbitmap.reset(new Bitmap32(w, h));
        Scanline32 tempscanline(w, true);

        size_t npixels;
        uint32* raster;
        npixels = w * h;
        raster = (uint32*) _TIFFmalloc(npixels * sizeof (uint32));
        if (raster != NULL)
        {
                if (TIFFReadRGBAImage(tif, w, h, raster, 0))
                {
                        /* Convert to scanlines */
                        for (unsigned i=0; i<h; ++i)
                        {
                                tempscanline.ImportScanline(reinterpret_cast<uint8_t*>(&raster[(h-i-1) * w]));
                                newbitmap->SetScanline32(i,tempscanline);
                        }
                }
                _TIFFfree(raster);
        }
        TIFFClose(tif);
        return newbitmap.release();
}

Bitmap32* CreateBitmap32FromEMF(Blex::RandomStream *stream)
{
        std::vector<uint8_t> imagedata;
        ReadStreamIntoVector(*stream, &imagedata);
        if(imagedata.size() < WmfLib::EMFHeader::RecSizeEMF)
        {
                DEBUGPRINT("  imagedata only " << imagedata.size() << " bytes");
                return NULL;
        }

        WmfLib::EMFHeader hdr;
        hdr.ReadEMF(&imagedata[0]);

        int32_t framewidth = hdr.frame.right - hdr.frame.left;
        int32_t frameheight = hdr.frame.bottom - hdr.frame.top;

        double xSrcPixSize = (double(hdr.device_width) / double(hdr.mms_width))/100.0;
        double ySrcPixSize = (double(hdr.device_height) / double(hdr.mms_height))/100.0;

        int finalwidth = int(framewidth * xSrcPixSize + 0.999);
        int finalheight = int(frameheight * ySrcPixSize + 0.999);

        DEBUGPRINT("  frame " << framewidth << "x" << frameheight);
        DEBUGPRINT("  pixel sizes " << xSrcPixSize << "x" << ySrcPixSize);
        DEBUGPRINT("  final dimensions " << finalwidth << "x" << finalheight);

        std::unique_ptr<Bitmap32> outbitmap(new Bitmap32(finalwidth, finalheight));
        RenderWmfEmf(*outbitmap, DrawLib::FPBoundingBox(0,0,finalwidth,finalheight), &imagedata[0], imagedata.size(), DrawLib::XForm2D());
        return outbitmap.release();
}

} //namespace end;
