#ifndef drawlib_png_io_h
#define drawlib_png_io_h

#include <png.h>
namespace DrawLib
{
namespace
{
        void user_read_data(png_structp png_ptr,
                png_bytep data, png_uint_32 length);
        void user_write_data(png_structp png_ptr,
                png_bytep data, png_uint_32 length);
        void user_flush_data(png_structp png_ptr);

        typedef struct
        {
                Blex::Stream *stream;
        } my_png_status;

        typedef my_png_status *my_pngstatus_ptr ;
}
}
#endif

