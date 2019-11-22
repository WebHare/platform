/* ADDME: test with a few corrupt images, because we're currently leaking
          libjpeg resources when aborting because of a corrupted file */

#include <drawlib/drawlibv2/allincludes.h>

#include <blex/utils.h>
#include "bitmapio.h"
#include "jpeg_io.h"
#include "graphicsrw_jpeg.h"

#include <setjmp.h>
#include <stdexcept>

namespace DrawLib
{

const unsigned JpegBufferSize = 16384;

/******************************************************************************
        JPEG STUFF HERE.....
******************************************************************************/

struct my_error_mgr
{
        jpeg_error_mgr pub;     /* "public" fields */
        jmp_buf setjmp_buffer;  /* for return to caller */
};

struct JPG_GraphicsReader::Data
{
        jpeg_decompress_struct cinfo;
        my_error_mgr jerr;
        my_source_mgr  source_mgr;
        std::vector<JSAMPLE> linebuffer;

        int32_t     lines;
        uint32_t     width;
        uint32_t     height;
        uint32_t     decimation_factor;
};

namespace
{

METHODDEF(void) my_error_exit (j_common_ptr cinfo)
{
        /* cinfo->err really points to a my_error_mgr struct, so coerce pointer */
        my_error_mgr *myerr = (my_error_mgr*) cinfo->err;

        //ADDME: store the error message ?

        /* Return control to the setjmp point */
        longjmp(myerr->setjmp_buffer, 1);
}

METHODDEF(void) my_output_message (j_common_ptr)
{
}

METHODDEF(void) init_source (j_decompress_ptr cinfo)
{
        my_src_ptr src = (my_src_ptr) cinfo->src;
        src->start_of_file = TRUE;
}

METHODDEF(boolean) fill_input_buffer (j_decompress_ptr cinfo)
{
        my_src_ptr src = (my_src_ptr) cinfo->src;
        size_t nbytes;

        nbytes = src->stream->Read(src->buffer, JpegBufferSize*sizeof(JOCTET));
        if (nbytes<=0)
        {
                // file read error - terminate!
                src->buffer[0] = (JOCTET) 0xFF;
                src->buffer[1] = (JOCTET) JPEG_EOI;
                nbytes = 2;
        }
        src->pub.next_input_byte = src->buffer;
        src->pub.bytes_in_buffer = nbytes;
        src->start_of_file = FALSE;

        return TRUE;
}

METHODDEF(void) skip_input_data (j_decompress_ptr cinfo, long num_bytes)
{
        my_src_ptr src = (my_src_ptr) cinfo->src;
        if (num_bytes>0)
        {
                while(num_bytes > (long) src->pub.bytes_in_buffer)
                {
                        num_bytes-= (long) src->pub.bytes_in_buffer;
                        fill_input_buffer(cinfo);
                }
                src->pub.next_input_byte += (size_t) num_bytes;
                src->pub.bytes_in_buffer -= (size_t) num_bytes;
        }
}

METHODDEF(void) term_source (j_decompress_ptr /*cinfo*/)
{
        // no work yet...
}

GLOBAL(void) jpeg_stream_src (j_decompress_ptr cinfo, Blex::Stream* stream)
{
        my_src_ptr src;

        cinfo->src = (struct jpeg_source_mgr *)new my_source_mgr;
        src = (my_src_ptr) cinfo->src;
        src->buffer = new JOCTET[JpegBufferSize];
        src->pub.init_source = init_source;
        src->pub.fill_input_buffer = fill_input_buffer;
        src->pub.skip_input_data = skip_input_data;
        src->pub.resync_to_restart = jpeg_resync_to_restart;
        src->pub.term_source = term_source;
        src->stream = stream;
        src->pub.bytes_in_buffer = 0;
        src->pub.next_input_byte = NULL;
}

METHODDEF(void) init_destination (j_compress_ptr cinfo)
{
        my_dest_ptr dest = (my_dest_ptr) cinfo->dest;

        dest->buffer = (JOCTET*) new JOCTET[JpegBufferSize];
        dest->pub.next_output_byte = dest->buffer;
        dest->pub.free_in_buffer = JpegBufferSize;
}

METHODDEF(boolean) empty_output_buffer (j_compress_ptr cinfo)
{
        my_dest_ptr dest = (my_dest_ptr) cinfo->dest;
        dest->stream->Write(dest->buffer, JpegBufferSize);
        dest->pub.next_output_byte = dest->buffer;
        dest->pub.free_in_buffer = JpegBufferSize;
        return TRUE;
}

METHODDEF(void) term_destination(j_compress_ptr cinfo)
{
        my_dest_ptr dest = (my_dest_ptr) cinfo->dest;
        size_t datacount = JpegBufferSize - dest->pub.free_in_buffer;
        if (datacount>0)
                dest->stream->Write(dest->buffer, datacount);
}

GLOBAL(void) jpeg_stream_dest (j_compress_ptr cinfo, Blex::Stream *stream)
{
        my_dest_ptr dest;

        dest = (my_dest_ptr) cinfo->dest;
        dest->pub.init_destination = init_destination;
        dest->pub.empty_output_buffer = empty_output_buffer;
        dest->pub.term_destination = term_destination;
        dest->stream = stream;
}

} //end anonymous namespace

JPG_GraphicsReader::JPG_GraphicsReader(Blex::Stream* stream, uint32_t decimation_factor)
  : data(new Data) //leaks if constructor throws
{
        data->cinfo.err = jpeg_std_error(&data->jerr.pub);
        data->cinfo.err->error_exit = my_error_exit;
        data->cinfo.err->output_message = my_output_message;
        data->decimation_factor = decimation_factor;

        if (setjmp(data->jerr.setjmp_buffer))
        {
                delete data;
                throw std::runtime_error("JPEG file corrupted (error in header)");
        }

        jpeg_create_decompress(&data->cinfo);         // setup cinfo structure..
        data->cinfo.src = &(data->source_mgr.pub);          // get the source mananger in place..

        jpeg_stream_src(&data->cinfo, stream);
        jpeg_read_header(&data->cinfo, TRUE);

        switch(decimation_factor)
        {
        case 1:
        case 2:
        case 4:
        case 8:
                data->cinfo.scale_denom = decimation_factor;
                data->cinfo.scale_num = 1;
                break;
        default:
                delete data;
                throw(std::runtime_error("JPG_GraphicsReader called with invalid decimation factor."));
                break;
        }

        if (data->cinfo.jpeg_color_space == JCS_CMYK || data->cinfo.jpeg_color_space == JCS_YCCK)
        {
                data->cinfo.out_color_space = JCS_CMYK;
        }
        else
        {
                data->cinfo.out_color_space = JCS_RGB;
        }

        jpeg_start_decompress(&data->cinfo);
        // the width and height are set correctly after jpeg_start_decompress.. (see jpeg.dox..)
        data->width = data->cinfo.output_width;
        data->height = data->cinfo.output_height;
        data->linebuffer.resize(data->cinfo.output_width * data->cinfo.output_components);

        /*
        if (data->cinfo.jpeg_color_space == JCS_CMYK || data->cinfo.jpeg_color_space == JCS_YCCK)
        {
                //libjpeg doesn't consider itself worthy to to CMYK->RGB conversions
                //so we'll have to do it ourselves
                data->cinfo.out_color_space = JCS_CMYK;
                data->linebuffer.resize(data->width*4);
        }
        else
        {
                //co-erce libjpeg to convert the data to RGB
                data->cinfo.out_color_space = JCS_RGB;
                data->linebuffer.resize(data->width*3);
        }*/

        data->lines = data->height-1;
}

JPG_GraphicsReader::~JPG_GraphicsReader()
{
        jpeg_destroy_decompress(&data->cinfo);
        delete[] ((my_source_mgr*)data->cinfo.src)->buffer; //suspicious: class cannot clean up its own resources?
        delete (my_source_mgr*)data->cinfo.src;
        delete data;
}

void JPG_GraphicsReader::GetScanline32(Scanline32 &scanline)
{
        if (setjmp(data->jerr.setjmp_buffer))
            throw std::runtime_error("JPEG file corrupted (error extracting scanline)");

        // bail if no lines left!
        if (LinesLeft()==false)
            return;

        Pixel32 *d = scanline.GetRawPixels();
        JSAMPLE *s = &data->linebuffer[0];
        jpeg_read_scanlines(&data->cinfo, &s, 1);

        if (data->cinfo.out_color_space == JCS_CMYK)
        {
                /* ADDME: Better algorithm.
                   from google:
                   A little knowledge is always a dangerous thing, but anyway let me
                    offer the following suggestion:

                      R = (1-K)(1-C)
                      G = (1-K)(1-M)
                      B = (1-K)(1-Y)
                */
                for(uint32_t i=0; i<data->width; i++)
                {
                        int c,m,y,k;
                        if (data->cinfo.saw_Adobe_marker) //Adobe INVERTS the CMYK space
                        {
                                c=255-s[0];
                                m=255-s[1];
                                y=255-s[2];
                                k=255-s[3];
                        }
                        else
                        {
                                c=s[0];
                                m=s[1];
                                y=s[2];
                                k=s[3];
                        }

                        d->SetRGBA(Blex::Bound(0,255,(255-k)*(255-c)/255),
                                   Blex::Bound(0,255,(255-k)*(255-m)/255),
                                   Blex::Bound(0,255,(255-k)*(255-y)/255),
                                   255);
                        s+=4;
                        d++;
                }
        }
        else //RGB
        {
                for(uint32_t i=0; i<data->width; i++)
                {
                        d->SetRGBA(*(s), *(s+1), *(s+2), 255);
                        s=s+3;
                        d++;
                }
        }
        data->lines--;
}

bool JPG_GraphicsReader::LinesLeft() const
{
        return (data->lines>-1);
}

uint32_t JPG_GraphicsReader::GetWidth() const
{
        return data->width;
}
uint32_t JPG_GraphicsReader::GetHeight() const
{
        return data->height;
}

//************* WRITING DONE HERE *********************************************

struct JPG_GraphicsWriter::Data
{
        my_destination_mgr destination_mgr;
        jpeg_compress_struct cinfo;
        my_error_mgr jerr;
        uint32_t height;
        uint32_t width;
        uint32_t lines;
        JSAMPLE *linebuffer;
};

JPG_GraphicsWriter::JPG_GraphicsWriter(uint32_t _quality)
:  quality(_quality), data(new Data) //leaks if constructor throws
{
}

JPG_GraphicsWriter::~JPG_GraphicsWriter()
{
        jpeg_finish_compress(&data->cinfo);
        delete[] data->linebuffer;
        delete[] ((my_destination_mgr*)data->cinfo.dest)->buffer;
        jpeg_destroy_compress(&data->cinfo);
        delete data;
}

void JPG_GraphicsWriter::WriteLine(const Scanline32 *scanline)
{
        if (setjmp(data->jerr.setjmp_buffer))
            throw std::runtime_error("JPEG file write error");

        assert(scanline->GetWidth()==data->width);
        uint8_t *d = (uint8_t*)data->linebuffer;
        const Pixel32 *s = scanline->GetRawPixels();
        // build a line in the linebuffer..
        for(uint32_t i=0; i<data->width; i++)
        {
                uint8_t a = s->GetA();
                if(a==255) //copy-as-is
                {
                        *(d++) = s->GetR();
                        *(d++) = s->GetG();
                        *(d++) = s->GetB();
                }
                else //blend to white
                {
                        *(d++) = static_cast<uint8_t>(255 - a + (s->GetR() * a) / 255);
                        *(d++) = static_cast<uint8_t>(255 - a + (s->GetG() * a) / 255);
                        *(d++) = static_cast<uint8_t>(255 - a + (s->GetB() * a) / 255);
                }
                ++s;
        }
        jpeg_write_scanlines(&data->cinfo, &data->linebuffer, 1);
}

void JPG_GraphicsWriter::WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap)
{
        if (setjmp(data->jerr.setjmp_buffer))
            throw std::runtime_error("JPEG file corrupted (error writing)");

        data->width  = bitmap.GetWidth();
        data->height = bitmap.GetHeight();
        data->lines  = bitmap.GetHeight();
        data->cinfo.err = jpeg_std_error(&data->jerr.pub);
        data->cinfo.err->error_exit = my_error_exit;
        data->cinfo.err->output_message = my_output_message;
        jpeg_create_compress(&data->cinfo);

        data->cinfo.image_width = bitmap.GetWidth();
        data->cinfo.image_height = bitmap.GetHeight();
        data->cinfo.input_components = 3;
        data->cinfo.in_color_space = JCS_RGB;
        jpeg_set_defaults(&data->cinfo); //set_defaults must be called after setting up the color space

        data->cinfo.dest = &(data->destination_mgr.pub);
        jpeg_stream_dest(&data->cinfo, &stream);

        jpeg_set_quality(&data->cinfo, quality, FALSE);
        jpeg_start_compress(&data->cinfo, TRUE);
        data->linebuffer = new JSAMPLE[data->width*3];

        for(uint32_t y=0; y<bitmap.GetHeight(); y++)
        {
                Scanline32 temp = bitmap.GetScanline32(y);
                WriteLine(&temp); //FIXME TEMP
        }
}

/*******************************************************************************
        JPG STUFF....
*******************************************************************************/

void SaveBitmap32AsJPG(Blex::Stream *stream, const Bitmap32 &bitmap, uint32_t quality)
{
        if (stream==NULL)
                throw(std::runtime_error("SaveBitmap32AsJPG called with NULL stream"));

        if (!(/*quality>=0 && */quality<=100))
                throw(std::runtime_error("SaveBitmap32AsJPG called with out-of-bounds quality"));

        JPG_GraphicsWriter jpgwriter(quality);
        jpgwriter.WriteBitmap(*stream, bitmap);
}

Bitmap32 * CreateBitmap32FromJPG(Blex::Stream *stream, int decimation)
{
        if (stream==NULL)
                throw(std::runtime_error("CreateBitmap32FromJPG called with NULL stream"));

        JPG_GraphicsReader jpgreader(stream, decimation);
        // test the height and width
        Bitmap32 *newbitmap = new Bitmap32(jpgreader.GetWidth(), jpgreader.GetHeight());
        // get a temporary scanline.
        Scanline32 tempscanline(jpgreader.GetWidth(), true);

        for(uint32_t y=0; y<jpgreader.GetHeight(); y++)
        {
                // read a scanline from the file..
                jpgreader.GetScanline32(tempscanline);
                // write the scanline to the new bitmap
                newbitmap->SetScanline32(y, tempscanline);
        }
        return newbitmap;
}


} //end namespace DrawLib
