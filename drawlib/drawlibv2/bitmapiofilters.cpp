#include <drawlib/drawlibv2/allincludes.h>


#include "bitmapiofilters.h"

namespace DrawLib
{

BitmapIOFilter::BitmapIOFilter(BitmapIOFilter *_source) : source(_source)
{
        // init here..
}

void BitmapIOFilter::GetScanline32(Scanline32& output_scanline)
{
        if (source==NULL)
                throw(std::runtime_error("BitmapIOFilter::GetScanline() called with NULL source."));

        // get scanline from the parent..
        return source->GetScanline32(output_scanline);
}

uint32_t BitmapIOFilter::GetWidth() const
{
        if (source==NULL)
                throw(std::runtime_error("BitmapIOFilter::GetWidth() called with NULL source."));

        // get scanline from the parent..
        return source->GetWidth();
}

uint32_t BitmapIOFilter::GetHeight() const
{
        if (source==NULL)
                throw(std::runtime_error("BitmapIOFilter::GetHeight() called with NULL source."));

        // get scanline from the parent..
        return source->GetHeight();
}

}

