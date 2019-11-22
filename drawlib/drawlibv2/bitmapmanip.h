#ifndef bitmapmanip_h
#define bitmapmanip_h

#include "drawlib_v2_types.h"
#include "bitmap.h"

namespace DrawLib
{
        typedef std::map<uint32_t, uint32_t> ColorMapping;

        /** CreateCroppedBitmap - cut a part from a sourcebitmap. A new bitmap is created.
        @param sourcebitmap - a reference to the source bitmap to crop.
        @param rect - the rectangle to crop.
        @return returns a pointer to a new Bitmap32 structure. This fails when the rectangle is not
        completely within the source bitmap, then it returns NULL */
        BLEXLIB_PUBLIC Bitmap32 * CreateCroppedBitmap(const Bitmap32 &sourcebitmap, const IRect &rectangle);

        /** CreateResizedBitmap - create a resized bitmap from a sourcebitmap
        @return returns a pointer to a new Bitmap32 structure. This fails when the rectangle is not
        completely within the source bitmap, then it returns NULL */
        BLEXLIB_PUBLIC Bitmap32 * CreateResizedBitmap(const Bitmap32 &sourcebitmap, const ISize &newsize);

        /** CreateDecimatedBitmap - create a smaller decimated bitmap from a source bitmap.
            the decimation factor are integer only! To resize more precisely, use CreateResizedBitmap!
            This is a special purpose function to quickly reduce the size of a bitmap.
            Usefull for obtaining small thumbnails of very large pictures. */
        Bitmap32 * CreateDecimatedBitmap(const Bitmap32  &sourcebitmap, uint32_t xdecimation, uint32_t ydecimation);

        /** DifferenceBitmap - create a bitmap containing absolute differcens betweeen 2 bitmaps
        @return returns a pointer to a new Bitmap32 structure. This fails when the bitmaps differ in size,
        it then returns NULL*/
        BLEXLIB_PUBLIC Bitmap32 * DifferenceBitmap(const Bitmap32  &bitmap1, const Bitmap32  &bitmap2, bool setalpha255);

        /** RedAlphaBitmap - create a bitmap with all alpha values translated to red */
        BLEXLIB_PUBLIC Bitmap32 * RedAlphaBitmap(const Bitmap32 &bitmap1);

        /** CreateGreyscaleBitmap - create a greyscale version of a bitmap.
            @param bitmap - a reference to the source bitmap (color)
            @param mul_fac - greyscale color multiplier (default = 1.0)
            @returns a pointer to a newly created greyscale bitmap
        */
        Bitmap32 * CreateGreyscaleBitmap(const Bitmap32  &bitmap, double mul_fac = 1.0);

        /** MakeBitmapGreyscale - converts a bitmap to greyscale.
            @param bitmap - a pointer to the source bitmap (color)
            @param mul_fac - greyscale color multiplier (default = 1.0)
        */
        BLEXLIB_PUBLIC void MakeBitmapGreyscale(Bitmap32  *bitmap, double mul_fac = 1.0);

        BLEXLIB_PUBLIC void MultiplyAlphaChannel(Bitmap32  *bitmap, double mul_fac);
        BLEXLIB_PUBLIC void AddAlphaChannel(Bitmap32  *bitmap, int toadd);

        BLEXLIB_PUBLIC void InvertBitmap(Bitmap32 *bitmap);

        Bitmap32* CreateInvertedBitmap(const Bitmap32 &bitmap);

        BLEXLIB_PUBLIC void MultiplyBitmap(Bitmap32 *bitmap, Bitmap32 &mult_bitmap);

        Bitmap32* CreateMultipliedBitmap(const Bitmap32 &bitmap, Bitmap32 &mult_bitmap);

        /** CreateEmbossedBitmap - create an embossed version of a bitmap.
           @param bitmap - a reference to the source bitmap
           @returns a pointer to a newly created embossed bitmap
        */

        Bitmap32 * CreateEmbossedBitmap(const Bitmap32  &bitmap);

        /** CreateMultiplyAndAddBitmap - create a new bitmap by multiplying all the color channels by a constant
            and adding a second constant. This can be used for contrast/brightness controls */
        Bitmap32 * CreateMultiplyAndAddBitmap(const Bitmap32  &bitmap, double mul_fac, double adder);

        /** CreateScaledAlphaBitmap - create a new bitmap by multiplying (scaling) the alpha channel.*/
        Bitmap32 * CreateScaledAlphaBitmap(const Bitmap32  &bitmap, double mul_fac);

        /** Blur a bitmap.. */
        BLEXLIB_PUBLIC void Blur(Bitmap32 *bitmap, unsigned xsize, unsigned ysize);

        /** Create a rotade bitmap */
        BLEXLIB_PUBLIC Bitmap32* CreateRotatedBitmap(const Bitmap32 &bitmap, bool rotate_right);

        /** Create a horizontally mirrored bitmap */
        BLEXLIB_PUBLIC Bitmap32* CreateMirroredBitmap(const Bitmap32 &bitmap);

        /** Create a sheared bitmap */
        BLEXLIB_PUBLIC Bitmap32* CreateShearedBitmap(const Bitmap32 &bitmap, double scale);

        /** Compare two bitmaps and calculate the mean-square-error.
                @param[in] bitmap1 a const reference to a bitmap
                @param[in] bitmap2 a const reference to a second bitmap.
                @param[in] ignore_alpha when 'true' the alpha value of each pixel is ignored.
                @return the mean square error (per-pixel), if an error occured it returns < 0.0
        */
        BLEXLIB_PUBLIC double MeanSquareError(const DrawLib::Bitmap32  &bitmap1, const DrawLib::Bitmap32  &bitmap2, bool ignore_alpha, bool log_coordinates);

        BLEXLIB_PUBLIC void ApplyColorMapping(Bitmap32 *bitmap, ColorMapping &colormap);
}

#endif
