#ifndef drawlibv2_graphicsrw_gif
#define drawlibv2_graphicsrw_gif

#include <blex/stream.h>
#include <gif_lib.h>

#include "graphicsreadwrite.h"

namespace DrawLib
{

extern "C"
{
        int GifStreamReader(GifFileType *, GifByteType *, int);
        int GifStreamWriter(GifFileType *, const GifByteType *, int);
}

class BLEXLIB_PUBLIC GifDecompressor
{
        private:
        Blex::Stream &instream;
        GifFileType *gif;
#ifdef DEBUG
        int ImageNum;
#endif
        int BackGround;
        ColorMapObject *ColorMap;
        std::unique_ptr<Bitmap32 > newbitmap;

        bool hastransparentcolor;
        GifPixelType transparentcolor;

        void WriteLine(unsigned rownum, GifPixelType const *linebuffer);

        friend int GifStreamReader(GifFileType *, GifByteType *, int);


        public:
        explicit GifDecompressor(Blex::Stream &instream);
        ~GifDecompressor();

        Bitmap32* ReadImage();
};

class BLEXLIB_PUBLIC GifCompressor
{
        private:
        Blex::Stream &outstream;
        GifFileType *gif;
        ColorMapObject *OutputColorMap;

        int ColorsToBpp(int colors);

        friend int GifStreamWriter(GifFileType *, GifByteType const *, int);

        public:
        explicit GifCompressor(Blex::Stream &outstream);
        ~GifCompressor();

        void WriteImage(Bitmap32 const  &bitmap);
};

} //end namespace Drawlib
#endif
