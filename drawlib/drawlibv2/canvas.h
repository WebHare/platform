#ifndef canvas_h
#define canvas_h

#include <blex/blexlib.h>
#include "drawlib_v2_types.h"
#include "bitmap.h"

//undo win32 #define intrusions...
#undef DIFFERENCE

namespace DrawLib
{

/** Canvas32 - an extended DrawLib::Bitmap32 that does alphablending and pixeloperations too */

class BLEXLIB_PUBLIC Canvas32
{
        public:

        /** PixelOperationMode - sets the way new pixels are drawn over the old pixels.
          *  - DEFAULT = new pixels are draw straight over old pixels, there is no interaction.
          *  - AND     = new pixels are bitwise ANDded with the old pixels.
          *  - OR      = new pixels are bitwise ORed with the old pixels.
          *  - XOR     = new pixels are bitwise XORed with the old pixels.
        */
        enum PixelOperationMode {DEFAULT = 0, AND, OR, XOR, NOP};

        /** AlphaOperationMode - (alpha) blend mode
          *  - BLEND255   = weighted average between new and old pixels. The new alpha is set to 255.
          *  - COPYALPHA  = the new alpha is set to whatever the source's value is. the color is ignored.
          *  - COPYALL    = copies the pixels
          *  - MINALPHA  = the new alpha is set to the minimum of source and destination alpha. the color is ignored.
          *  - MAXALPHA  = the new alpha is set to the maximum of source and destination alpha. the color is ignored.
          *  - LINEARBURN = BLEND255 of linear burn
          *
          *  - DIFFERENCEALL = Calculate the difference of all channels, including alpha. Identical images would render to 0,0,0,0
        */
        enum AlphaOperationMode {BLEND255 = 0, COPYALPHA, COPYALL, MINALPHA, MAXALPHA, LINEARBURN, CUTOUTALPHA
                                ,COLORBURN, COLORDODGE, DARKEN, DIFFERENCE, EXCLUSION
                                ,HARDLIGHT, LIGHTEN, LINEARDODGE, MULTIPLY, OVERLAY, SCREEN, DIFFERENCEALL
                                };

        /** Make a canvas by specifying a bitmap instance. It will throw an exception if
            the bitmap pointer is NULL! */
        explicit Canvas32(Bitmap32 *bitmap);

        /** Destructor */
        ~Canvas32();

        /** Exchange the bitmap32 in the Canvas32 with a new one
            @oaram  newbitmap - the new bitmap to be used.
            @return returns the original pointer in Canvas32 (so the user can delete it!) */
        Bitmap32* Exchange(Bitmap32 *newbitmap);

        /**     Writes a scanline to the bitmap. In the scanline there is an AlterationMask.
                The alterationmask is an optional parameters with a mask specifying which pixels
                are to be written. A value of '0' signifies that the corresponding pixel should
                not be written! A value greater than '0' signifies that a pixel should be written
                to the bitmap.*/

        void SetScanline32(uint32_t line, const Scanline32 *scanline);

        Scanline32 GetScanline32(uint32_t line) const;

        /** SetAlphaMode - Set the way the alpha layer is affected by drawing commands (see DrawLib::AlphaOperationMode) */
        void SetAlphaMode (AlphaOperationMode mode);

        /** GetAlphaMode - Get the current alpha operation mode */
        AlphaOperationMode GetAlphaMode() const;

        /** SetBinaryMode - Set the way new pixels are drawn over old pixels (see DrawLib::PixelOperationMode) */
        void SetBinaryMode(PixelOperationMode mode);

        /** GetBinaryMode - Get the current binary mode */
        PixelOperationMode GetBinaryMode() const;

        /** GetWidth() - Get the width of the canvas in pixels. */
        uint32_t    GetWidth() const {return bitmap->GetWidth();}

        /** GetHeight() - Get the height of the canvas in pixels. */
        uint32_t    GetHeight() const {return bitmap->GetHeight();}

        Bitmap32 *private_GetMyBitmap() { return bitmap; } //FIXME dangerous

        private:
        // not implement
        Canvas32(const Canvas32 &T);
        Canvas32& operator=(const Canvas32 &T);

        typedef void (*ScanlineOperator)(Scanline32 *scanline, const Scanline32 &old_scanline);

        ScanlineOperator GetScanlineOp(PixelOperationMode pixelop, AlphaOperationMode alphaop);

        ScanlineOperator scanline_op;
        Bitmap32 *bitmap;
        Scanline32 scratch;

        AlphaOperationMode      alpha_operation_state;  // only for *get* functions!!!
        PixelOperationMode      pixel_operation_state; // only for *get* functions!!!
};

} //end namespace DrawLib

#endif
