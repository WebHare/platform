#include <drawlib/drawlibv2/allincludes.h>



#include "wmf_gditypes.h"
#include <iostream>

namespace WmfLib
{

void fRECT::ReadEMF(uint8_t const *data)
{
        left   = Blex::gets32lsb(data);
        top    = Blex::gets32lsb(data+4);
        right  = Blex::gets32lsb(data+8);
        bottom = Blex::gets32lsb(data+12);
}
void fRECT::ReadWMF(uint8_t const *data)
{
        left   = Blex::gets16lsb(data);
        top    = Blex::gets16lsb(data+2);
        right  = Blex::gets16lsb(data+4);
        bottom = Blex::gets16lsb(data+6);
}

GDI_DCItem::GDI_DCItem()
: fontptr(NULL)
, window_extents(1,1)
, viewport_extents(1,1)
, stretch_mode(BlackOnWhite)
{
        mapmode = MM_Text;
        update = false;
}

GDI_DCItem::GDI_DCItem(GDI_DCItem const & myitem)
{
        penptr           = myitem.penptr;
        brushptr         = myitem.brushptr;
        fontptr          = myitem.fontptr;

        if (myitem.region.get())
                region.reset (new DrawLib::Region(*(myitem.region) ));

        textcolor       = myitem.textcolor;
        bkcolor         = myitem.bkcolor;
        bkmode          = myitem.bkmode;

        valign          = myitem.valign;
        halign          = myitem.halign;
        update          = myitem.update;
        stretch_mode    = myitem.stretch_mode;
        mapmode         = myitem.mapmode;

        ///Current window orgin
        window_origin     = myitem.window_origin;
        viewport_origin   = myitem.viewport_origin;
        window_extents    = myitem.window_extents;
        viewport_extents  = myitem.viewport_extents;
        current_transform = myitem.current_transform;
}

GO_Font::~GO_Font()
{
}
DrawLib::Font *GO_Font::GetFont()
{
        if (!opened_font.get())
        {
                DrawLib::FontManager &fm = DrawLib::GetGlobalFontManager();
                opened_font.reset(fm.CreateFontFromFile(familyname, stylename));

                if (!opened_font.get())
                {
                        DEBUGPRINT("Cannot open requested font " << familyname << " style " << stylename);
                        opened_font.reset(fm.CreateFontFromFile(familyname, "Regular"));
                }

                if (!opened_font.get())
                    opened_font.reset(fm.CreateFontFromFile("Liberation Sans", stylename));

                if (!opened_font.get())
                    opened_font.reset(fm.CreateFontFromFile("Liberation Sans", "Regular"));
        }

        return opened_font.get();
}

std::ostream& operator << (std::ostream &out, fRECT const &rectangle)
{
        return out << '[' << rectangle.left << ',' << rectangle.top << "]-[" << rectangle.right << ',' << rectangle.bottom << "]";
}
std::ostream& operator << (std::ostream &out, fPOINT const &point)
{
        return out << '(' << point.x << ',' << point.y << ')';
}

std::ostream& operator<< (std::ostream &str, GDI_DCItem::StretchBltMode mode)
{
        switch(mode)
        {
        case GDI_DCItem::BlackOnWhite: return str << "BlackOnWhite";
        case GDI_DCItem::WhiteOnBlack: return str << "WhiteOnBlack";
        case GDI_DCItem::ColorOnColor: return str << "ColorOnColor";
        case GDI_DCItem::HalfTone:     return str << "HalfTone";
        default:                       return str << "unknown strech mode " << (int)mode;
        }
}


}      //end namespace
