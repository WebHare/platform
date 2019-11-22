#include <drawlib/drawlibv2/allincludes.h>

#ifdef RESIZER_SSE
#include <emmintrin.h>
#endif
#include "streamingresizer.h"

namespace DrawLib
{

inline double sinc(double x)
{
        if (fabs(x)<0.0001)
                return 1.0;
        else return (sin(M_PI*x)/(M_PI*x));
}
inline double lanczos3(double x)
{
        if(fabs(x)<3.0)
                return (sinc(x)*sinc(x/3.0));
        else return 0.0;
}

#ifdef IMUL_VERSION
ResizeFilter::KernelUnit inline Float2KernelUnit(double x)
{
        return static_cast<int16_t>(x * 4096.0);
}

unsigned inline ColorValue(ResizeFilter::WideKernelUnit in)
{
        // add 0x07FF to round, not truncate! clamp the pixels
        int val = (in+0x7FF)>>12;
        return val>255 ? 255 : val <0 ? 0 : val;
}

#else

ResizeFilter::KernelUnit inline Float2KernelUnit(double x)
{
        return x;
}

unsigned inline ColorValue(ResizeFilter::WideKernelUnit in)
{
        // add 0x07FF to round, not truncate! clamp the pixels
        int val = RoundFloat(in);
        return val>255 ? 255 : val <0 ? 0 : val;
}

#endif

unsigned inline ColorValueFlt(float in)
{
        // add 0x07FF to round, not truncate! clamp the pixels
        int val = RoundFloat(in);
        return val>255 ? 255 : val <0 ? 0 : val;
}

void ResizeFilter::CalcKernel(KernelUnit *kernel, double dilation_factor)
{
        double temp_kernel[KernelSize];

        // clamp the dilation factor to 1.0..
        if (dilation_factor > 1.0)
                dilation_factor = 1.0;

        // calculate the complete kernel
        for(int i=0; i < int(KernelSize); ++i)
        {
                // Hamming window (see: http://en.wikipedia.org/wiki/Window_function#Hamming_window)
                double window = 0.54 + 0.46*cos(M_PI*static_cast<double>(i-((int)KernelSize/2))/(KernelSize/2));
                temp_kernel[i] = lanczos3(dilation_factor*static_cast<double>(i-((int)KernelSize/2))/KernelShiftSize) * window;
        }

        // make polyphase representation and normalize the kernel..
        uint32_t index = 0;
        for(unsigned int shift=0; shift<KernelShiftSize; shift++)
        {
                double adder = 0.0;
                for(unsigned int i=0; i<KernelWidth; i++)
                {
                        adder += Float2KernelUnit(temp_kernel[(i<<KernelShift)+(KernelShiftSize-1)-(signed)shift]*dilation_factor);
                }
                adder /= (4096.0 * dilation_factor);
                // normalize the kernel..
                for(unsigned int i=0; i<KernelWidth; i++)
                {
                        kernel[index++] = Float2KernelUnit(temp_kernel[(i<<KernelShift)+(KernelShiftSize-1)-shift] / adder);
                }
        }
}

void ResizeFilter::CalcFloatKernel(float *kernel, double dilation_factor)
{
        double temp_kernel[KernelSize];

        // clamp the dilation factor to 1.0..
        if (dilation_factor > 1.0)
                dilation_factor = 1.0;

        // calculate the complete kernel
        for(unsigned int i=0; i<KernelSize; i++)
        {
                // Hamming window (see: http://en.wikipedia.org/wiki/Window_function#Hamming_window)
                double window = 0.54 + 0.46*cos(M_PI*static_cast<double>(i-((int)KernelSize/2))/(KernelSize/2.0f));
                double arg = dilation_factor*static_cast<double>(((int)i)-((int)KernelSize/2))/KernelShiftSize;
                temp_kernel[i] = lanczos3(arg) * window;
        }

        // make polyphase representation and normalize the kernel..
        uint32_t index = 0;
        for(unsigned int shift=0; shift<KernelShiftSize; shift++)
        {
                double adder = 0.0;
//                unsigned int idx = shift;
//                unsigned int inc = KernelWidth;
                for(unsigned int i=0; i<KernelWidth; i++)
                {
                        adder += temp_kernel[(i<<KernelShift)+(KernelShiftSize-1)-shift]*dilation_factor;
                }
                adder /= dilation_factor;
                // normalize the kernel..
//                idx = shift;
                for(unsigned int i=0; i<KernelWidth; i++)
                {
                        kernel[index++] = temp_kernel[(i<<KernelShift)+(KernelShiftSize-1)-shift] / adder;
                }
        }
}

} // end NAMESPACE DrawLib...

using namespace DrawLib;

ResizeFilter::ResizeFilter(BitmapIOFilter *_source, uint32_t _newwidth, uint32_t _newheight)
        : BitmapIOFilter(_source), newwidth(_newwidth), newheight(_newheight), outputlines_produced(0)
{
        ValidateDimensions(newwidth, newheight);

        hresizer.reset(new HorizontalResizer(_source, _source->GetWidth(), _newwidth));
        vresizer.reset(new VerticalResizer(hresizer.get(), _source->GetHeight(), _newheight, _newwidth));
}

ResizeFilter::~ResizeFilter()
{
}

uint32_t ResizeFilter::GetWidth() const
{
        return newwidth;
}

uint32_t ResizeFilter::GetHeight() const
{
        return newheight;
}

void ResizeFilter::GetScanline32(Scanline32& output_scanline)
{
        if (outputlines_produced == newheight)
                throw std::runtime_error("ResizeFilter::GetScanline32 was called too many times.");

        if (output_scanline.GetWidth()!=newwidth)
                throw std::runtime_error("ResizeFilter::GetScanline32 was called with invalid scanline argument.");

        vresizer->GetScanline32(output_scanline);
        outputlines_produced++;
}

// -----------------------------------------------------------------------------
// ResizeFilter::VerticalResizer
// -----------------------------------------------------------------------------

ResizeFilter::VerticalResizer::VerticalResizer(
        HorizontalResizer *_source,  uint32_t inheight, uint32_t outheight, uint32_t _inwidth)
        : mysource(_source), inputscanline(_inwidth, true),
          inbuffer(_inwidth*KernelWidth, true), inwidth(_inwidth)
{
        if (inheight==0)
                throw(std::runtime_error("ResizeFilter::VerticalResizer was called with inheight = 0."));

        if (_source == NULL)
                throw(std::runtime_error("ResizeFilter::VerticalResizer was called with _source = NULL."));

        double scale_factor = 1.0;
        ystep = 0;
        if ((inheight>1) && (outheight>1))
        {
                scale_factor = static_cast<double>(inheight-1) / static_cast<double>(outheight-1);
                ystep = static_cast<uint32_t>(scale_factor * 65536.0);
        }

        // calculate the polyphase filtering kernel.
        CalcKernel(kernel, std::min<double>(1.0, 1.0/scale_factor));
        ypos = 0;

        ylinesleft = inheight;
        // prime the input buffer...
        mysource->GetScanline32(inputscanline);
        ylinesleft--;

        inbuffer.CopyWithOffset(0, inwidth, inputscanline);
        inbuffer.CopyWithOffset(inwidth, inwidth, inputscanline);
        inbuffer.CopyWithOffset(inwidth*2, inwidth, inputscanline);
        inbuffer.CopyWithOffset(inwidth*3, inwidth, inputscanline);

        if (ylinesleft)
        {
                mysource->GetScanline32(inputscanline);
                ylinesleft--;
        }
        inbuffer.CopyWithOffset(inwidth*4, inwidth, inputscanline);
        if (ylinesleft)
        {
                mysource->GetScanline32(inputscanline);
                ylinesleft--;
        }
        inbuffer.CopyWithOffset(inwidth*5, inwidth, inputscanline);
        if (ylinesleft)
        {
                mysource->GetScanline32(inputscanline);
                ylinesleft--;
        }
        inbuffer.CopyWithOffset(inwidth*6, inwidth, inputscanline);
        if (ylinesleft)
        {
                mysource->GetScanline32(inputscanline);
                ylinesleft--;
        }
        inbuffer.CopyWithOffset(inwidth*7, inwidth, inputscanline);
        ypos = 0;
        ypos_last_update = 0;
        r.resize(inwidth);
        g.resize(inwidth);
        b.resize(inwidth);
        a.resize(inwidth);
}

ResizeFilter::VerticalResizer::~VerticalResizer()
{
}

void ResizeFilter::VerticalResizer::GetScanline32(Scanline32 &output_scanline)
{
        std::fill_n(&r[0], inwidth, 0);
        std::fill_n(&g[0], inwidth, 0);
        std::fill_n(&b[0], inwidth, 0);
        std::fill_n(&a[0], inwidth, 0);

        Pixel32 const *inbufferptr = inbuffer.GetRawPixels();
        uint32_t kernel_offset = ((ypos >> (16-KernelShift)) & (KernelShiftSize-1)) * KernelWidth;
        uint32_t yline = ypos >> 16;
        for(unsigned k=0; k<KernelWidth; k++)
        {
                KernelUnit kmul = kernel[kernel_offset+k];
                // calculate the right inbuffer pixel offset to start at..
                Pixel32 const *srcpixels = inbufferptr + inwidth* ((yline+k) & (KernelWidth-1));
                if (kmul!=0)
                {
                        for(unsigned int x=0; x<inwidth; x++)
                        {
                                r[x]+=kmul * static_cast<KernelUnit>(srcpixels->GetR());
                                g[x]+=kmul * static_cast<KernelUnit>(srcpixels->GetG());
                                b[x]+=kmul * static_cast<KernelUnit>(srcpixels->GetB());
                                a[x]+=kmul * static_cast<KernelUnit>(srcpixels->GetA());
                                srcpixels++;
                        }
                }
        }
        for(unsigned int x=0; x<inwidth; x++)
        {
                output_scanline.Pixel(x).SetRGBA(ColorValue(r[x]),ColorValue(g[x]),ColorValue(b[x]),ColorValue(a[x]));
        }
        ypos += ystep;
        uint32_t ypos_last_update_int = ypos_last_update >> 16;
        uint32_t newlines = (ypos >> 16) - ypos_last_update_int;
        uint32_t linecount = 0;
        while(newlines>0)
        {
                if (ylinesleft>0)
                {
                        mysource->GetScanline32(inputscanline);
                        ylinesleft--;
                }
                uint32_t offset = inwidth * ((linecount + ypos_last_update_int) & (KernelWidth-1));
                inbuffer.CopyWithOffset(offset, inwidth, inputscanline);
                newlines--;
                linecount++;
                ypos_last_update = ypos;
        }
}


// -----------------------------------------------------------------------------
// ResizeFilter::HorizontalResizer
// -----------------------------------------------------------------------------
ResizeFilter::HorizontalResizer::HorizontalResizer(BitmapIOFilter *_source, uint32_t inwidth, uint32_t outwidth)
        : mysource(_source), inputscanline(inwidth, true), extendedscanline(inwidth+6, true)
{
        if (inwidth==0)
                throw(std::runtime_error("HorizontalResizer called with inwidth == 0"));
        if (outwidth==0)
                throw(std::runtime_error("HorizontalResizer called with outwidth == 0"));

        double scale_factor = 1.0;
        xstep = 0;
        if ((inwidth>1) && (outwidth>1))
        {
                scale_factor = static_cast<double>(inwidth-1) / static_cast<double>(outwidth-1);
                xstep = static_cast<uint32_t>(scale_factor * 65536.0);
        }

        // calculate the polyphase filtering kernel.
        #ifdef RESIZER_SSE
        CalcFloatKernel(kernel_sse, std::min<double>(1.0, 1.0/scale_factor));
        #else
        CalcKernel(kernel, std::min<double>(1.0, 1.0/scale_factor));
        #endif
}

ResizeFilter::HorizontalResizer::~HorizontalResizer()
{
}

#ifdef RESIZER_SSE

/*
    sse_kernel layout should be: 0,k,0,k,0,k,0,k,0,0,0,0,0,0,0,0 (bytes)
*/
void inline SSE_kernel_mul(const Pixel32 *inpixel, __m128i sse_kernel)
{
        __m128i sse_pixels = _mm_set_epi32(inpixel->GetPixelValue(), 0, 0, 0); // r,g,b,a | 0,0,0,0 | 0,0,0,0 | 0,0,0,0
        __m128i tmp = _mm_set_epi32(0,0,0,0);
        tmp = _mm_unpacklo_epi8(sse_pixels, tmp); // unpack: r,0,g,0 | b,0,a,0 | 0,0,0,0 | 0,0,0,0
}

void ResizeFilter::HorizontalResizer::GetScanline32(Scanline32 &output_scanline)
{
        // get source scanline
        mysource->GetScanline32(inputscanline);
        uint32_t src_width = inputscanline.GetWidth();

        if (extendedscanline_sse.size() != src_width+6)
            extendedscanline_sse.resize(4*(src_width+6));

        // copy pixels 0..n from input buffer to
        // pixels 3..n+3 in the extended scanline
        // and make pixels 0..2 equal to pixel 3
        // and make pixels n+4..n+7 equal to pixel n+3!

        //for(unsigned int i=0; i<src_width; i++)
        //{
        //        Pixel32 p = inputscanline.Pixel(3+i);
        //        extendedscanline_sse[(i+3)*4] = (float)p.GetR();
        //        extendedscanline_sse[(i+3)*4+1] = (float)p.GetG();
        //        extendedscanline_sse[(i+3)*4+2] = (float)p.GetB();
        //        extendedscanline_sse[(i+3)*4+3] = (float)p.GetA();
        //}

        inputscanline.ConvertToFloat(&(extendedscanline_sse[0])+12);

        Pixel32 left = inputscanline.Pixel(0);
        extendedscanline_sse[0] = (float)left.GetR();
        extendedscanline_sse[1] = (float)left.GetG();
        extendedscanline_sse[2] = (float)left.GetB();
        extendedscanline_sse[3] = (float)left.GetA();

        extendedscanline_sse[4] = (float)left.GetR();
        extendedscanline_sse[5] = (float)left.GetG();
        extendedscanline_sse[6] = (float)left.GetB();
        extendedscanline_sse[7] = (float)left.GetA();

        extendedscanline_sse[8] = (float)left.GetR();
        extendedscanline_sse[9] = (float)left.GetG();
        extendedscanline_sse[10] = (float)left.GetB();
        extendedscanline_sse[11] = (float)left.GetA();

        Pixel32 right = inputscanline.Pixel(src_width-1);
        extendedscanline_sse[4*src_width] = (float)right.GetR();
        extendedscanline_sse[4*src_width+1] = (float)right.GetG();
        extendedscanline_sse[4*src_width+2] = (float)right.GetB();
        extendedscanline_sse[4*src_width+3] = (float)right.GetA();

        extendedscanline_sse[4*src_width+4] = (float)right.GetR();
        extendedscanline_sse[4*src_width+5] = (float)right.GetG();
        extendedscanline_sse[4*src_width+6] = (float)right.GetB();
        extendedscanline_sse[4*src_width+7] = (float)right.GetA();

        extendedscanline_sse[4*src_width+8] = (float)right.GetR();
        extendedscanline_sse[4*src_width+9] = (float)right.GetG();
        extendedscanline_sse[4*src_width+10] = (float)right.GetB();
        extendedscanline_sse[4*src_width+11] = (float)right.GetA();

        // resize it... and output it...
        uint32_t source_xpos = 0;
        //Pixel32 const *inpixels = extendedscanline.GetRawPixels();
        // FIXME: make 'nasm' assembler implementation (MMX/SSE??)
        for(unsigned int xout=0; xout<output_scanline.GetWidth(); xout++)
        {
                float sse_result[4];
                uint32_t kernel_offset = ((source_xpos >> (16-KernelShift)) & (KernelShiftSize-1)) * KernelWidth;

                float *srcpixels = &(extendedscanline_sse[0]) + ((source_xpos >> 16)<<2);
                __m128 adder = _mm_setzero_ps();    // zero.
                for(unsigned int k=0; k<KernelWidth; k++)
                {
                        __m128 src  = _mm_loadu_ps(srcpixels);
                        __m128 kmul = _mm_set_ps1(kernel_sse[kernel_offset+k]);
                        __m128 mulresult = _mm_mul_ps(src, kmul);
                        adder = _mm_add_ps(mulresult, adder);

                        srcpixels+=4;
                }
                _mm_storeu_ps(sse_result, adder);
                //printf("%f %f %f %f\n", sse_result[0],sse_result[1],sse_result[2],sse_result[3]);
                output_scanline.Pixel(xout).SetRGBA(ColorValueFlt(sse_result[0]),ColorValueFlt(sse_result[1]),
                        ColorValueFlt(sse_result[2]),ColorValueFlt(sse_result[3]));
                source_xpos += xstep;
        }
}

#else

void ResizeFilter::HorizontalResizer::GetScanline32(Scanline32 &output_scanline)
{
        // get source scanline
        mysource->GetScanline32(inputscanline);
        uint32_t src_width = inputscanline.GetWidth();

        // copy pixels 0..n from input buffer to
        // pixels 3..n+3 in the extended scanline
        // and make pixels 0..2 equal to pixel 3
        // and make pixels n+4..n+7 equal to pixel n+3!
        extendedscanline.CopyWithOffset(3, src_width, inputscanline);
        Pixel32 leftpixel = inputscanline.Pixel(0);
        extendedscanline.Pixel(0) = leftpixel;
        extendedscanline.Pixel(1) = leftpixel;
        extendedscanline.Pixel(2) = leftpixel;
        Pixel32 rightpixel = inputscanline.Pixel(src_width-1);
        extendedscanline.Pixel(src_width+3) = rightpixel;
        extendedscanline.Pixel(src_width+4) = rightpixel;
        extendedscanline.Pixel(src_width+5) = rightpixel;

        // resize it... and output it...
        uint32_t source_xpos = 0;
        Pixel32 const *inpixels = extendedscanline.GetRawPixels();
        // FIXME: make 'nasm' assembler implementation (MMX/SSE??)
        for(unsigned int xout=0; xout<output_scanline.GetWidth(); xout++)
        {
                WideKernelUnit r=0,g=0,b=0,a=0;
                uint32_t kernel_offset = ((source_xpos >> (16-KernelShift)) & (KernelShiftSize-1)) * KernelWidth;
                Pixel32 const *srcpixels = inpixels + (source_xpos >> 16);
                for(unsigned int k=0; k<KernelWidth; k++)
                {
                        KernelUnit kmul = kernel[kernel_offset+k];
                        if (kmul!=0)
                        {
                                r+=kmul * static_cast<KernelUnit>(srcpixels->GetR());
                                g+=kmul * static_cast<KernelUnit>(srcpixels->GetG());
                                b+=kmul * static_cast<KernelUnit>(srcpixels->GetB());
                                a+=kmul * static_cast<KernelUnit>(srcpixels->GetA());
                        }
                        srcpixels++;
                }
                output_scanline.Pixel(xout).SetRGBA(ColorValue(r),ColorValue(g),ColorValue(b),ColorValue(a));
                source_xpos += xstep;
        }
}

#endif
