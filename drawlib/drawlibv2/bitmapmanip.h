#ifndef bitmapmanip_h
#define bitmapmanip_h

#include "drawlib_v2_types.h"
#include "bitmap.h"

namespace DrawLib
{
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

        /** MakeBitmapGreyscale - converts a bitmap to greyscale.
            @param bitmap - a pointer to the source bitmap (color)
            @param mul_fac - greyscale color multiplier (default = 1.0)
        */
        BLEXLIB_PUBLIC void MakeBitmapGreyscale(Bitmap32  *bitmap, double mul_fac = 1.0);

        BLEXLIB_PUBLIC void MultiplyBitmap(Bitmap32 *bitmap, Bitmap32 &mult_bitmap);

        /** Blur a bitmap.. */
        BLEXLIB_PUBLIC void Blur(Bitmap32 *bitmap, unsigned xsize, unsigned ysize);

        /** Create a rotade bitmap */
        BLEXLIB_PUBLIC Bitmap32* CreateRotatedBitmap(const Bitmap32 &bitmap, bool rotate_right);

        /** Create a horizontally mirrored bitmap */
        BLEXLIB_PUBLIC Bitmap32* CreateMirroredBitmap(const Bitmap32 &bitmap);

        /** Compare two bitmaps and calculate the mean-square-error.
                @param[in] bitmap1 a const reference to a bitmap
                @param[in] bitmap2 a const reference to a second bitmap.
                @param[in] ignore_alpha when 'true' the alpha value of each pixel is ignored.
                @return the mean square error (per-pixel), if an error occured it returns < 0.0
        */
        BLEXLIB_PUBLIC double MeanSquareError(const DrawLib::Bitmap32  &bitmap1, const DrawLib::Bitmap32  &bitmap2, bool ignore_alpha, bool log_coordinates);
}

#endif
