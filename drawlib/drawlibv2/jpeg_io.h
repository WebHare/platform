#ifndef drawlib_jpeg_io_h
#define drawlib_jpeg_io_h

#include <blex/stream.h>

extern "C" {

//#define XMD_H
//#define HAVE_BOOLEAN

#define boolean jpeg_boolean
#define INT32 jpeg_INT32
#include <jpeglib.h>

} //extern "C"


namespace DrawLib
{
namespace
{
        typedef struct {
                struct jpeg_source_mgr pub;
                Blex::Stream *stream;
                JOCTET *buffer;
                int start_of_file;
        } my_source_mgr;

        typedef my_source_mgr *my_src_ptr;

        METHODDEF(void) init_source (j_decompress_ptr cinfo);
        METHODDEF(boolean) fill_input_buffer (j_decompress_ptr cinfo);
        METHODDEF(void) skip_input_data (j_decompress_ptr cinfo, long num_bytes);
        METHODDEF(void) term_source (j_decompress_ptr cinfo);
//        GLOBAL(void) jpeg_stream_src (j_decompress_ptr cinfo, Blex::Stream &stream);

        typedef struct {
                struct jpeg_destination_mgr pub;
                Blex::Stream *stream;
                JOCTET *buffer;
        } my_destination_mgr;

        typedef my_destination_mgr *my_dest_ptr;

        METHODDEF(void) init_destination (j_compress_ptr cinfo);
        METHODDEF(boolean) empty_output_buffer (j_compress_ptr cinfo);
        METHODDEF(void) term_destination (j_compress_ptr cinfo);
//        GLOBAL(void) jpeg_stream_dest (j_compress_ptr cinfo, Blex::Stream &stream);
}
}
#endif

