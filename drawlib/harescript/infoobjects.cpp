#include <drawlib/drawlibv2/allincludes.h>
#include <blex/logfile.h>


#include "infoobjects.h"
#include <drawlib/drawlibv2/bitmapmanip.h>

//#define DEBUGCANVASCOUNT

namespace DrawLibInterface_v2
{


Blex::Mutex drawinfo_refcount_mutex;

#ifdef DEBUGCANVASCOUNT
unsigned canvascount=0;
#endif

/*******************************************************************************
*
*  DRAWINFO
*
*******************************************************************************/

DrawInfo::DrawInfo(std::unique_ptr<DrawLib::Bitmap32> &to_adopt)
: bitmap(std::move(to_adopt))
, canvas(new DrawLib::Canvas32(bitmap.get()))
, drawobj(new DrawLib::DrawObject(canvas.get()))
, refcount(0)
{
#ifdef DEBUGCANVASCOUNT
        Blex::Mutex::AutoLock lock(drawinfo_refcount_mutex);
        ++canvascount;
        Blex::ErrStream() << "Creating drawinfo " << (void*)this << ", now at " << canvascount << " canvasses";
#endif
}
void DrawInfo::AddRef() const
{
        {
                Blex::Mutex::AutoLock lock(drawinfo_refcount_mutex);
                ++refcount;
#ifdef DEBUGCANVASCOUNT
                Blex::ErrStream() << "Drawinfo " << (void*)this << " upped refcount from " << (refcount-1) << " to " << refcount;
#endif
        }

}
void DrawInfo::DelRef() const
{
        unsigned finalrefcount;

        {
                Blex::Mutex::AutoLock lock(drawinfo_refcount_mutex);
#ifdef DEBUGCANVASCOUNT
                Blex::ErrStream() << "Drawinfo " << (void*)this << " downing refcount from " << refcount << " to " << (refcount-1);
#endif
                finalrefcount = --refcount;
        }
        if(finalrefcount == 0)
              delete this;
}

void DrawInfo::AdoptNewBitmap(DrawLib::Bitmap32 *bmi)
{
        canvas->Exchange(bmi);
        bitmap.reset(bmi);
}

/*
DrawInfo::DrawInfo(uint32_t width, uint32_t height, DrawLib::Pixel32 bgcolor)
        :bitmap (new DrawLib::Bitmap32(width, height, bgcolor))
        ,canvas (new DrawLib::Canvas32(bitmap.get()))
{
}



/ ** The function may ONLY be used when creating a new drawinfo from an old one. This is
    done in CreateDrawObjectFromDrawObject
DrawInfo::DrawInfo(const DrawLib::Bitmap32  & sourcebitmap, uint32_t left, uint32_t top, uint32_t right, uint32_t bottom)
      :bitmap(DrawLib::CreateCroppedBitmap(sourcebitmap, DrawLib::IRect(left,top,right,bottom) ))
      ,canvas(new DrawLib::Canvas32(bitmap.get()))
      ,drawobj(new DrawLib::DrawObject(canvas.get()))
{
}

//Create drawinfo when reading from a file
DrawInfo::DrawInfo(std::unique_ptr<DrawLib::Bitmap32 > & _bitmap)
        :bitmap  (_bitmap)
        ,canvas  (new DrawLib::Canvas32(bitmap.get()))
        ,drawobj (new DrawLib::DrawObject(canvas.get()))
{
}
*/
DrawInfo::~DrawInfo()
{
#ifdef DEBUGCANVASCOUNT
        Blex::Mutex::AutoLock lock(drawinfo_refcount_mutex);
        --canvascount;
        Blex::ErrStream() << "Destroying drawinfo " << (void*)this << ", now at " << canvascount << " canvasses";
#endif
}

/*******************************************************************************
*
*  FONTINFO
*
*******************************************************************************/


FontInfo::FontInfo(std::string const &fontname, std::string const &fontstyle)
{
        DrawLib::Font *tempf = DrawLib::GetGlobalFontManager().CreateFontFromFile(fontname, fontstyle);
        font.reset(tempf);
        baseline_angle = 0.0;
        glyph_angle    = 0.0;
        horizontal_alignment = DrawLib::TextRenderer::LEFT;
        vertical_alignment   = DrawLib::TextRenderer::BASELINE;
        rendermode           = 1;
        letterspacing = 0.0;
}

FontInfo::~FontInfo()
{
}

} //namespace end
