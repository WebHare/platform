#include <drawlib/drawlibv2/allincludes.h>


#include <png.h>

using namespace std; //work around STLport bug?
#include <setjmp.h>
#include <stdexcept>

#include "graphicsreadwrite.h"

namespace DrawLib
{

GraphicsReader::GraphicsReader() : BitmapIOFilter(NULL) {}
GraphicsReader::~GraphicsReader() {}
GraphicsWriter::~GraphicsWriter() {}

//ADDME: One of these colormaps is probably the standard Win 16-color map, also used in Escher and Word code, combine all of those
static DrawLib::Pixel32 EGAColors[16] = {
/* rgbBlue, rgbGreen, rgbRed, rgbReserverd */
    DrawLib::Pixel32( 0x00, 0x00, 0x00),
    DrawLib::Pixel32( 0x00, 0x00, 0x80),
    DrawLib::Pixel32( 0x00, 0x80, 0x00),
    DrawLib::Pixel32( 0x00, 0x80, 0x80),
    DrawLib::Pixel32( 0x80, 0x00, 0x00),
    DrawLib::Pixel32( 0x80, 0x00, 0x80),
    DrawLib::Pixel32( 0x80, 0x80, 0x00),
    DrawLib::Pixel32( 0x80, 0x80, 0x80),
    DrawLib::Pixel32( 0xc0, 0xc0, 0xc0),
    DrawLib::Pixel32( 0x00, 0x00, 0xff),
    DrawLib::Pixel32( 0x00, 0xff, 0x00),
    DrawLib::Pixel32( 0x00, 0xff, 0xff),
    DrawLib::Pixel32( 0xff, 0x00, 0x00),
    DrawLib::Pixel32( 0xff, 0x00, 0xff),
    DrawLib::Pixel32( 0xff, 0xff, 0x00),
    DrawLib::Pixel32( 0xff, 0xff, 0xff)
};


static DrawLib::Pixel32 DefLogPalette[20] = { /* Copy of Default Logical Palette */
/* rgbBlue, rgbGreen, rgbRed, rgbReserverd */
    DrawLib::Pixel32( 0x00, 0x00, 0x00),
    DrawLib::Pixel32( 0x00, 0x00, 0x80),
    DrawLib::Pixel32( 0x00, 0x80, 0x00),
    DrawLib::Pixel32( 0x00, 0x80, 0x80),
    DrawLib::Pixel32( 0x80, 0x00, 0x00),
    DrawLib::Pixel32( 0x80, 0x00, 0x80),
    DrawLib::Pixel32( 0x80, 0x80, 0x00),
    DrawLib::Pixel32( 0xc0, 0xc0, 0xc0),
    DrawLib::Pixel32( 0xc0, 0xdc, 0xc0),
    DrawLib::Pixel32( 0xf0, 0xca, 0xa6),
    DrawLib::Pixel32( 0xf0, 0xfb, 0xff),
    DrawLib::Pixel32( 0xa4, 0xa0, 0xa0),
    DrawLib::Pixel32( 0x80, 0x80, 0x80),
    DrawLib::Pixel32( 0x00, 0x00, 0xf0),
    DrawLib::Pixel32( 0x00, 0xff, 0x00),
    DrawLib::Pixel32( 0x00, 0xff, 0xff),
    DrawLib::Pixel32( 0xff, 0x00, 0x00),
    DrawLib::Pixel32( 0xff, 0x00, 0xff),
    DrawLib::Pixel32( 0xff, 0xff, 0x00),
    DrawLib::Pixel32( 0xff, 0xff, 0xff)
};

/******************************************************************************
        DIB STUFF HERE....
******************************************************************************/

unsigned GetRequiredShift(uint32_t inval)
{
        if(inval==0)
            return 0;

        unsigned shiftbits = 0;
        while(!(inval&1))
        {
                inval>>=1;
                ++shiftbits;
        }
        return shiftbits;
}

DIB_GraphicsReader::DIB_GraphicsReader(Blex::RandomStream *_stream, bool has_palette)
: stream(_stream)
, use_mask_shift(false)
{
        ProcessHeader(has_palette);
}

DIB_GraphicsReader::~DIB_GraphicsReader()
{
}

void DIB_GraphicsReader::ProcessHeader(bool has_palette)
{
        //AU: je moet even kiezen.. of alleen DIB memory reader.
        //of BMP file reader (dus met file header ervoor!)

        std::vector<uint8_t> header;
        header.reserve(44);
        header.resize(4);

        stream->Read(&header[0], 4);
        headerlength = Blex::getu32lsb(&header[0]);
        if(headerlength<40)
             throw std::runtime_error("Not a proper DIB header");

        header.resize(headerlength);
        stream->Read(&header[4], headerlength-4);

        width  = Blex::gets32lsb(&header[4]);
        height = Blex::gets32lsb(&header[8]);

        // normal DIBs are bottom-up except when the height is negative!
        // rare jongens, die MS-proggers.
        bottomup = true;
        if (height<0)
        {
                height=-height;
                bottomup = false;
        }
        bitcount        = Blex::getu16lsb(&header[14]);
        compression     = Blex::getu32lsb(&header[16]);
        colorsused      = Blex::getu32lsb(&header[32]);

        // in DEBUG mode.. tell the console what DIB we have here..
        #ifdef DEBUG
        DEBUGPRINT("----------------------------");
        DEBUGPRINT("  header size = " << headerlength);
        DEBUGPRINT("  height      = " << height);
        DEBUGPRINT("  width       = " << width);
        DEBUGPRINT("  bitcount    = " << bitcount);
        DEBUGPRINT("  compression = " << compression);
        DEBUGPRINT("  bitplanes   = " << Blex::getu16lsb(&header[12]));
        DEBUGPRINT("  colors used = " << colorsused);
        DEBUGPRINT("  imp colors  = " << Blex::getu32lsb(&header[36]));
        DEBUGPRINT("----------------------------");
        #endif
        lines = height;

        if ((width<1) || (height<1))
            throw std::runtime_error("Illegal Width or Height");

        if (compression == 3)
        {
                if(bitcount!=16&&bitcount!=32)
                    throw std::runtime_error("Unsupported DIBs compression format");

                //If header did not contain the BI_BITFIELDS bytes, add them
                if (header.size() < 40+3*4)
                {
                        header.resize(40+3*4);
                        stream->Read(&header[40],3*4);
                }
                redmask = Blex::getu32lsb(&header[40]);
                greenmask = Blex::getu32lsb(&header[44]);
                bluemask = Blex::getu32lsb(&header[48]);
                alphamask = header.size() >= 56 ? Blex::getu32lsb(&header[52]) : 0;
                use_mask_shift = true;

                DEBUGPRINT("BI_BITFIELDS compression");
        }
        else if (compression >= 1)
        {
                if( (compression!=1 || bitcount!=8) && compression!=3)
                    throw std::runtime_error("Unsupported DIBs compression format");
        }

        if(use_mask_shift)
        {
                redshift = GetRequiredShift(redmask);
                greenshift = GetRequiredShift(greenmask);
                blueshift = GetRequiredShift(bluemask);
                alphashift = GetRequiredShift(alphamask);
        }

        /* New attempt to figure out the BMP/DIB specs: it seems that on-file BMPs always have a palette,
           and others never.. Maybe that's the solution to our never-figured-out BMP problems ? */
        if (has_palette)
        {
                if (colorsused == 0)
                {
                        if (bitcount==1) //1-bit images always have a 2 color palette..
                            colorsused=2;
                        if (bitcount==2)
                            colorsused=4;
                        if (bitcount==4) //4-bit images always have a 16 color palette.. (at least, in X:\testfiles\dib\4bit_clrsused_0_with_palette.doc)
                            colorsused=16;
                        if (bitcount==8)
                            colorsused=256;
                }
        }

        if (colorsused != 0) //We must decode a palette
        {
                if (bitcount != 1 && bitcount != 2 && bitcount != 4 && bitcount != 8)
                    throw std::runtime_error("Unknown paletted DIB format");

                std::vector<uint8_t> palette_buf( 4 * colorsused );
                stream->Read(&palette_buf[0], palette_buf.size()); //FIXME: Check I/O errors
                for(unsigned i=0; i<colorsused; i++)
                    palette.push_back(Pixel32 (palette_buf[2 + i*4],palette_buf[1+ i*4],palette_buf[0+ i*4],255));
        }
        else
        {
                if (bitcount == 1)
                {
                        palette.push_back(DrawLib::Pixel32(0,0,0,255));
                        palette.push_back(DrawLib::Pixel32(255,255,255,255));
                }
                else if (bitcount == 4) //note: unreachable!
                {
                        palette.assign(&EGAColors[0], &EGAColors[16]);
                }
                else if (bitcount == 8)
                {
                        palette.reserve(256);
                        palette.insert(palette.end(), &DefLogPalette[0], &DefLogPalette[10]);
                        for(unsigned r = 0; r <= 5; r++)
                          for(unsigned g = 0; g <= 5; g++)
                            for(unsigned b = 0; b <= 5; b++)
                        {
                                palette.push_back(DrawLib::Pixel32((r * 0xff) / 5,(g * 0xff) / 5,(b * 0xff) / 5,255));
                        }
                        palette.insert(palette.end(), &DefLogPalette[10], &DefLogPalette[20]);
                }

                if (bitcount != 1 && bitcount != 4 && bitcount != 8 && bitcount != 15 && bitcount != 16 && bitcount != 24 && bitcount != 32)
                    throw std::runtime_error("Unknown unpaletted DIB format");
        }

        bytes_per_scanline = (width * bitcount + 7 )/8;

        //Scanlines are aligned to DWORD (4-byte) boundaries when the data is larger than 1 bit / pixel.
        //The data alignment is not clearly specified by Microsoft and information is not available.
        //Expect alignment bugs in the future.
        //we'll read and discard filler bytes on all but the last line
        if ((lines>1) && (bitcount>0))
            bytes_per_scanline = ((bytes_per_scanline+3)/4)*4;

        // store start of scanline data within the DIB file..
        start_scanlines = stream->GetOffset();

        if(compression == 1)
            DecompressData();
}

void DIB_GraphicsReader::DecompressData()
{
        DEBUGPRINT("DIB is compressed - uncompress immediately");

        stream->SetOffset(start_scanlines);
        Blex::BufferedStream compressed_data(*stream);

        unsigned curpixel=0;
        pixelbuffer.resize(height*width, 0);

        while(true)
        {
                uint8_t chunk[2];
                if (compressed_data.Read(chunk,2) != 2)
                     throw std::runtime_error("End of file while reading compressed DIB data");

                if (chunk[0]>0) //this is a normal RLE chunk
                {
                        if(chunk[0]+curpixel > pixelbuffer.size())
                            throw std::runtime_error("Compressed DIB data exceeds bitmap size");
                        std::fill_n(&pixelbuffer[curpixel], chunk[0], chunk[1]);
                        curpixel += chunk[0];
                }
                else if(chunk[1]==0) //EOL
                {
                        if (curpixel%width) //move to next line if not there yet
                            curpixel += width - curpixel%width;
                        if(curpixel>pixelbuffer.size())
                            throw std::runtime_error("Compressed DIB data exceeds bitmap size");
                }
                else if(chunk[1]==1) //EOB
                {
                        return; //this was it!
                }
                else if(chunk[1]==2) //Delta
                {
                        if (compressed_data.Read(chunk,2) != 2)
                             throw std::runtime_error("End of file while reading compressed DIB data");
                        curpixel += chunk[0] + chunk[1]*width;
                        if(curpixel>pixelbuffer.size())
                            throw std::runtime_error("Compressed DIB data exceeds bitmap size");
                }
                else //chunk[1] bytes of raw data
                {
                        if(chunk[1]+curpixel > pixelbuffer.size())
                            throw std::runtime_error("Compressed DIB data exceeds bitmap size");

                        compressed_data.Read(&pixelbuffer[curpixel], chunk[1]);
                        if(chunk[1]&1) //odd
                            compressed_data.MoveForward(1); //skip a byte

                        curpixel += chunk[1];
                }
        }
}


uint32_t inline DIB_GraphicsReader::GetWidth()  const {return width;}
uint32_t inline DIB_GraphicsReader::GetHeight() const {return height;}
bool DIB_GraphicsReader::IsUpsideDown() const {return bottomup;}
bool inline DIB_GraphicsReader::LinesLeft() const
{
        return lines>0;
}

void DIB_GraphicsReader::GetScanline32(Scanline32& newscanline)
{
        if (!LinesLeft())
             throw std::runtime_error("No lines left to read");

        // get some temporary space..
        pixelbuffer.resize(bytes_per_scanline);

        uint8_t const *ptr = &pixelbuffer[0];
        //Which line on disk to read?
        unsigned diskline = bottomup ? lines - 1 : height - lines;

        if(compression==1) //RLE
        {
                ptr = &pixelbuffer[diskline*width]; //8bit data is already in pixelbuffer
        }
        else
        {
                uint32_t result = stream->DirectRead(start_scanlines + diskline * bytes_per_scanline, &pixelbuffer[0], bytes_per_scanline);
                if (result != bytes_per_scanline)
                {
                        DEBUGPRINT("Bitmap corrupted");
                        std::fill_n(&pixelbuffer[0], bytes_per_scanline, 0); //zero-pad
                }
                ptr = &pixelbuffer[0];
        }


        if (palette.empty()) //Decode raw data...
        {
                switch (bitcount)
                {
                case 32: //RGBA? Dib - ALlow Alpha ONLY if bitmap header supports this BITMAPV4HEADER http://www.herdsoft.com/ti/davincie/rgba4oo1.htm
                        if(use_mask_shift)
                        {
                                //ADDME: Perhaps we need to do the <<3 shift here as well?
                                for (int32_t i=0; i<width; i++)
                                {
                                        uint32_t pixel = Blex::getu32lsb(ptr + i*4);
                                        //Shifting twice, a little more obvious, and to use the implicit masking
                                        newscanline.Pixel(i).SetRGBA( (pixel&redmask) >> redshift,
                                                                      (pixel&greenmask) >> greenshift,
                                                                      (pixel&bluemask) >> blueshift,
                                                                      255);
                                }
                        }
                        else
                        {
                                for (int32_t i=0; i<width; i++)
                                    newscanline.Pixel(i).SetRGBA(ptr[2+(i*4)], ptr[1+(i*4)], ptr[0+(i*4)], 255);
                        }
                        break;
                case 24: //RGB Dib
                        for (int32_t i=0; i<width; i++)
                            newscanline.Pixel(i).SetRGBA(ptr[2+(i*3)], ptr[1+(i*3)], ptr[0+(i*3)], 255);
                        break;
                case 8: //8-bit Grayscale DIB
                        for (int32_t i=0; i<width; i++)
                            newscanline.Pixel(i).SetRGBA(ptr[i], ptr[i], ptr[i],255);
                        break;
                case 1: //Black&White DIB
                        for (int32_t i=0; i<width; i++)
                        {
                                uint8_t bit  = 7- (i%8 );  //0 = 7,
                                uint8_t byte = i >> 3;
                                if ((ptr[byte] & (1 << bit)) == 0)
                                        newscanline.Pixel(i).SetRGBA(0,0,0,255);
                                else
                                        newscanline.Pixel(i).SetRGBA(255,255,255,255);
                        }
                        break;
                case 15: //A 5-5-5 format
                case 16: //Also 5-5-5 format in RGB compression mode, as specified by Windows SDK BITMAPINFO helppage
                        if(use_mask_shift)
                        {
                                //ADDME: Perhaps we need to do the <<3 shift here as well?
                                for (int32_t i=0; i<width; i++)
                                {
                                        uint16_t pixel = Blex::getu16lsb(ptr + i*2);
                                        //Shifting twice, a little more obvious, and to use the implicit masking
                                        newscanline.Pixel(i).SetRGBA( (pixel&redmask) >> redshift,
                                                                      (pixel&greenmask) >> greenshift,
                                                                      (pixel&bluemask) >> blueshift,
                                                                      255);
                                }
                        }
                        else
                        {
                                for (int32_t i=0; i<width; i++)
                                {
                                        uint16_t pixel = Blex::getu16lsb(ptr + i*2);
                                        //Shifting twice, a little more obvious, and to use the implicit masking
                                        newscanline.Pixel(i).SetRGBA(((pixel & 0x7C00) >> 10) << 3,
                                                                     ((pixel & 0x03E0) >> 5) << 3,
                                                                      (pixel & 0x001F) << 3,
                                                                      255);
                                }
                        }
                        break;
                } //end case
        }
        else
        {
                switch (bitcount)
                {
                case 8:
                        for (int32_t i=0; i<width; i++)
                            newscanline.Pixel(i) = palette[ptr[i]];

                        break;
                case 4:
                        for (int32_t i=0; i<width; i++)
                        {
                                bool upperbits = ( i % 2 ==0);
                                unsigned byte = i >> 1;
                                if (upperbits)
                                    newscanline.Pixel(i) = palette[ (ptr[byte] & 0xF0) >>4 ];
                                else
                                    newscanline.Pixel(i) = palette[ (ptr[byte] & 0x0F)     ];
                        }
                        break;
                case 1:
                        for (int32_t i=0; i<width; i++)
                        {
                                uint8_t bit  = 7- (i%8 );  //0 = 7,
                                unsigned byte = i >> 3;
                                if ((ptr[byte] & (1 << bit)) == 0)
                                    newscanline.Pixel(i) = palette[0];
                                else
                                    newscanline.Pixel(i) = palette[1];
                        }
                        break;
                }//end case;
        }
        lines--;
}

/******************************************************************************
        PNG STUFF HERE.....
******************************************************************************/
namespace {
class PNG_ErrorData
{
        public:
        PNG_ErrorData() {};
        jmp_buf error_return;

        void SetupHandlers(png_structp png_structure);
        void ProcessError();

        private:
        static void ErrorHandler(png_structp png_ptr, png_const_charp error_msg);
        static void WarningHandler(png_structp png_ptr, png_const_charp error_msg);
        PNG_ErrorData(PNG_ErrorData const &) = delete;
        PNG_ErrorData& operator=(PNG_ErrorData const &) = delete;

        std::string error_text;
};

void PNG_ErrorData::SetupHandlers(png_structp png_ptr)
{
        png_set_error_fn(png_ptr, this, &ErrorHandler, &WarningHandler);
}

void PNG_ErrorData::ProcessError()
{
        //ADDME: Unsafe: may not throw up through non-C++ code
        throw std::runtime_error(error_text);
}

void PNG_ErrorData::ErrorHandler(png_structp png_ptr, png_const_charp error_msg)
{
        PNG_ErrorData *png_this = static_cast<PNG_ErrorData *>(png_get_error_ptr(png_ptr));

        png_this->error_text = std::string("libpng internal error: ") + error_msg;
        longjmp(png_this->error_return,1);
}

void PNG_ErrorData::WarningHandler(png_structp /*png_ptr*/, png_const_charp DEBUGONLYARG(error_msg))
{
        DEBUGPRINT("libpng warning: " << error_msg);
}

typedef struct
{
       Blex::Stream *stream;
} my_png_status;

typedef my_png_status *my_pngstatus_ptr ;

} //end anonymous namespace

struct PNG_GraphicsReader::Data
{
        png_structp png_ptr;
        png_infop info_ptr;
        my_png_status status;

        int32_t     lines;
        uint32_t     width;
        uint32_t     height;

        bool interlaced;
        std::unique_ptr<uint8_t[]> interlaced_img_buffer;

        PNG_ErrorData errorhandler;
        std::vector<uint8_t> linebuffer;
};

namespace {
extern "C" {

void user_read_data(png_structp png_ptr, png_bytep data, png_size_t length)
{
        my_pngstatus_ptr src = (my_pngstatus_ptr)png_get_io_ptr(png_ptr);
        size_t nbytes;

        nbytes = src->stream->Read(data, length);
        if (nbytes<=0)
        {
                //ADDME
        }
}

void user_write_data(png_structp png_ptr, png_bytep data, png_size_t length)
{
        my_pngstatus_ptr src = (my_pngstatus_ptr)png_get_io_ptr(png_ptr);
        src->stream->Write((void*)data, (size_t)length);
}

int user_read_chunk_callback(png_structp png_ptr, png_unknown_chunkp chunk)
{
        PNG_GraphicsReader *reader = static_cast<PNG_GraphicsReader*>(png_get_user_chunk_ptr(png_ptr));
        unsigned int size = chunk->size;
        const char *chunkname=reinterpret_cast<const char*>(chunk->name);
        if(reader->mycallback)
            reader->mycallback(chunkname,chunk->data,size);
        return 1; /* success */
}
void user_flush_data(png_structp /*png_ptr*/)
{
}
} //end extern "C"
} //end anonymous namespace

PNG_GraphicsReader::PNG_GraphicsReader(Blex::Stream* stream, ChunkCallback const &callback)
: mycallback(callback), data(new Data)  //leaks if constructor throws
{
        png_uint_32 _width,_height;
        int bit_depth, color_type, interlace_type;
        bool no_alpha = true;

        data->interlaced = false;

        data->png_ptr = png_create_read_struct(PNG_LIBPNG_VER_STRING,0,0,0);
        if (!data->png_ptr)
        {
                delete data;
                throw std::bad_alloc();
        }
        png_set_read_user_chunk_fn(data->png_ptr, this, user_read_chunk_callback);

        data->errorhandler.SetupHandlers(data->png_ptr);

        try //the destructor won't be called if any of the PNG init code fails
            //so we must ensure cleanup of the PNG structures ourselves
        {
                data->info_ptr = png_create_info_struct(data->png_ptr);
                if (!data->info_ptr)
                    throw std::bad_alloc();

                if (setjmp(data->errorhandler.error_return)!=0) //a libpng C error occured, convert to exception
                    data->errorhandler.ProcessError();

                png_set_read_fn(data->png_ptr, &data->status, user_read_data);
                if (callback)
                    png_set_keep_unknown_chunks(data->png_ptr, 2/*handle if safe*/, NULL, 0);
                data->status.stream = stream;

                png_read_info(data->png_ptr, data->info_ptr);
                png_get_IHDR(data->png_ptr, data->info_ptr, &_width, &_height, &bit_depth, &color_type,
                        &interlace_type, NULL, NULL);

                if (interlace_type != PNG_INTERLACE_NONE)
                    data->interlaced = true;

                png_set_strip_16(data->png_ptr);
                png_set_packing(data->png_ptr);

                if (color_type == PNG_COLOR_TYPE_PALETTE)
                {
                        png_set_expand(data->png_ptr);
                }

                if (color_type == PNG_COLOR_TYPE_GRAY && bit_depth <8)
                {
                        png_set_expand(data->png_ptr);
                }

                if (png_get_valid(data->png_ptr, data->info_ptr, PNG_INFO_tRNS))
                {
                        png_set_expand(data->png_ptr);
//                        no_alpha = false;
                }

                if (color_type == PNG_COLOR_TYPE_GRAY || color_type == PNG_COLOR_TYPE_GRAY_ALPHA)
                        png_set_gray_to_rgb(data->png_ptr);

                if (color_type == PNG_COLOR_TYPE_GRAY_ALPHA)
                {
//                        no_alpha = false;
                }

                if (color_type == PNG_COLOR_TYPE_RGB_ALPHA)
                {
//                        no_alpha = false;
                }

                // check for alpha
                if (no_alpha)
                        png_set_filler(data->png_ptr, 0xff, PNG_FILLER_AFTER);

                // FIXME: add interlaced image support..
                data->lines = _height;
                data->width = _width;
                data->height = _height;
                data->linebuffer.resize(data->width * 4);
        }
        catch (...) /* the need for try/catch could be eliminated if the create_*_struct
                       calls were part of the Data constructor - which makes sense
                       anyway, because Data's invariants are probably broken without
                       those create_*_struct calls anyway (Arnold) */
        {
                png_destroy_read_struct(&data->png_ptr, &data->info_ptr, (png_infopp)NULL);
                delete data;
                throw; //re-throw png exception
        }
}

PNG_GraphicsReader::~PNG_GraphicsReader()
{
        png_destroy_read_struct(&data->png_ptr, &data->info_ptr, (png_infopp)NULL);
        delete data;
}

bool inline PNG_GraphicsReader::LinesLeft() const
{
        return data->lines>0;
}

void PNG_GraphicsReader::SkipImageData()
{
        Scanline32 dummy(data->width,false); //ADDME - can't libpng just SKIP the IDAT chunk?
        while (LinesLeft())
            GetScanline32(dummy);
}

uint32_t inline PNG_GraphicsReader::GetWidth() const {return data->width;}
uint32_t inline PNG_GraphicsReader::GetHeight() const {return data->height;}

void PNG_GraphicsReader::GetScanline32(Scanline32 &scanline)
{
        if (setjmp(data->errorhandler.error_return)!=0) //a libpng C error occured, convert to exception
            data->errorhandler.ProcessError();

        if (LinesLeft()==false)
            throw std::runtime_error("Reading past end of PNG image");

        if (data->interlaced)
        {
                if (!data->interlaced_img_buffer.get())
                {
                        //read the interlaced image first
                        data->interlaced_img_buffer.reset(new uint8_t[data->width * data->height * 4]);
                        std::vector<png_bytep> row_pointers(data->height);
                        for (unsigned i=0;i<row_pointers.size();++i)
                            row_pointers[i] = &data->interlaced_img_buffer[i * data->width * 4];

                        png_read_image(data->png_ptr, &row_pointers[0]);
                }

                //Copy the scanline from the rowbuffer;
                scanline.ImportScanline(&data->interlaced_img_buffer[(data->height-data->lines) * data->width * 4]);
        }
        else
        {
                png_read_row(data->png_ptr, &(data->linebuffer[0]), NULL);
                scanline.ImportScanline(&(data->linebuffer[0]));
        }
        --data->lines;
        if (data->lines == 0 && (bool)mycallback) //Processed last line, interested in custom chunks?
             png_read_end(data->png_ptr, data->info_ptr); //Flush to the end of the data to process custom chunks
}

//************* WRITING DONE HERE *********************************************

struct PNG_GraphicsWriter::Data
{
        png_structp png_ptr;
        png_infop info_ptr;
        my_png_status status;

        uint32_t width;
        uint32_t height;
        bool BitmapIO;
        uint32_t lines;

        PNG_ErrorData errorhandler;
};

PNG_GraphicsWriter::PNG_GraphicsWriter(bool _alpha)
: data(new Data)
{
        alpha = _alpha;
}

PNG_GraphicsWriter::~PNG_GraphicsWriter()
{
        /* ADDME: Niels, is het veilig om png_write_end ook bij exceptions aan te roepen ? */
        // Niels: Geen idee.. ik weet nix van die LIB..
        // ADDME: Ehm, zoek dat op dan? :)
        // Niels: Tja, uuhh... waardan? die DOX zijn waaaaazzzziggggg.. ofzo..
        png_write_end(data->png_ptr, data->info_ptr);
        png_destroy_write_struct(&data->png_ptr, &data->info_ptr);

        delete data;
}

void PNG_GraphicsWriter::WriteLine(const Scanline32 *scanline)
{
        assert(scanline);
        if (setjmp(data->errorhandler.error_return)!=0) //a libpng C error occured, convert to exception
            data->errorhandler.ProcessError();

        // copy data to avoid constness problems.

        scanlinedata.resize(scanline->GetWidth()*4);
        uint8_t *dest = &(scanlinedata[0]);
        scanline->ExportScanline(dest);
        if(!alpha)
        {
                //Blend alpha with white
                uint8_t *destlimit = &dest[scanline->GetWidth()*4];
                for(uint8_t *ptr=dest;ptr<destlimit;ptr+=4)
                {
                      uint8_t a = ptr[3];
                      if(a!=255)
                      {
                            ptr[0] = static_cast<uint8_t>(255-a + (ptr[0] * a) / 255);
                            ptr[1] = static_cast<uint8_t>(255-a + (ptr[1] * a) / 255);
                            ptr[2] = static_cast<uint8_t>(255-a + (ptr[2] * a) / 255);
                      }
                }
        }
        //VALGRIND_CHECK_READABLE(dest, data->width*4);
        png_write_row(data->png_ptr, dest);
}

void PNG_GraphicsWriter::WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap)
{
        data->width   = bitmap.GetWidth();
        data->height  = bitmap.GetHeight();
        data->png_ptr = png_create_write_struct(PNG_LIBPNG_VER_STRING,0,0,0);
        data->info_ptr = png_create_info_struct(data->png_ptr);
        //alpha = false;

        data->errorhandler.SetupHandlers(data->png_ptr);

        try //guarantee that the png srtuctures will be deleted
        {
                if (setjmp(data->errorhandler.error_return)!=0) //a libpng C error occured, convert to exception
                    data->errorhandler.ProcessError();

                data->status.stream = &stream;
                png_set_write_fn(data->png_ptr, &data->status, user_write_data, user_flush_data);
        }
        catch (...)
        {
                png_destroy_write_struct(&data->png_ptr, &data->info_ptr);
                throw;
        }
        if (setjmp(data->errorhandler.error_return)!=0)
                data->errorhandler.ProcessError();

        png_set_IHDR(data->png_ptr, data->info_ptr,
                     data->width, data->height, 8,
                     alpha ? PNG_COLOR_TYPE_RGB_ALPHA : PNG_COLOR_TYPE_RGB,
                PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_BASE, PNG_FILTER_TYPE_BASE);

        //ADDME: Perhaps suppress info for small files?
        png_text text_ptr;
        text_ptr.key = const_cast<char*>("Software");
        text_ptr.text = const_cast<char*>("Blex DrawLib 2.0");
        text_ptr.compression = PNG_TEXT_COMPRESSION_NONE;
        png_set_text(data->png_ptr, data->info_ptr, &text_ptr, 1);

        // set gamma to something reasonable..
        png_set_gamma(data->png_ptr, 1.4 , 1.4);

        png_write_info(data->png_ptr, data->info_ptr);

        if (alpha==false)
            png_set_filler(data->png_ptr, 0, PNG_FILLER_AFTER);

        data->lines = data->height;
        for(uint32_t y=0; y<bitmap.GetHeight(); y++)
        {
                Scanline32 temp = bitmap.GetScanline32(y);
                WriteLine(&temp); //FIXME TEMP
        }
}

void PNG_GraphicsWriter::WritePalettedBitmap(Blex::Stream &stream, const Bitmap32 &bitmap, Octree & my_octree)
{
        data->width   = bitmap.GetWidth();
        data->height  = bitmap.GetHeight();
        data->png_ptr = png_create_write_struct(PNG_LIBPNG_VER_STRING,0,0,0);
        data->info_ptr = png_create_info_struct(data->png_ptr);

        data->errorhandler.SetupHandlers(data->png_ptr);

        try //guarantee that the png srtuctures will be deleted
        {
                if (setjmp(data->errorhandler.error_return)!=0) //a libpng C error occured, convert to exception
                    data->errorhandler.ProcessError();

                data->status.stream = &stream;
                png_set_write_fn(data->png_ptr, &data->status, user_write_data, user_flush_data);
        }
        catch (...)
        {
                png_destroy_write_struct(&data->png_ptr, &data->info_ptr);
                throw;
        }
        if (setjmp(data->errorhandler.error_return)!=0)
                data->errorhandler.ProcessError();

        // make room for a color quantized bitmap
        std::unique_ptr<uint8_t[]> quantizedbitmap(new uint8_t[bitmap.GetWidth() * bitmap.GetHeight()]);

        // now, build the palette..
        Palette my_palette;
        my_octree.BuildPalette(my_palette);

        // lookup all the colors using the octree..

        uint16_t last_palette_index = 0;
        Pixel32 last_color;
        for(unsigned int y=0; y<bitmap.GetHeight(); y++)
        {
                /* FIXME: Code duplication between graphics_rw.gif and PNG graphics writer */

                const Scanline32 &scanlineptr = bitmap.GetScanline32(y);
                for(unsigned int x=0; x<bitmap.GetWidth(); x++)
                {
                        Pixel32 pixel = scanlineptr.Pixel(x);
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
                        quantizedbitmap.get()[(y*bitmap.GetWidth()+x)] = palette_index;
                }
        }
        // write the header..

        png_set_IHDR(data->png_ptr, data->info_ptr,
                data->width, data->height, 8, PNG_COLOR_TYPE_PALETTE,
                PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);

        png_set_gamma(data->png_ptr, 1.4, 1.4);

        // setup the palette information in the header!
        png_color pngpalette[256];
        // get the number of used palette entries
        uint8_t pal_colors = my_palette.TotalColors;

        // translate the colortable to something that LIBPNG understands..
        for(int i=0; i<pal_colors; i++)
        {
                pngpalette[i+1].red   = my_palette.entries[i].GetR();
                pngpalette[i+1].green = my_palette.entries[i].GetG();
                pngpalette[i+1].blue  = my_palette.entries[i].GetB();
        }
        // make the first palette entry transparent white!
        pngpalette[0].red = 255;
        pngpalette[0].green = 255;
        pngpalette[0].blue = 255;

        // dunno what value this should be.. needs testing.
        // should either be 255 or 0 ...
        uint8_t transval = 0;

        png_set_PLTE(data->png_ptr, data->info_ptr, pngpalette, pal_colors+1);
        png_set_tRNS(data->png_ptr, data->info_ptr, &transval, 1, 0);

        png_write_info(data->png_ptr, data->info_ptr);

        data->lines = data->height;

        for(unsigned int i=0; i<data->lines; i++)
        {
                png_write_row(data->png_ptr, quantizedbitmap.get()+i*data->width);
        }
        data->lines = 0;
}

void PNG_GraphicsWriter::WritePalettedBitmap(Blex::Stream &stream, const Bitmap32 &bitmap)
{
        //build octree
        Octree my_octree;
        FillOctreeAndCountAlpha(bitmap, my_octree, 127);
        WritePalettedBitmap(stream, bitmap, my_octree);
}


//---------------------------------------------------------------------------------
// DrawLib::Bitmap32 reader
//---------------------------------------------------------------------------------
Bitmap32_GraphicsReader::Bitmap32_GraphicsReader(DrawLib::Bitmap32 const &bitmap)
: bitmap(bitmap)
, current_scanline(0)
{
        //Warning! Bitmap32Owning_GraphicsReader depends on still being able to change the bitmap after this call, so don't
        //pre-cache bitmap info!
}

Bitmap32_GraphicsReader::~Bitmap32_GraphicsReader()
{
}

void Bitmap32_GraphicsReader::GetScanline32(Scanline32& output_scanline)
{
        if (current_scanline >= GetHeight())
            throw std::runtime_error("Requesting nonexisting scanline");
        output_scanline = bitmap.GetScanline32(current_scanline++);
}
uint32_t Bitmap32_GraphicsReader::GetWidth() const
{
        return bitmap.GetWidth();
}
uint32_t Bitmap32_GraphicsReader::GetHeight() const
{
        return bitmap.GetHeight();
}
bool Bitmap32_GraphicsReader::LinesLeft() const
{
        return current_scanline < GetHeight();
}

Bitmap32Owning_GraphicsReader::Bitmap32Owning_GraphicsReader(DrawLib::Bitmap32 const &bitmap)
: Bitmap32_GraphicsReader(bitmap_copy)
, bitmap_copy(bitmap)
{
}
Bitmap32Owning_GraphicsReader::~Bitmap32Owning_GraphicsReader()
{
}

//---------------------------------------------------------------------------------
// WBMP (wap wap wap ;-)
//---------------------------------------------------------------------------------
/*
WBMP_GraphicsWriter::WBMP_GraphicsWriter(Blex::Stream *_stream, uint32_t _width, uint32_t _height)
{
        width = _width;
        height = _height;
        stream = _stream;

        WriteHeader();
}
WBMP_GraphicsWriter::~WBMP_GraphicsWriter()
{
}

void WBMP_GraphicsWriter::WriteHeader()
{
        //header:
        //TypeField(s) 8..8*h
        //FixHeaderField 8
        //ExtHeaderField(s) 0..8*k
        //Width 8..8*m
        //Height 8..8*n

        uint8_t headerlength = 4;
        uint8_t * header;
        header = new uint8_t[headerlength];
        header[0] = 0;  //type 0
        header[1] = 0;  //no extensions

        header[2] = width; //must be multiple of 8
        header[3] = height;//must be multiple of 8

        stream->Write(header , headerlength);
}

void WBMP_GraphicsWriter::WriteLine(const uint8_t *rgba_line)
{
}

void WBMP_GraphicsWriter::WriteBitmap(const uint8_t *rgba_buffer)
{
}



RAW_GraphicsWriter::RAW_GraphicsWriter(Blex::Stream *_stream, uint32_t _width, uint32_t _height)
{
        width = _width;
        height = _height;
        stream = _stream;
}

RAW_GraphicsWriter::~RAW_GraphicsWriter()
{
}

void RAW_GraphicsWriter::WriteLine(const uint8_t *rgba_line)
{
        for(uint32_t x=0; x<width; x++)
        {
                stream->Write(rgba_line+(x<<2), 3);
        }
}

void RAW_GraphicsWriter::WriteBitmap(const uint8_t *rgba_buffer)
{
        for(uint32_t y=0; y<height; y++)
        {
                WriteLine(rgba_buffer+(width*4)*y);
                printf("%u \n",y);
        }
}
*/

/******************************************************************************
 FRIGGING INSANITY HERE
 *****************************************************************************/
/*
HTMLTABLE_GraphicsWriter::HTMLTABLE_GraphicsWriter(Blex::Stream *_stream, uint32_t _width, uint32_t _height, bool _compressed)
: stream(_stream)
, compressed(_compressed)
, width(_width)
, height(_height)
{
        stream->WriteString("<table border=\"0\" cellspacing=\"0\" cellpadding=\"0\">\n");
}

HTMLTABLE_GraphicsWriter::~HTMLTABLE_GraphicsWriter()
{
        stream->WriteString("</table>\n");
}

inline char HexChar(unsigned x) { return char(x<=9 ? (x+'0') : (x-10+'A')); }

void HTMLTABLE_GraphicsWriter::WriteLine(const uint8_t *rgba_line)
{
        stream->WriteString("  <tr>\n");
        for (unsigned i=0;i<width;++i)
        {
                //ADDME: Handle alpha channel by not printing any bgcolor
                char cell[100];
                strcpy(cell,"    <td width=\"1\" bgcolor=\"#");
                char *cellptr=&cell[strlen(cell)];
                *cellptr++ = HexChar((rgba_line[i*4] & 0xf0) >> 4);
                *cellptr++ = HexChar((rgba_line[i*4] & 0xf));
                *cellptr++ = HexChar((rgba_line[i*4+1] & 0xf0) >> 4);
                *cellptr++ = HexChar((rgba_line[i*4+1] & 0xf));
                *cellptr++ = HexChar((rgba_line[i*4+2] & 0xf0) >> 4);
                *cellptr++ = HexChar((rgba_line[i*4+2] & 0xf));
                strcpy(cellptr,"\"></td>\n");

                stream->Write(cell,strlen(cell));
        }
        stream->WriteString("  </tr>\n");
}

void HTMLTABLE_GraphicsWriter::WriteBitmap(const uint8_t *rgba_buffer)
{
        for (unsigned i=0;i<height;++i)
            WriteLine(rgba_buffer + i*width*4);
}

*/

/*
This is kinda tricky code. It build an octree, depeing on if the bitmap uses alpha;s.
The check if it uses alpha (and so the decision whete it will be transparent or not)
is done elsewhere. But here we DO check on the alpha of 127.. so it is a little confusing.
I think it would be for the best if BOTH values are the same...

So I introduced a minimun alpha. This will make things easier, because now the caller can
uses the SAME value to check if alpha is used to determine if the pixel should be taken into
accoutn when building the octree.
*/
uint32_t FillOctreeAndCountAlpha(Bitmap32 const & bitmap, Octree & my_octree, uint8_t minimum_alpha)
{
        // first walk through the original bitmap..
        uint32_t alpha_count=0, occurences=0;
        bool first_color = true;
        Pixel32 last_pixel;

        for(unsigned int y=0; y<bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanlineptr = bitmap.GetScanline32(y);
                for(unsigned int x=0; x<bitmap.GetWidth(); x++)
                {
                        const Pixel32 pixel = scanlineptr.Pixel(x);
                        if (pixel.GetA() < minimum_alpha)
                        {
                                alpha_count++;             //count this pixel, since its alpha is great enough :)
                        }
                        else
                        {
                                if ((pixel.GetR() == last_pixel.GetR() )  &&
                                    (pixel.GetG() == last_pixel.GetG() )  &&
                                    (pixel.GetB() == last_pixel.GetB() ) && !first_color)
                                {
                                        occurences++;
                                }
                                else
                                {
                                        if (!first_color)
                                                my_octree.AddColor(last_pixel, occurences); //alpha is discarded in the Octree.
                                        occurences=1;
                                        last_pixel.SetRGBA(pixel.GetR(),pixel.GetG(),pixel.GetB(),255);
                                        first_color=false;
                                }

                        }
                }
        }
        if (occurences>0)
        {
                my_octree.AddColor(last_pixel, occurences);
        }
        return alpha_count;
}

} //end namespace DrawLib
