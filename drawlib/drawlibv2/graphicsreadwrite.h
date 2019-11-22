#ifndef blex_drawlib_graphicsreadwrite
#define blex_drawlib_graphicsreadwrite

#ifndef blex_drawlib_bitmap
#include "bitmap.h"
#endif
#include "bitmapiofilters.h"
#include "octree.h"

namespace DrawLib
{

/** GraphicsReader is a baseclass that handles reading graphics files from a stream.
*/

class GraphicsReader : public BitmapIOFilter
{
public:
        GraphicsReader();
        virtual ~GraphicsReader() = 0;

        /** Read a scanline from the file. The scanline must be the correct length for this to work.*/
        virtual void GetScanline32(Scanline32& output_scanline) = 0;

        /** LinesLeft checks if there are lines left to be read. Used only in combination with CopyBitmapLine. */
        bool virtual LinesLeft() const = 0;

        /** Get the width of the currently loaded graphics file (in pixels). This is valid from the moment of construction.*/
        uint32_t  virtual GetWidth() const = 0;

        /** Get the height of the currently loaded graphics file (in pixels). This is valid from the moment of construction.*/
        uint32_t  virtual GetHeight() const = 0;
};

/** PNG_GraphicsReader is a class that reads a JPG file from a stream. see GraphicsIO for further details.*/

class BLEXLIB_PUBLIC PNG_GraphicsReader : public GraphicsReader
{
public:
        typedef std::function< void(const char*, const void*, unsigned) > ChunkCallback;

        /* PNG_GraphicsReader - a PNG reader object.
           @param stream - a pointer to an open Blex::Stream based stream.
           @param callback - a callback function for unknown PNG chuncks
           Note: if a callback is not required just use PNG_GraphicsReader::ChunkCallback.
        */
        PNG_GraphicsReader(Blex::Stream *stream, ChunkCallback const &callback);
        ~PNG_GraphicsReader();

        /* GetScanline32 - fill a scanline32 object with a scanline from the PNG
           @param output_scanline - a reference to a Scanline32 object.
           Note: the output_scanline'w width must match the PNGs width!
        */
        virtual void GetScanline32(Scanline32& output_scanline);

        /* LinesLeft - check is there are any PNG scanlines left to read.. */
        bool LinesLeft() const;

        /* SkipImageData() - skip the image data in the PNG and process to the end of the file,
           this function will still call the "unknown chunk" user callback.
        */
        void SkipImageData();

        virtual uint32_t  GetWidth() const;
        virtual uint32_t  GetHeight() const;

        ChunkCallback mycallback;
private:
        struct Data;

        /** Internal data - protect our callers from being required to include
            or install the jpeg libs themselves */
        Data* data;


        //prevent copying
        PNG_GraphicsReader(const PNG_GraphicsReader&);
        PNG_GraphicsReader& operator =(const PNG_GraphicsReader&);
};

/** DIB_GraphicsReader is a class that reads a DIB file from a stream */
class BLEXLIB_PUBLIC DIB_GraphicsReader : public GraphicsReader
{
public:
        DIB_GraphicsReader(Blex::RandomStream *_stream, bool has_palette);
        ~DIB_GraphicsReader();

        virtual void GetScanline32(Scanline32& output_scanline);
        bool LinesLeft() const;

        virtual uint32_t GetWidth() const;
        virtual uint32_t GetHeight() const;
        bool IsUpsideDown() const;

private:
        // palette will contain RGBA items if there is a palette
        std::vector<Pixel32> palette;

        Blex::RandomStream *stream;

        DIB_GraphicsReader(const DIB_GraphicsReader&);
        DIB_GraphicsReader& operator =(const DIB_GraphicsReader&);

        void ReadBitmap();
        void ProcessHeader(bool has_palette);
        void DecompressData();

        // DIB properties...
        int32_t height;
        int32_t width;
        uint32_t headerlength;
        uint32_t compression;
        uint16_t bitcount;
        uint32_t colorsused;
        uint32_t impcolors;
        int32_t lines;
        bool bottomup;
        bool supported;

        ///The red, green and blue masks and shifts for the evil BI_BITFIELDS (3) compression
        bool use_mask_shift;
        uint32_t redmask, greenmask, bluemask, alphamask;
        uint32_t redshift, greenshift, blueshift, alphashift;

        //Internal variables and constants.
        Blex::FileOffset start_scanlines;
        std::vector<uint8_t> pixelbuffer;
        uint32_t bytes_per_scanline;
};

/** Bitmap32_GraphicsReader is a class offering a DrawLib::Bitmap32 as a stream */
class Bitmap32_GraphicsReader : public GraphicsReader
{
public:
        /** Instantiate a graphics reader
            @param bitmap The bitmap to use as a source (the caller must keep this bitmap alive)
        */
        Bitmap32_GraphicsReader(DrawLib::Bitmap32 const &bitmap);
        ~Bitmap32_GraphicsReader();

        void GetScanline32(Scanline32& output_scanline);
        bool LinesLeft() const;
        uint32_t GetWidth() const;
        uint32_t GetHeight() const;

private:
        DrawLib::Bitmap32 const &bitmap;
        uint32_t current_scanline;
};

/** An implementation of the Bitmap32_GraphicsReader that keeps a copy of
    the bitmap to stream - ugly workaround for the broken GIF reader */
class Bitmap32Owning_GraphicsReader : public Bitmap32_GraphicsReader
{
public:
        Bitmap32Owning_GraphicsReader(DrawLib::Bitmap32 const &bitmap);
        ~Bitmap32Owning_GraphicsReader();
private:
        DrawLib::Bitmap32 bitmap_copy;
};


/*******************************************************************************

*******************************************************************************/

/** GraphicsWriter is a baseclass that handles writing graphics files from a stream. */
class GraphicsWriter
{
public:
        GraphicsWriter() {};
        virtual ~GraphicsWriter() = 0;

        /** Encode a complete bitmap and write it to the output stream
            This method can't be used with WriteLine!! */
        void virtual WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap) = 0;

        GraphicsWriter(GraphicsWriter const &) = delete;
        GraphicsWriter& operator=(GraphicsWriter const &) = delete;

};

class HTMLTABLE_GraphicsWriter : public GraphicsWriter
{
public:
        HTMLTABLE_GraphicsWriter();
        virtual ~HTMLTABLE_GraphicsWriter();

        void WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap);

private:
        bool compressed;
};

class WBMP_GraphicsWriter : public GraphicsWriter
{
public:
        WBMP_GraphicsWriter();
        virtual ~WBMP_GraphicsWriter();

        void WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap);

private:
        void WriteHeader();
        bool compressed;
};

/** Write a PNG to a BLEX stream, paletted or non-paletted, transparent or non-transparent. */
class PNG_GraphicsWriter : public GraphicsWriter
{
public:
        /** Constructor
        @param alpha a boolean indicating the presence of an alpha channel */
        PNG_GraphicsWriter(bool _alpha);
        virtual ~PNG_GraphicsWriter();

        /** write a bitmap to a stream!
        @param stream an open stream ready for writing.
        @param bitmap the bitmap to write to the stream.
        */
        void WriteBitmap(Blex::Stream &stream, const Bitmap32 &bitmap);

        /** write a bitmap with a palette attached to it to a stream!
        @param stream an open stream ready for writing.
        @param bitmap the bitmap to write to the stream.
        */
        void WritePalettedBitmap(Blex::Stream &stream, const Bitmap32 &bitmap);


        /** write a bitmap with a palette attached to it to a stream!
        @param stream an open stream ready for writing.
        @param bitmap the bitmap to write to the stream.
        @param my_octree a reference to an octree that hold palette information.
        The octree is reduced to hold 256 color! therefore, it can't be const!
        */
        void WritePalettedBitmap(Blex::Stream &stream, const Bitmap32 &bitmap, Octree & my_octree);

private:
        void WriteLine(const Scanline32 *scanline);
        std::vector<uint8_t> scanlinedata;
        struct Data;
        /** Internal data - protect our callers from being required to include
            or install the jpeg libs themselves */
        Data* data;
        bool alpha;     // == true if the bitmap has an alpha channel!
};

uint32_t BLEXLIB_PUBLIC FillOctreeAndCountAlpha(Bitmap32 const & bitmap, Octree & my_octree, uint8_t minimum_alpha);

}
#endif
