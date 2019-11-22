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

void RGBtoHSV( Pixel32 rgb, double *h, double *s, double *v )
{
        // Get the normalized r,g and b values
        double r = static_cast<double>(rgb.GetR()) / 255.0;
        double g = static_cast<double>(rgb.GetG()) / 255.0;
        double b = static_cast<double>(rgb.GetB()) / 255.0;

        double min_rgb, max_rgb, delta;
        min_rgb = std::min(std::min(r, g), b);
        max_rgb = std::max(std::max(r, g), b);


        // Calculate Saturation and Value
        *v = max_rgb;                                             // v
        *s = (max_rgb > 0.0001) ? (max_rgb - min_rgb) / max_rgb : 0.0;  // s

        if (*s == 0.0)
        {
                *h = -1.0;
                return;
        }

        // Calculate Hue
        delta = max_rgb - min_rgb;
        if (std::fabs(r-max_rgb) < 0.0001)
                *h = (g - b) / delta;           // between yellow & magenta
        else if (std::fabs(g-max_rgb) < 0.0001)
                *h = 2.0 + (b - r) / delta;       // between cyan & yellow
        else
                *h = 4.0 + (r - g) / delta;       // between magenta & cyan

        *h *= 60.0;                               // degrees
        if (*h < 0.0)
                *h += 360.0;
}

void HSVtoRGB( double h, double s, double v, Pixel32 *rgb )
{
        double i, f, p, q, t, r, g, b;
        // Make sure the RGB values will be between 0 and 255 (instead of 0 and 1)
        v *= 255.0;
        if (s == 0.0)
        {
                // achromatic (grey)
                r = g = b = v;
        }
        else
        {
                h /= 60.0;                        // sector 0 to 5
                i = floor(h);
                f = h - i;                      // factorial part of h
                p = v * (1.0 - s);
                q = v * (1.0 - s * f);
                t = v * (1.0 - s * (1.0 - f));
                switch (static_cast<int>(i))
                {
                        case 0:
                                r = v;
                                g = t;
                                b = p;
                                break;
                        case 1:
                                r = q;
                                g = v;
                                b = p;
                                break;
                        case 2:
                                r = p;
                                g = v;
                                b = t;
                                break;
                        case 3:
                                r = p;
                                g = q;
                                b = v;
                                break;
                        case 4:
                                r = t;
                                g = p;
                                b = v;
                                break;
                        default:                // case 5:
                                r = v;
                                g = p;
                                b = q;
                                break;
                }
        }
        rgb->SetRGBA(static_cast<uint8_t>(RoundFloat(r))
                   , static_cast<uint8_t>(RoundFloat(g))
                   , static_cast<uint8_t>(RoundFloat(b))
                   , 255);
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

std::ostream& operator<<(std::ostream &out, FPBoundingBox const &bbox)
{
        return out << "[" << bbox.upper_left << "," << bbox.lower_right << "]";
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

XForm2D::XForm2D(double rotation, FPPoint const &scaling, FPPoint const &_translation)
        : translation(_translation)
{
        double cosval = cos(rotation);
        double sinval = sin(rotation);

        eM11 =  cosval * scaling.x;
        eM12 =  sinval * scaling.x;
        eM21 = -sinval * scaling.y;
        eM22 =  cosval * scaling.y;
}

double XForm2D::GetRotation() const
{
        double basic_curve = (std::fabs(eM11) < 0.0001) ? 0.50 * M_PI : std::atan(eM12 / eM11);
        if (basic_curve < 0)
            basic_curve = basic_curve + M_PI;
        return eM12 < 0 ? basic_curve + M_PI: basic_curve;
}


XForm2D XForm2D::Invert() const
{
        double source [3][3] = {{eM11, eM12, 0}, {eM21, eM22, 0}, {translation.x, translation.y,1}};
        double c[3][3], adj[3][3], inv[3][3], det;

        /* find the determinant */
        det = source[0][0] * source[1][1] * source[2][2];
        det += source[0][1] * source[1][2] * source[2][0];
        det += source[0][2] * source[1][0] * source[2][1];
        det -= source[0][0] * source[1][2] * source[2][1];
        det -= source[0][1] * source[1][0] * source[2][2];
        det -= source[0][2] * source[1][1] * source[2][0];

        /* find the cofactors */
        c[0][0] =   source[1][1] * source[2][2] - source[1][2] * source[2][1];
        c[0][1] = -(source[1][0] * source[2][2] - source[1][2] * source[2][0]);
        c[0][2] =   source[1][0] * source[2][1] - source[1][1] * source[2][0];

        c[1][0] = -(source[0][1] * source[2][2] - source[0][2] * source[2][1]);
        c[1][1] =   source[0][0] * source[2][2] - source[0][2] * source[2][0];
        c[1][2] = -(source[0][0] * source[2][1] - source[0][1] * source[2][0]);

        c[2][0] =   source[0][1] * source[1][2] - source[0][2] * source[1][1];
        c[2][1] = -(source[0][0] * source[1][2] - source[0][2] * source[1][0]);
        c[2][2] =   source[0][0] * source[1][1] - source[0][1] * source[1][0];

        /* transpose the matrix of cofactors to get the adjoint of source */
        adj[0][0] = c[0][0]; adj[0][1] = c[1][0]; adj[0][2] = c[2][0];
        adj[1][0] = c[0][1]; adj[1][1] = c[1][1]; adj[1][2] = c[2][1];
        adj[2][0] = c[0][2]; adj[2][1] = c[1][2]; adj[2][2] = c[2][2];

        /* divide through adj by det(A) */
        for (unsigned i=0; i<3; i++)
          for (unsigned j=0; j<3; j++)
            inv[i][j] = adj[i][j] / det;

        return DrawLib::XForm2D(inv[0][0],inv[0][1],inv[1][0],inv[1][1],DrawLib::FPPoint(inv[2][0],inv[2][1]));
}


///////////////////////////////////////////////////////////////////////////
// Implementation ContourIterator ...

ContourIterator::ContourIterator(PolyLine const& _polyline)
: polyline(_polyline)
, next_point_number(1)
{
        if(polyline.points.size() > 0)
                last_point = polyline.points[0];
}

bool ContourIterator::GetNextPart(PolyLine *part, double length)
{
        if(part == NULL)
                throw std::runtime_error("ContourIterator::GetNextPart: Called with part parameter NULL.");

        // Clear the result:
        part->points.clear();
        part->is_closed = false;

        // Is there any contour left ?
        if(polyline.points.size() > 1 &&
           ((!polyline.is_closed && next_point_number >= polyline.points.size()) ||
           ( polyline.is_closed && next_point_number >  polyline.points.size())))
                return false;

        // Add at least the last point of tha last part as the first point:
        part->points.push_back(last_point);

        for(;(!polyline.is_closed && next_point_number <  polyline.points.size()) ||
             ( polyline.is_closed && next_point_number <= polyline.points.size());
            ++next_point_number)
        {
                FPPoint next_point;
                if(next_point_number == polyline.points.size())
                        next_point = polyline.points[0];
                else
                        next_point = polyline.points[next_point_number];

                FPPoint direction = next_point - last_point;
                double distance_to_next_point = direction.Norm();

                // Does this part include the next point ?:
                if(distance_to_next_point <= length)
                {
                        last_point = next_point;
                        part->points.push_back(next_point);
                        length -= distance_to_next_point;
                }

                // Does this part end before the next point ?:
                else // distance_to_next_point > length
                {
                        // Calculate the new end point of this part:
                        last_point +=
                                (direction * length / distance_to_next_point);
                        // Add it:
                        part->points.push_back(last_point);

                        // This ends the part:
                        return false;
                }
        }

        // No more points in thecontour? This was the last part:
        return true;
}

} //end namespace DrawLib
