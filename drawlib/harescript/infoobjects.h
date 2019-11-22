#ifndef drawlib_drawlibv2_infoobjects_h
#define drawlib_drawlibv2_infoobjects_h

#include <drawlib/drawlibv2/bitmap.h>
#include <drawlib/drawlibv2/canvas.h>
#include <drawlib/drawlibv2/drawobject.h>
#include <drawlib/drawlibv2/textrenderer.h>

namespace DrawLibInterface_v2
{

extern Blex::Mutex drawinfo_refcount_mutex;

///drawinfo is (the root of all evil and) a wrapper for creating the bitmap, canvas and drawobject stuff..
class DrawInfo
{
        std::unique_ptr<DrawLib::Bitmap32 >   bitmap;
        std::unique_ptr<DrawLib::Canvas32>   canvas;
        std::unique_ptr<DrawLib::DrawObject> drawobj;


public:
        ///create empty drawinfo: empty bitmap+canvas+drawobject
//        DrawInfo(uint32_t width, uint32_t height, DrawLib::Pixel32 color);

        /**create cropped drawinfo: cropped bitmap+canvas+drawobject (so the source has to be given)
           only to be used when creating a NEW drawinfo.
          */
//        DrawInfo(const DrawLib::Bitmap32 & sourcebitmap, uint32_t left, uint32_t top, uint32_t right, uint32_t bottom);
//        DrawInfo(const DrawLib::Bitmap32 & sourcebitmap, uint32_t newwidth, uint32_t newheight)   ;
//        DrawInfo(Blex::Stream *stream);

        explicit DrawInfo(std::unique_ptr<DrawLib::Bitmap32> &to_adopt);
        ~DrawInfo();

        mutable unsigned refcount;

        DrawLib::Bitmap32 &GetBitmap() { return *bitmap;}
        DrawLib::Bitmap32 const &GetBitmap() const { return *bitmap;}
        DrawLib::Canvas32 &GetCanvas() { return *canvas;}
        DrawLib::Canvas32 const &GetCanvas() const { return *canvas;}
        DrawLib::DrawObject &GetDrawObject() { return *drawobj;}
        DrawLib::DrawObject const &GetDrawObject() const { return *drawobj;}

        void AdoptNewBitmap(DrawLib::Bitmap32 *bmi);

        void AddRef() const;
        void DelRef() const;
};

///fontinfo is a wrapper for font-handling
class FontInfo
{
public:
        FontInfo(std::string const &fontname, std::string const &fontstyle);

        ~FontInfo();

        std::unique_ptr<DrawLib::Font>  font;

        DrawLib::TextRenderer::HorizontalAlignment horizontal_alignment;
        DrawLib::TextRenderer::VerticalAlignment vertical_alignment;
        uint32_t rendermode           ;
        DrawLib::Pixel32 color            ;
        double baseline_angle     ;
        double glyph_angle        ;
        double letterspacing;
};

} //namespace ender

#endif
