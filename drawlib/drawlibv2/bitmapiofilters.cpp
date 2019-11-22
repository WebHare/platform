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

void BlackWhiteFilter::GetScanline32(Scanline32& output_scanline)
{
        unsigned int width = GetWidth();
        source->GetScanline32(output_scanline);
        for(unsigned int x=0; x<width; x++)
        {
                double grey = 0.30*(double)output_scanline.Pixel(x).GetR()+
                             0.59*(double)output_scanline.Pixel(x).GetG()+
                             0.11*(double)output_scanline.Pixel(x).GetB();
                grey*=mul_fac;
                grey = (grey>255.0) ? 255.0 : grey;
                grey = (grey<0.0) ? 0.0 : grey;
                output_scanline.Pixel(x).SetRGBA(static_cast<uint8_t>(grey),
                        static_cast<uint8_t>(grey),
                        static_cast<uint8_t>(grey),
                        255);
        }
}


}

