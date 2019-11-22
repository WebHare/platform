#ifndef drawlibv2_graphicsrw_jpeg
#define drawlibv2_graphicsrw_jpeg

#include "graphicsreadwrite.h"

namespace DrawLib
{

/** JPG_GraphicsReader is a class that reads a JPG file from a stream. see GraphicsIO for further details.*/

class BLEXLIB_PUBLIC JPG_GraphicsReader : public GraphicsReader
{
public:
        /** Create a JPG graphics reader
            @param stream - a pointer to a Blex::Stream containing the binary JPEG picture data.
            @param decimation_factor - 1,2,4 or 8 (default=1) downscaling factor/reduce the bitmap size during loading.
        */

        JPG_GraphicsReader(Blex::Stream *stream, uint32_t decimation_factor = 1);
        ~JPG_GraphicsReader();

        void GetScanline32(Scanline32 &scanline);
        bool LinesLeft() const;

        uint32_t  GetWidth() const;
        uint32_t  GetHeight() const;
private:
        struct Data;
        /** Internal data - protect our callers from being required to include
            or install the jpeg libs themselves */
        Data* data;
};

class BLEXLIB_PUBLIC JPG_GraphicsWriter : public GraphicsWriter
{
public:
        /** @param _quality Output image quality (JPEG recommends 75) */
        JPG_GraphicsWriter(uint32_t _quality);
        virtual ~JPG_GraphicsWriter();

        void WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap);
private:
        void WriteLine(const Scanline32 *scanline);
        uint32_t quality;
        struct Data;
        /** Internal data - protect our callers from being required to include
            or install the jpeg libs themselves */
        Data* data;
};

} //end namespace Drawlib
#endif
