#ifndef streamingresizer_h
#define streamingresizer_h

#include "bitmapiofilters.h"
#include "scanline.h"

//#define RESIZER_SSE
#define IMUL_VERSION //ADDME: Did an attempt to create a FMUL version to do performance testing, but it doesn't work yet!

namespace DrawLib
{


/** ResizeFilter - a streaming type image resizer implemented as a filter.
    This filter allows source bitmaps to reside on disk because it can
    read directly from a graphics reader. End effect is that memory usage is
    reduced because the source bitmap is never loaded into memory completely.
*/

class BLEXLIB_PUBLIC ResizeFilter : public BitmapIOFilter
{
public:
#ifdef IMUL_VERSION
        typedef int16_t KernelUnit;         //(8.8 fixedpoint)
        typedef int32_t WideKernelUnit;
#else
        typedef double KernelUnit;
        typedef double WideKernelUnit;
#endif
        static const unsigned KernelWidth=8; //must be a multiple of 2
        static const unsigned KernelShift=5;
        static const unsigned KernelShiftSize=1<<KernelShift;
        static const unsigned KernelSize=KernelShiftSize*KernelWidth;

        /** ResizeFilter constructor
                @param _source - a pointer to a BitmapIOFilter source object (e.g. graphics reader)
                @param newwidth - the width of the output image
                @param newheight - the height of the output image
        */
        ResizeFilter(BitmapIOFilter *_source, uint32_t newwidth, uint32_t newheight);
        ~ResizeFilter();

        /** GetScanline32 - fill a user supplied scanline with pixels.
            This method will fail if the number of pixels in output_scanline
            is not equal to the 'newwidth' variable supplied in the constructor of ResizeFilter.*/
        virtual void GetScanline32(Scanline32& output_scanline);

        /** GetWidth - get the width of the output bitmap */
        virtual uint32_t GetWidth() const;
        /** GetHeight - get the height of the output bitmap */
        virtual uint32_t GetHeight() const;

        static void CalcKernel(ResizeFilter::KernelUnit *kernel, double dilation_factor);
        static void CalcFloatKernel(float *kernel, double dilation_factor);

        private:

        /** HorizontalResizer - a ResizeFilter helper object that resizes scanlines
        in the horizontal direction */
        class HorizontalResizer
        {
        public:
                HorizontalResizer(BitmapIOFilter *_source, uint32_t inwidth, uint32_t outwidth);
                ~HorizontalResizer();

                void GetScanline32(Scanline32 &output_scanline);

        private:
                BitmapIOFilter *mysource;
                Scanline32 inputscanline;
                Scanline32 extendedscanline;
                KernelUnit kernel[KernelSize];     // 32 shifted lanczos3 kernels.
                uint32_t        xstep;                  // 16.16 fixedpoint

                                // SSE data structures
                                std::vector<float> extendedscanline_sse;
                                #ifdef RESIZER_SSE
                                float      kernel_sse[KernelSize];
                                #endif
        };

        /** VerticalResizer - a ResizeFilter helper object that resizes scanlines
        in the vertical direction */
        class VerticalResizer
        {
        public:
                VerticalResizer(HorizontalResizer *_source, uint32_t inheight, uint32_t outheight, uint32_t outwidth);
                ~VerticalResizer();

                void GetScanline32(Scanline32 &output_scanline);

        private:
                HorizontalResizer *mysource;
                KernelUnit      kernel[KernelSize];   // 32 shifted lanczos3 kernels (8.8 fixedpoint).
                Scanline32      inputscanline;
                Scanline32      inbuffer;       // size = 8*inwidth!!
                uint32_t             ylinesleft;
                uint32_t             ystep;          // yposition advance 16.16
                uint32_t             ypos;
                uint32_t             ypos_last_update;
                uint32_t             inwidth;
                std::vector<WideKernelUnit> r;
                std::vector<WideKernelUnit> g;
                std::vector<WideKernelUnit> b;
                std::vector<WideKernelUnit> a;
        };

        //----------------------------------------------------------------------

        std::unique_ptr <HorizontalResizer>     hresizer;
        std::unique_ptr <VerticalResizer>       vresizer;
        uint32_t                     newwidth;
        uint32_t                     newheight;
        uint32_t                     outputlines_produced;
};

} // end namespace

#endif

