#ifndef blex_drawlib_bitmapio
#define blex_drawlib_bitmapio

#include <blex/stream.h>
#ifndef blex_drawlib_bitmap
#include "bitmap.h"
#endif
#ifndef blex_drawlib_graphicsreadwrite
#include "graphicsreadwrite.h"
#endif

/** Drawlib namespace */

namespace DrawLib
{
        enum GfxFileType {GFX_UNKNOWN, GFX_PNG, GFX_JPG, GFX_GIF, GFX_BMP, GFX_TIFF, GFX_EMF };

        /** Save a DrawLib::Bitmap32 bitmap to a stream as a .TGA file. This is a debug format and
            will not save the alpha layer! This call will fail for bitmaps with height/width greater
            than 65535.
            @return true if there were no errors.
            */
        BLEXLIB_PUBLIC void SaveBitmap32AsTGA(Blex::Stream *stream, const Bitmap32  &bitmap);

        /** Save a DrawLib::Bitmap32 bitmap to a stream as a .JPG file. This format does not support
            alpha layers and they will therefore be discarded. The quality can be entered and can vary
            from 0 .. 100 ?
            @return true if there were no errors.
            */
        BLEXLIB_PUBLIC void SaveBitmap32AsJPG(Blex::Stream *stream, const Bitmap32 &bitmap, uint32_t quality);

        /** Save a DrawLib::Bitmap32 bitmap to a JPG-file on disk. This format does not support
            alpha layers and they will therefore be discarded.
            @return true if there were no errors.
            */
        BLEXLIB_PUBLIC void SaveBitmap32AsJPG(const std::string &filename, const Bitmap32 &bitmap, uint32_t quality);


        /** Save A DrawLib::Bitmap32 bitmap to a stream as a .PNG file. This format supports
            alpha layers and fully transparent colors. To use fully transparent colors, a palette
            must be built. A palette can have max. 256 colors. If the image has more than 256 colors,
            color reduction is performed using an octree algorithm.
            (See Heckbert(author) and Graphic Gems(book))

            When there is no alpha layer present in the image (that is, all pixels have alpha==255).
            The alpha layer is discared automatically, regardless of the discard_alpha parameter.

            BTW. Internet exporer doesn't (yet) support full alpha layers. Netscape>4.0 does.

            @param stream - a pointer to an open write-stream.
            @param bitmap - a reference to a bitmap containing the image to be written.
            @param paletted - if 'true' a paletted PNG is generated. This may reduce the colors in the image (see general explantion).
            @param discard_alpha - if 'true' the alpha layer is discarded.
            @return true if there were no errors.
            */

        BLEXLIB_PUBLIC void SaveBitmap32AsPNG(Blex::Stream *stream, const Bitmap32 &bitmap,
                bool paletted, bool discard_alpha);

        /** CreateBitmap32FromPNGWithCallback creates a Bitmap32 object that
            contains the PNG graphic, and allows to catch custom chunks
            @param stream - a pointer to an open read-stream.
            @return pointer to a Bitmap32 object, may return NULL on error!
            */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromPNGWithCallback(Blex::Stream *stream, PNG_GraphicsReader::ChunkCallback const &callback);

        /** CreateBitmap32FromPNG creates a Bitmap32 object that contains the PNG graphic
            @param stream - a pointer to an open read-stream.
            @return pointer to a Bitmap32 object, may return NULL on error!
            */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromPNG(Blex::Stream *stream);

        /** CreateBitmap32FromJPG creates a Bitmap32 object that contains the JPG graphic
            @param stream - a pointer to an open read-stream.
            @param decimation - reduce the size of the image by 1,2,4 or 8. (exception otherwise..)
            @return pointer to a Bitmap32 object, may return NULL on error!
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromJPG(Blex::Stream *stream, int decimation);


        /** CreateBitmap32FromBMP creates a Bitmap32 object that contains the graphic
            @param stream - a pointer to an open read-stream.
            @param fromfile True if this BMP is actually a BMP false (false for DIB without the BMP header)
            @param paletted True if this DIB is paletted (ignored if fromfile == true)
            @return pointer to a Bitmap32 object, may return NULL on error!
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromBMP(Blex::RandomStream *stream, bool fromfile, bool paletted);

        /** CreateBitmap32FromRaw creates a Bitmap32 object that contains the graphic
            @param stream - a pointer to an open read-stream.
            @return pointer to a Bitmap32 object, may return NULL on error!
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromRaw(Blex::Stream &stream, unsigned width, unsigned height, std::string const &format, bool premultiplied);

        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromEMF(Blex::RandomStream *stream);

        /** Save A DrawLib::Bitmap32 bitmap to a Raw-file on disk. This format supports
            alpha layers. It is stored as raw format.

            @param stream - an open write-stream.
            @param bitmap - a reference to a bitmap containing the image to be written.
            @return true if there were no errors.
            */
        BLEXLIB_PUBLIC void SaveBitmap32AsRaw(Blex::Stream &stream, const Bitmap32 &bitmap, std::string const &format);

        /** Reads a file of the TIFF format from an open stream and stores it in
            a Bitmap32 object.

            @param stream A pointer to an open stream. The buffering is handled by
            this function. It will not get closed/deleted by this function.
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromTIFF(Blex::RandomStream *stream);

        // Functions for the use of the GIF format:

        /** Reads a file of the GIF format from an open stream and stores it in
            a Bitmap32 object.

            @param stream A pointer to an open stream. The buffering is handled by
            this function. It will not get closed/deleted by this function.
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32FromGIF(Blex::Stream *stream);
        /** Saves a DrawLib::Bitmap32 bitmap to a stream in GIF format. This format only
            supports paletted colors and up to 256 different colors. The number of
            colors gets automatically reduced to at most 256 colors if necessary.

            @param stream An open write-stream. The buffering is handled by this function.
            It may NOT be NULL.
            @param bitmap A reference to a bitmap containing the image to be written. May
            NOT be null.
        */
        BLEXLIB_PUBLIC void SaveBitmap32AsGIF(Blex::Stream *stream, const Bitmap32 &bitmap);

        /** CreateBitmap32Magic creates a Bitmap32 object that contains the graphic
            @param stream - a pointer to an open read-stream.
            @return pointer to a Bitmap32 object, may return NULL on error!
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32Magic(Blex::RandomStream *_stream);

        /** CreateBitmap32Magic creates a Bitmap32 object that contains the graphic
            @param stream - a pointer to an open read-stream.
            @param width  - the desired width of the output bitmap.
            @param height - the desired height of the output bitmap.
            @return pointer to a Bitmap32 object, may return NULL on error!
        */
        BLEXLIB_PUBLIC Bitmap32* CreateBitmap32Magic(Blex::RandomStream *_stream, DrawLib::ISize outsize);

        /** Create a graphics reader by detecting the filetype of an image
            @param outwidth Requested output width, or 0 if unknown. The graphics reader may not actually render on this size, it is just a hint for initial decimation
            @param outheight Requested output height, or 0 if unknown. The graphics reader may not actually render on this size, it is just a hint for initial decimation
            @return graphicsreader for the stream, may return NULL on error. Caller must destroy this reader */
        GraphicsReader* GetDetectedGraphicsReader(Blex::RandomStream *stream, DrawLib::ISize outsize);

        /** Create a resized bitmap generated by a GraphicsReader
            @param reader Graphics reader to use
            @param outwidth Desired output width
            @param outheight Desired output height */
        BLEXLIB_PUBLIC Bitmap32* CreateResizedBitmapFromReader(GraphicsReader &reader, DrawLib::ISize outsize);


        /** Try to detect the file type of the stream
            @param stream The image file stream
            @return The filetype that was detected
          */
        GfxFileType DetectGfxFileType(Blex::RandomStream *stream);
}

#endif
