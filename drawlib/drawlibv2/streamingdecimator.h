#ifndef streamingdecimator_h
#define streamingdecimator_h

#include "bitmapiofilters.h"
#include "scanline.h"

namespace DrawLib
{

/** A bitmap horizontal decimator implemented as a streaming filter.
*/
class XDecimationFilter : public BitmapIOFilter
{
public:
        /**
          Create a horizontal decimation filter that decimates the input bit map by an integer factor.
          @param _source a pointer to a BitmapIOFilter that is used as a bitmap source.
          @param decimation_factor an integer decimation factor > 0.
          If the input bitmap is too small for the specified decimation_factor, it throws an exception.
        */
        XDecimationFilter(BitmapIOFilter *_source, uint32_t decimation_factor);
        ~XDecimationFilter();

        /** GetScanline32 - fill a user supplied scanline with pixels.
            This method will fail if the number of pixels in output_scanline
            is not equal to the 'newwidth' variable supplied in the constructor of ResizeFilter.*/
        virtual void GetScanline32(Scanline32& output_scanline);

        /** GetWidth - get the width of the output bitmap */
        virtual uint32_t GetWidth() const;

        /** GetHeight - get the height of the output bitmap */
        virtual uint32_t GetHeight() const;

private:
        std::unique_ptr<Scanline32> tempscanline;

        BitmapIOFilter *source;

        uint32_t outwidth;
        uint32_t outheight;
        uint32_t start_cols;
        uint32_t end_cols;
        uint32_t fast_cols;
        uint32_t decimation_fac;
};


/** A bitmap vertical decimator implemented as a streaming filter.
*/
class YDecimationFilter : public BitmapIOFilter
{
public:
        /**
          Create a vertical decimation filter that decimates the input bit map by an integer factor.
          @param _source a pointer to a BitmapIOFilter that is used as a bitmap source.
          @param decimation_factor an integer decimation factor > 0.
          If the input bitmap is too small for the specified decimation_factor, it throws an exception.
        */
        YDecimationFilter(BitmapIOFilter *_source, uint32_t decimation_factor);
        ~YDecimationFilter();

        /** GetScanline32 - fill a user supplied scanline with pixels.
            This method will fail if the number of pixels in output_scanline
            is not equal to the 'newwidth' variable supplied in the constructor of ResizeFilter.*/
        virtual void GetScanline32(Scanline32& output_scanline);

        /** GetWidth - get the width of the output bitmap */
        virtual uint32_t GetWidth() const;

        /** GetHeight - get the height of the output bitmap */
        virtual uint32_t GetHeight() const;

private:
        void ZeroAccu();
        void AccuInputLine();
        void Write(Scanline32 &output, int d);

        std::vector<uint32_t> accu_rgba;
        std::unique_ptr<Scanline32> tempscanline;

        BitmapIOFilter *source;

        uint32_t outwidth;
        uint32_t outheight;
        uint32_t start_rows;
        uint32_t end_rows;
        uint32_t fast_rows;
        uint32_t decimation_fac;
        uint32_t output_row_count;
};

}

#endif // Sentry..
