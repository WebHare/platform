#include <drawlib/drawlibv2/allincludes.h>


#include <blex/utils.h>
#include "region.h"

namespace DrawLib
{

Region::Region(unsigned _width, unsigned  _height, bool initial_unprotected)
: width(_width)
, height(_height)
, rowsize( Blex::BitmapRequiredSize(width) )
, protection(new Blex::BitmapType[rowsize * (GetHeight() + 1)])
{
        if ((_width==0) || (_height==0))
                throw(std::runtime_error("Region constructor called with zero width or height"));

        std::fill_n(&protection[0], rowsize * height, initial_unprotected ? ~Blex::BitmapType() : 0);
}

Region::Region(Region const &src)
: width(src.width)
, height(src.height)
, rowsize(src.rowsize)
, protection(new Blex::BitmapType[rowsize * (GetHeight() + 1)])
{
        memcpy(&protection[0], &src.protection[0], rowsize * height * sizeof(DrawLib::Pixel32));
}

Region& Region::operator=(Region const &src)
{
        if ( (src.GetWidth() != GetWidth()) || (src.GetHeight() != GetHeight()))
            throw std::runtime_error("Copying differently sized regions");
        memcpy(&protection[0], &src.protection[0], rowsize * height * sizeof(protection[0]));
        return *this;
}

Region::~Region()
{
}

IRect Region::GetSafeArea(IRect area)
{
        if(area.upper_left.x > area.lower_right.x)
            std::swap(area.upper_left.x, area.lower_right.x);
        if(area.upper_left.y > area.lower_right.y)
            std::swap(area.upper_left.y, area.lower_right.y);

        area.upper_left.x = Blex::Bound<int32_t>(0, width, area.upper_left.x);
        area.lower_right.x = Blex::Bound<int32_t>(0, width, area.lower_right.x);
        area.upper_left.y = Blex::Bound<int32_t>(0, height, area.upper_left.y);
        area.lower_right.y = Blex::Bound<int32_t>(0, height, area.lower_right.y);
        return area;
}

bool Region::IsProtected (uint32_t x, uint32_t y) const
{
        return Blex::GetBit(GetRow(y),x) == false;
}
void Region::SetPermitted(uint32_t x, uint32_t y, bool permission)
{
        Blex::SetBit(GetRow(y), x, permission);
}
bool Region::IsPermitted (uint32_t x, uint32_t y) const
{
        return !IsProtected(x,y);
}

void Region::InvertProtectedArea(IRect area)
{
        if (area.upper_left.x == area.lower_right.x) return;
        if (area.upper_left.y == area.lower_right.y) return;

        //IRect s(GetSafeArea(area));

        for (uint32_t y= 0 ;y<height;y++)
          for (uint32_t x= 0 ;x<width;x++)
        {
                //there are 32 bits per mini-bitmap. If you want to activate
                //(4,4) in a 10x10 bitmap, it the 4*10+4 = 44th bit
                //its in the second uint32_t (44/32 = 1)
                //at position 44 % 32 = 12
                SetPermitted(x,y, !IsPermitted(x,y));
        }
}

void Region::AndProtectedArea(IRect area)
{
        if (area.upper_left.x == area.lower_right.x) return;
        if (area.upper_left.y == area.lower_right.y) return;

        IRect s  (GetSafeArea(area));
        bool giveprotection;
        for (int32_t y = 0; y < (int32_t)height; ++y)
        {
                for (int32_t x = 0; x < (int32_t)width; ++x)
                {
                        giveprotection = (x>=s.upper_left.x) && (x<s.lower_right.x) && (y>=s.upper_left.y) && (y<s.lower_right.y);
                        SetPermitted(x,y, !giveprotection);
                }
        }
}

void Region::IntersectPermissionArea(IRect area)
{
        if (area.upper_left.x == area.lower_right.x) return;
        if (area.upper_left.y == area.lower_right.y) return;

        DrawLib::IRect s  (GetSafeArea(area));
        bool inarea;
        for (int32_t y = 0; y < (int32_t)height; ++y)
        {
                for (int32_t x = 0;x < (int32_t)width; ++x)
                {
                        inarea = (x>=s.upper_left.x) && (x<s.lower_right.x) && (y>=s.upper_left.y) && (y<s.lower_right.y);
                        if (!inarea)
                                SetPermitted(x,y, false);
                }
        }
}
/*
void Region::ExcludePermissionArea(IRect area)
*/

void Region::SetProtectedArea(IRect area, bool give_protection)
{
        if (area.upper_left.x == area.lower_right.x) return;
        if (area.upper_left.y == area.lower_right.y) return;

        IRect s = GetSafeArea(area);

        for (int32_t y=s.upper_left.y;y<s.lower_right.y;y++)
                for (int32_t x=s.upper_left.x;x<s.lower_right.x;x++)
                {
                        SetPermitted(x,y, !give_protection);
                }

}


} //end of namespace
