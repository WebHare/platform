#ifndef blex_drawlib_bitmapiofilters
#define blex_drawlib_bitmapiofilters

#ifndef blex_drawlib_scanline
#include "scanline.h"
#endif

namespace DrawLib
{

/** BitmapIOFilter - The base class of all the BitmapIO filters..
    These filters are streaming so they use as little memory as possible.
    Each filter has a GetScanline32 method that produces a processed scanline.
    BitmapIOFilters are meant to be chained together to provide all the processing
    needed in one go.
*/

class BLEXLIB_PUBLIC BitmapIOFilter
{
public:
        BitmapIOFilter(BitmapIOFilter *_source);
        virtual ~BitmapIOFilter() {};

        /** GetScanline32 gets a scanline from the filter and put it in output_scanline.
            Override this method so each filter can return it's own modified version of it's
            source bitmap's scanline.

            Each call advances to the next scanline. Scanlines are processed from top to bottom.
        */

        virtual void GetScanline32(Scanline32& output_scanline);

        /** GetWidth returns the width (pixels) of the filter's output bitmap.
            Override this only when the filter's output bitmap does not match the source's bitmap size.
            basically this is only when resizing.. */
        virtual uint32_t GetWidth() const;

        /** GetHeight returns the height (pixels) of the filter's output bitmap.
            Override this only when the filter's output bitmap does not match the source's bitmap size.
            basically this is only when resizing.. */
        virtual uint32_t GetHeight() const;

protected:
        BitmapIOFilter *source;
};


/** A filter that changes the pixels to greyscale.. */
class BLEXLIB_PUBLIC BlackWhiteFilter : public BitmapIOFilter
{
public:
        BlackWhiteFilter(BitmapIOFilter *_source, double _mulfac) :
                BitmapIOFilter(_source),
                mul_fac(_mulfac) {};

        virtual ~BlackWhiteFilter() {};
        virtual void GetScanline32(Scanline32& output_scanline);

private:
        double mul_fac;
};

}

#endif

