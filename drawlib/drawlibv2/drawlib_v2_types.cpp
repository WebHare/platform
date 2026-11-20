#include <drawlib/drawlibv2/allincludes.h>


#include "drawlib_v2_types.h"

namespace DrawLib
{

void ValidateDimensions(unsigned width, unsigned height)
{
        if ((width/1024) * (height/1024) > 128)
        {
                // bad luck!
                throw(std::runtime_error("Tried to create bitmap that was larger than 128 megapixels!"));
        }
        if(width > 65536)
            throw(std::runtime_error("Tried to create bitmap with a width larger than 65536 pixels"));
        if(height > 65536)
            throw(std::runtime_error("Tried to create bitmap with a height larger than 65536 pixels"));
}

int RoundFloat(double x)
{
        // De 'floor' is hier nodig, om dit correct te laten gaan voor negatieve getallen.
        return static_cast<int>(floor(x + 0.5));
}

std::ostream& operator<<(std::ostream &out, ISize const &point)
{
        return out << '(' << point.width << " by "  << point.height << ')';
}
std::ostream& operator<<(std::ostream &out, IRect const &point)
{
        return out << '[' << point.upper_left << " to "  << point.lower_right << ']';
}
std::ostream& operator<<(std::ostream &out, IPoint const &point)
{
        return out << '(' << point.x << ',' << point.y << ')';
}

std::ostream& operator<<(std::ostream &out, FPPoint const &point)
{
        return out << '(' << point.x << ',' << point.y << ')';
}

std::ostream& operator<<(std::ostream &out, FPSize const &point)
{
        return out << '(' << point.width << " by " << point.height << ')';
}

std::ostream& operator<<(std::ostream &out, Pixel32 const &color)
{
        out << '(' << int(color.GetR())
            << ',' << int(color.GetG())
            << ',' << int(color.GetB())
            << ',' << int(color.GetA())
            << ')';
        return out;
}

std::ostream& operator<<(std::ostream &out, XForm2D const &xform)
{
        out << "Matrix:  M11="<< xform.eM11 << "  M12=" << xform.eM12
            << "  M21=" << xform.eM21 << "  M22=" << xform.eM22
            << "  Translation: ( " << xform.translation.x << " , " << xform.translation.y << " )";
        return out;
}

/*******************************************************************************
        XForm2D transformation classes
*******************************************************************************/

XForm2D::XForm2D()
: eM11(1.0) , eM12(0.0) , eM21(0.0), eM22(1.0)
, translation(0.0, 0.0)
{
}

XForm2D::XForm2D(double _eM11, double _eM12, double _eM21, double _eM22, const FPPoint &_translation)
: eM11(_eM11) , eM12(_eM12) , eM21(_eM21), eM22(_eM22)
, translation(_translation)
{
}

} //end namespace DrawLib
