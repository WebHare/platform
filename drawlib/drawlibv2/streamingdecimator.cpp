#include <drawlib/drawlibv2/allincludes.h>


#include "streamingdecimator.h"

namespace DrawLib {

/*******************************************************************************
  XDecimationFilter
*******************************************************************************/

XDecimationFilter::XDecimationFilter(BitmapIOFilter *_source, uint32_t decimation_factor)
 : BitmapIOFilter(_source), source(_source), decimation_fac(decimation_factor)
{
        // check arguments..
        if (source == NULL)
                throw(std::runtime_error("XDecimationFilter called with NULL source argument"));
        if(decimation_fac <= 0)
                throw(std::runtime_error("Illegal decimation factor"));

        // calculate the start and end span lengths (in pixels)
        uint32_t cols_spillover = source->GetWidth() % decimation_fac;
        start_cols = cols_spillover / 2;
        end_cols   = cols_spillover - start_cols;

        // calculate the number of 'complete' columns we can do..
        fast_cols  = source->GetWidth() / decimation_fac;

        if (fast_cols==0)
                throw(std::runtime_error("XDecimationFilter: source bitmap is too small for decimation factor"));

        outwidth  = fast_cols;
        outheight = source->GetHeight();

        if (start_cols>0) outwidth++;
        if (end_cols>0) outwidth++;

        // create a temp scanline..
        tempscanline.reset(new Scanline32(source->GetWidth(), true));
}

XDecimationFilter::~XDecimationFilter()
{
}

void XDecimationFilter::GetScanline32(Scanline32 &output)
{
//        uint32_t ox = 0; // output x variable
//        uint32_t ix = 0; // input x variable
        uint32_t r,g,b,a;

        source->GetScanline32(*(tempscanline.get()));
        const Pixel32 *src = tempscanline->GetRawPixels();
        Pixel32 *dest = output.GetRawPixels();

        if (start_cols > 0)
        {
                r=0; g=0; b=0; a=0;
                for(unsigned x=0; x < start_cols; ++x)
                {
                        r+=src->GetR();
                        g+=src->GetG();
                        b+=src->GetB();
                        a+=src->GetA();
                        ++src;
                }
                r/=start_cols;
                g/=start_cols;
                b/=start_cols;
                a/=start_cols;
                dest->SetRGBA(r,g,b,a);
                ++dest;
        }

        for(unsigned x=0; x < fast_cols; ++x)
        {
                r=0;
                g=0;
                b=0;
                a=0;
                for(unsigned i=0; i<decimation_fac; i++)
                {
                        r+=src->GetR();
                        g+=src->GetG();
                        b+=src->GetB();
                        a+=src->GetA();
                        ++src;
                }
                r/=decimation_fac;
                g/=decimation_fac;
                b/=decimation_fac;
                a/=decimation_fac;
                dest->SetRGBA(r,g,b,a);
                ++dest;
        }

        if (end_cols > 0)
        {
                r=0; g=0; b=0; a=0;
                for(unsigned x=0; x < end_cols; ++x)
                {
                        r+=src->GetR();
                        g+=src->GetG();
                        b+=src->GetB();
                        a+=src->GetA();
                        ++src;
                }
                r/=end_cols;
                g/=end_cols;
                b/=end_cols;
                a/=end_cols;
                dest->SetRGBA(r,g,b,a);
                ++dest;
        }
        // muhahahaha.. copy scanline..
        //source->GetScanline32(output);
}

uint32_t XDecimationFilter::GetWidth() const
{
        return outwidth;
        //return source->GetWidth();
}

uint32_t XDecimationFilter::GetHeight() const
{
        return outheight;
}



/*******************************************************************************
  YDecimationFilter
*******************************************************************************/

YDecimationFilter::YDecimationFilter(BitmapIOFilter *_source, uint32_t decimation_factor)
 : BitmapIOFilter(_source), source(_source), decimation_fac(decimation_factor)
{
        // check arguments..
        if (source == NULL) throw(std::runtime_error("YDecimationFilter called with NULL source argument"));
        if(decimation_fac <= 0)
                throw(std::runtime_error("Illegal decimation factor"));

        // calculate the start and end span lengths (in pixels)
        uint32_t rows_spillover = source->GetHeight() % decimation_fac;
        start_rows = rows_spillover / 2;
        end_rows   = rows_spillover - start_rows;

        // calculate the number of 'complete' columns we can do..
        fast_rows  = source->GetHeight() / decimation_fac;

        if (fast_rows==0)
                throw(std::runtime_error("YDecimationFilter: source bitmap is too small for decimation factor"));

        outwidth  = source->GetWidth();
        outheight = fast_rows;

        if (start_rows>0) outheight++;
        if (end_rows>0) outheight++;

        accu_rgba.resize(source->GetWidth()*4);
        output_row_count = 0;
        tempscanline.reset(new Scanline32(source->GetWidth(), true));
}

YDecimationFilter::~YDecimationFilter()
{
}

void YDecimationFilter::ZeroAccu()
{
        //memset(&(accu_rgba[0]), 0, accu_rgba.size() * 4);
        accu_rgba.assign(accu_rgba.size(),0);
}

void YDecimationFilter::Write(Scanline32 &output, int d)
{
        if(d <= 0)
                throw(std::runtime_error("Illegal decimation factor"));

        Pixel32 *dest = output.GetRawPixels();
        uint32_t *in = &accu_rgba[0];

        unsigned limit=tempscanline->GetWidth();
        for(unsigned int x=0; x<limit; ++x)
        {
                uint8_t r = static_cast<uint8_t>(*in++ / d);
                uint8_t g = static_cast<uint8_t>(*in++ / d);
                uint8_t b = static_cast<uint8_t>(*in++ / d);
                uint8_t a = static_cast<uint8_t>(*in++ / d);
                dest->SetRGBA(r,g,b,a);
                ++dest;
        }
}

void YDecimationFilter::AccuInputLine()
{
        source->GetScanline32(*(tempscanline.get()));
        const Pixel32 *src = tempscanline->GetRawPixels();

        uint8_t *in = (uint8_t*)src;
        uint32_t *out = &accu_rgba[0];

        unsigned limit=tempscanline->GetWidth()*4;
        for(unsigned int x=0; x<limit; ++x)
           *out++ += *in++;
/*
        for(unsigned int x=0; x<tempscanline->GetWidth(); ++x)
        {
                accu_r[x] += static_cast<uint32_t>(src->GetR());
                accu_g[x] += static_cast<uint32_t>(src->GetG());
                accu_b[x] += static_cast<uint32_t>(src->GetB());
                accu_a[x] += static_cast<uint32_t>(src->GetA());
                ++src;
        }
*/
}

void YDecimationFilter::GetScanline32(Scanline32 &output)
{
        if ((output_row_count == 0) && (start_rows>0)) // first line.... (special case)
        {
                ZeroAccu();
                for(unsigned y=0; y<start_rows; ++y) AccuInputLine();
                Write(output, start_rows);
        }
        else
          if ((output_row_count == outheight-1 ) && (end_rows>0)) // last line... (special case)
          {
                ZeroAccu();
                for(unsigned y=0; y<end_rows; ++y) AccuInputLine();
                Write(output, end_rows);
          }
          else // middle lines...
          {
                ZeroAccu();
                for(unsigned y=0; y<decimation_fac; ++y) AccuInputLine();
                Write(output, decimation_fac);
          }
        output_row_count++;
}

uint32_t YDecimationFilter::GetWidth() const
{
        return outwidth;
}

uint32_t YDecimationFilter::GetHeight() const
{
        return outheight;
}

} //end namespace DrawLib

