#ifndef blex_drawlib_bitmap
#define blex_drawlib_bitmap

#include <algorithm> //for swap()
#include <blex/blexlib.h>
#include "drawlib_v2_types.h"
#include "scanline.h"
#include "region.h"

namespace DrawLib
{

class Scanline32;

/** Bitmap32 - a container for 32bit RGBA bitmaps */
class BLEXLIB_PUBLIC Bitmap32
{
        private:
        pixman_image_t *img;
        //std::vector<Scanline32> scanlines;
        unsigned width;
        unsigned height;

        Pixel32 const * GetRawPixels(int scanline) const
        {
                return reinterpret_cast<DrawLib::Pixel32*>(pixman_image_get_data(img) + pixman_image_get_stride(img)/4 * scanline);
        }  //divide by 4, we're adding to a uint32_t!
        Pixel32* GetRawPixels(int scanline)
        {
                return const_cast<Pixel32*>(const_cast<Bitmap32 const*>(this)->GetRawPixels(scanline));
        }  //divide by 4, we're adding to a uint32_t!

        public:
        pixman_image_t *private_getimage() const { return img; } //Don't actually use this outside drawlib, we still need to hide it properly

        /**     Create an empty bitmap of size width*height
                @param width    The width
                @param height   The height
        */
        Bitmap32(unsigned width, unsigned height, DrawLib::Pixel32 bgcolor = DrawLib::Pixel32(0,0,0,0) );

        /** Copy a bitmap */
        Bitmap32(Bitmap32 const &src);

        /** Destroy bitmap */
        virtual ~Bitmap32();

        /** Get reference to a scanline.
            @param line The scanline to get a reference to */
        virtual Scanline32       GetScanline32(unsigned line) const;

        /**     Replaces the existing scanline. Make sure the width is equal to the bitmapwidth
                and the number of the line is a value of 0..bitmapheight-

                @param line            The scanline number to replac

                @param scanline        The new scanline

        */
        void SetScanline32(unsigned line, Scanline32 const &scanline);

        virtual void SetPixelsWithMask(unsigned line, Pixel32 const *sourcepixels, Blex::ConstBitmap mask);

        /** Get the width of the bitmap in pixels */
        unsigned GetWidth() const {return width;}

        /** Get the height of the bitmap in pixels */

        unsigned GetHeight() const {return height;}

        IRect GetPaintedRectangle() const;
};


class BLEXLIB_PUBLIC ProtectedBitmap32 : public Bitmap32
{
        public:
        /** Construct a protecting bitmap on top of an existing bitmap.
            @param basebitmap Actual bitmap to paint on (parent must guarantee that its kept alive as long as this ProtectedBitmap lives)
        */
        ProtectedBitmap32(Bitmap32 &basebitmap);
        ~ProtectedBitmap32();

        /**     Protects an area of the bitmap. A protected area cannot be written to
                @param area     The area to be protected.
        */
        void    ProtectArea   (IRect area);

        /**     UnProtects an area of the bitmap. A unprotected area can be written t

                @param area     The area to be set to unprotected.
        */
        void    UnProtectArea (IRect area);

        /**     Protects the whole bitmap. A protected area cannot be written t

        */
        void    ProtectBitmap   ();

        /**     UnProtects the whole bitmap. A unprotected area can be written to

        */
        void    UnProtectBitmap ();

        /**     Sets the protection of the bitmap to the protection region.
        */
        void    SetAreaProtection(const Region &r);
        Scanline32 GetScanline32(unsigned line) const;
        void SetPixelsWithMask(unsigned line, Pixel32 const *sourcepixels, Blex::ConstBitmap mask);

        private:
        /// Our parent bitmap
        Bitmap32 &basebitmap;
        /// The region indicating our protected area
        Region region;
        /// Our scratchpad
        std::unique_ptr<Blex::BitmapType[]> scratchpad;
};


/** Scanline32 is a container class for a complete RGBA scanline.
    A scanline may have an alteration mask that has information about which
    pixels are to be written back into a Bitmap32. When there is no alteration mask,
    all the pixels in the scanline are written to the Bitmap32.

    This class is nothing without Drawlib::Bitmap32, which is a collection of scanlines.
    Scanline32, unlike Pixel32, is not a POD - you cannot memcpy() this class.
*/

class BLEXLIB_PUBLIC Scanline32
{
        unsigned width;
        Pixel32 *pixels;
        Blex::Bitmap mask;
        //used to port us to pixman
        pixman_image_t * const img;
        unsigned const linenum;

        Scanline32(pixman_image_t *img, unsigned linenum, unsigned width);

        friend class Bitmap32;

        public:
        /** Constructors */
        Scanline32(unsigned width, bool draw, DrawLib::Pixel32 bgcolor = DrawLib::Pixel32(0,0,0,0));

        /** Copy constructor */
        Scanline32(Scanline32 const &src);

        /** Assignment operator */
        Scanline32& operator=(Scanline32 const &src);

        /** Destructors */
        ~Scanline32(); // don't inline!

        /** Get the raw pixel array of a scanline */
        Pixel32* GetRawPixels()              { return img ? reinterpret_cast<DrawLib::Pixel32*>(pixman_image_get_data(img) + pixman_image_get_stride(img)/4 * linenum) : pixels; }  //divide by 4, we're adding to a uint32_t!
        Pixel32 const * GetRawPixels() const { return img ? reinterpret_cast<DrawLib::Pixel32*>(pixman_image_get_data(img) + pixman_image_get_stride(img)/4 * linenum) : pixels; }

        /** Get the raw mask array of a scanline */
        Blex::Bitmap GetRawMask() { return mask; }
        Blex::ConstBitmap GetRawMask() const { return mask; }

        /** Get a single pixel
            @param x X coordinate of pixel to take (range 0 .. width). This
                   parameter is not range-checked! */
        Pixel32& Pixel(unsigned x) { return GetRawPixels()[x]; }
        Pixel32 Pixel(unsigned x) const { return GetRawPixels()[x]; }

        /** Get a single mask byte            @param x X coordinate of pixel to take (range 0 .. width). This
                   parameter is not range-checked! */
        void SetMask(unsigned x, bool value) { Blex::SetBit(mask, x, value); }
        bool GetMask(unsigned x) const { return Blex::GetBit(mask, x); }

        /** GetWidth - get the width of the bitmap in pixels */        unsigned GetWidth() const
        { return width; }

        /** ExportScanline writes the pixel32 databytes to a uint8_t databuffer
        */
        void ExportScanline(uint8_t * rawdata) const;

        /** ImportScanline copies the databytes from a uint8_t databuffer
            to the internal Pixel32 databuffer.
        */
        void ImportScanline(uint8_t const * rawdata);
        /** Copy copies pixels & mask from the source scanline into this scanline.            @param dest_offset - destination pixel offset to start the copy.            @param src_length  - the number of pixels from the source to copy.            Note that the scanline's size will never change. Pixels that won't fit will simple be skipped.        */
        void CopyWithOffset(unsigned dest_offset, unsigned src_length, Scanline32 const &src);
        void Swap(Scanline32 &rhs)
        {
                std::swap(width,rhs.width);
                std::swap(pixels,rhs.pixels);
                std::swap(mask,rhs.mask);
        }
        /** Convert scanline to floats, 4 floats per pixel, r,g,b,a memory layout */
        void ConvertToFloat(float *outfloats) const;
};

} //end namespace Drawlib

namespace std
{
//specialise swap for scanlines
template<>
  inline void swap<DrawLib::Scanline32>(DrawLib::Scanline32 &lhs, DrawLib::Scanline32 &rhs)
{
        lhs.Swap(rhs);
}
} //end namespace std

#endif
