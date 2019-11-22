#ifndef drawlib_v2_types_h
#define drawlib_v2_types_h
// ------------------------------------
// Build-setup here ...
// ------------------------------------

#include <cmath>
#include <ostream>
#include <vector>
#include <pixman.h>

/** Everything that DrawLib has/does/want is in the DrawLib namespace */
namespace DrawLib
{

void ValidateDimensions(unsigned width, unsigned height);

inline bool IsNan(double val) { return std::isnan(val); }


//Some forward defines to prevent our users from requiring allheaders.h
class Bitmap32;
#define BitmapInterface Bitmap32 //FIXME rename reference everywhere
class Canvas32; //defined in canvas.cpp
class XForm2D; //defined here

/** An endcap style mode for drawing outlines. */
namespace OutlineEndcapModes
{
        enum Type { Square, Rounded, Flat };
}
/** An join style mode for drawing outlines. */
namespace OutlineJoinModes
{
        enum Type {Rounded, Miter};
}

int BLEXLIB_PUBLIC RoundFloat(double x);

/** Integer point class */
class IPoint
{
        public:
        int x;
        int y;

        /** IPoint() - point defaults to (0,0) */
        IPoint()                      : x(0), y(0){};
        /** IPoint(double x,double y) - set point to (x,y) */
        IPoint(int px, int py)          : x(px), y(py){}    ;

};

/** IRect - rectangular area using integer coordinates */
class IRect
{
        public:
        IPoint upper_left;
        IPoint lower_right;

        IRect()
                : upper_left(0,0), lower_right(0,0) {};

        IRect(int upper_left_x, int upper_left_y, int lower_right_x, int lower_right_y)
                : upper_left(upper_left_x,upper_left_y), lower_right(lower_right_x, lower_right_y) {};
};

/** ISize - integer size */
class ISize
{
        public:
        int width;
        int height;

        /** IPoint(double x,double y) - set point to (x,y) */
        ISize(int px, int py)          : width(px), height(py){}    ;
};

/** Floating-point size class. */
class FPSize
{
        public:
        double width;
        double height;
        /** FPSize() - width/height defaults to (0,0) */

        FPSize() : width(0.0), height(0.0)
        {
        }

        /** FPSize(double w, double h) - set width to 'w', set height to 'h' */
        FPSize(double w, double h)
        : width(w)
        , height(h)
        {
        }

        /* Multiply our matrix against the rhs */
        FPSize& operator*=(XForm2D const &xform);
        FPSize operator*(XForm2D const &xform) const;
};

/** Floating-point point class */
class FPPoint
{
        public:

        double x;
        double y;

        /** FPPoint() - point defaults to (0,0) */
        FPPoint()                       : x(0.0), y(0.0) {};
        /** FPPoint(double x,double y) - set point to (x,y) */
        FPPoint(double px, double py)     : x(px), y(py) {};

        FPPoint(IPoint const &inpoint)
        : x(inpoint.x)
        , y(inpoint.y)
        {
        }

        /** GetNorm() - get the euclidean norm (length of vector)
            @return euclidean length of vector. */
        double Norm() const
        {
                return static_cast<double>(std::sqrt(x*x+y*y));
        }

        /** Normalize() - scale the vector so it's euclidean length is '1'
            @return the _original_ length (before normalization) of the vector */
        double Normalize()
        {
                double norm = Norm();
                if (norm!=norm) return 0.0;
                if (norm<1e-5f) return 0.0;
                x = x / norm;
                y = y / norm;
                return norm;
        }

        FPPoint& operator+=(FPPoint const &p)
        {
                x+=p.x;
                y+=p.y;
                return *this;
        }
        FPPoint& operator-=(FPPoint const &p)
        {
                x-=p.x;
                y-=p.y;
                return *this;
        }

        FPPoint operator+(const FPPoint& p) const
        {
                return FPPoint (x + p.x, y + p.y);
        }

        FPPoint operator-(const FPPoint& p) const
        {
                return FPPoint (x - p.x, y - p.y);
        }
        FPPoint operator-() const //unary inversion
        {
                return FPPoint(-x,-y);
        }

        /** Translate a point using the specified transformationmatrix */
        FPPoint& operator*=(XForm2D const &xform);
        FPPoint operator*(XForm2D const &xform) const;

        FPPoint operator*(double s) const
        {
                FPPoint result(x*s,y*s);
                return result;
        }

        FPPoint operator/(double s) const
        {
                FPPoint result(x/s,y/s);
                return result;
        }

        FPPoint operator+(const FPSize& s) const
        {
                return FPPoint (x + s.width, y + s.height);
        }

        FPPoint operator-(const FPSize& s) const
        {
                return FPPoint (x - s.width, y - s.height);
        }

        bool IsValid() const
        {
                return !IsNan(x) && !IsNan(y);
        }
};

/** Floating-point boundingbox */
class FPBoundingBox
{
public:
        FPPoint upper_left;
        FPPoint lower_right;

        FPBoundingBox() {}
        FPBoundingBox(IRect const &inbox)
        : upper_left(inbox.upper_left)
        , lower_right(inbox.lower_right)
        {
        }
        FPBoundingBox(double left, double top, double right, double bottom)
        {
                upper_left = FPPoint(std::min(left,right),std::min(top,bottom));
                lower_right = FPPoint(std::max(left,right),std::max(top,bottom));
        }
        FPBoundingBox(FPPoint const &_upper_left, FPPoint const &_lower_right)
        {
                upper_left = FPPoint(std::min(_upper_left.x,_lower_right.x),std::min(_upper_left.y,_lower_right.y));
                lower_right = FPPoint(std::max(_upper_left.x,_lower_right.x),std::max(_upper_left.y,_lower_right.y));
        }
        bool ExtendTo(FPPoint const &newpoint)
        {
                bool didextend=false;
                if (newpoint.x < upper_left.x)
                {
                        upper_left.x = newpoint.x;
                        didextend=true;
                }
                if (newpoint.y < upper_left.y)
                {
                        upper_left.y = newpoint.y;
                        didextend=true;
                }
                if (newpoint.x > lower_right.x)
                {
                        lower_right.x = newpoint.x;
                        didextend=true;
                }
                if (newpoint.y > lower_right.y)
                {
                        lower_right.y = newpoint.y;
                        didextend=true;
                }
                return didextend;
        }
        void ExtendTo(FPBoundingBox const &newbox)
        {
                //We can slightly optimize using the fact that newbox.u_l < newbox.l_r
                if (newbox.upper_left.x < upper_left.x) upper_left.x = newbox.upper_left.x;
                if (newbox.upper_left.y < upper_left.y) upper_left.y = newbox.upper_left.y;
                if (newbox.lower_right.x > lower_right.x) lower_right.x = newbox.lower_right.x;
                if (newbox.lower_right.y > lower_right.y) lower_right.y = newbox.lower_right.y;
        }

        double GetWidth() const { return lower_right.x - upper_left.x; }
        double GetHeight() const { return lower_right.y - upper_left.y; }
        FPSize GetSize() const { return FPSize(GetWidth(), GetHeight()); }

        /** Multiply this bounding box with the specified transformation. Note
            that this call always keeps upper_left < lower_right */
        FPBoundingBox& operator*=(XForm2D const &xform);
        FPBoundingBox operator*(XForm2D const &xform) const;
};


/** Pixel32 -  a container class for 32bit pixels (RGBA).
    Pixel32 is guaranteed to remain a POD (Plain Old Datatype)
    so it should be safe to memcpy() this structure */
class Pixel32
{
        private:
        uint32_t pixel; //<Red in low order byte, then green, blue, alpha
        Pixel32(uint32_t pixel) : pixel(pixel) { }

        public:
        /** Pixel32(r,g,b,alpha) - set the pixel's red, green, blue and alpha. All channels 0..255 */
        inline Pixel32(uint8_t r, uint8_t g, uint8_t b, uint8_t alpha)
        : pixel(r|(g<<8)|(b<<16)|(alpha<<24))
        {
        }
        /** Pixel32(r,g,b) - set the pixel's red, green and blue. (alpha=255) All channels 0..255 */
        inline Pixel32(uint8_t r, uint8_t g, uint8_t b)
        : pixel(r|(g<<8)|(b<<16)|0xff000000)
        {
        }
        /** Pixel32() - copy pixel but change alpha */
        inline Pixel32(Pixel32 const &src, uint8_t newalpha)
        : pixel((src.pixel&0x00FFFFFF) | (newalpha<<24))
        {
        }
        /** Pixel32() - default constructor (red=0, green=0, blue=0, alpha=255) */
        inline Pixel32()
        : pixel(0xff000000)
        {
        }

        /** Create a transparent color */
        static Pixel32 MakeTransparent()
        {
                return Pixel32(0,0,0,0);
        }

        /** Create a pixel from a memory value */
        static Pixel32 FromPixelValue(uint32_t pixelvalue)
        {
                return Pixel32(pixelvalue);
        }

        /** Create a color by reading a memory area (byte 0: red)
            @param data 4-byte memory area to read
            @return The color read from this memory*/
        static Pixel32 GetRedFirst(uint8_t const data[4])
        {
                return Pixel32(data[0],data[1],data[2],data[3]);
        }

        /** Create a color by reading a memory area with a reversed color (byte 3: red)
            @param data 4-byte memory area to read
            @return The color read from this memory*/
        static Pixel32 GetAlphaFirst(uint8_t const data[4])
        {
                return Pixel32(data[3],data[2],data[1],data[0]);
        }

        /** Create a color by reading a memory area (byte 0: red)
            and inverted alpha (255 is considered full transparancy)
            @param data 4-byte memory area to read
            @return The color read from this memory*/
        static Pixel32 GetRedFirstInverseAlpha(uint8_t const data[4])
        {
                return Pixel32(data[0],data[1],data[2],static_cast<uint8_t>(255-data[3]));
        }

        /** Create a color by reading a memory area with a reversed color (byte 3: red)
            and inverted alpha (255 is considered full transparancy)
            @param data 4-byte memory area to read
            @return The color read from this memory*/
        static Pixel32 GetAlphaFirstInverseAlpha(uint8_t const data[4])
        {
                return Pixel32(static_cast<uint8_t>(255-data[3]),data[2],data[1],data[0]);
        }

        /** Copy a pixel, but set a new alpha value */
        void SetPixelA(Pixel32 const &src, uint8_t new_alpha)
        {
                pixel = (new_alpha<<24) | (src.pixel&0xFFFFFF);
        }

        /** SetRGBA(r,g,b,a) - Set the pixel's r,g,b,a values. */
        void SetRGBA(uint8_t r, uint8_t g, uint8_t b, uint8_t alpha)
        {
                //pixel = r|(g<<8)|(b<<16)|(alpha<<24);

                //FIXME: add big endian support..
                uint8_t *p = (uint8_t*)&pixel;
                *p++ = r;
                *p++ = g;
                *p++ = b;
                *p++ = alpha;
        }

        pixman_color GetPixmanPixel() const
        {
                pixman_color c = { uint16_t((GetR() << 8) | GetR())
                                 , uint16_t((GetG() << 8) | GetG())
                                 , uint16_t((GetB() << 8) | GetB())
                                 , uint16_t((GetA() << 8) | GetA())
                                 };
                return c;
        }

        /** Return the pixel's value packed, red in first 8 bits, green second 8, etc */
        uint32_t inline GetPixelValue() const { return pixel; }
        /** Set the pixel to a packed value: red in first 8 bits, green second 8, etc */
        void inline SetPixelValue(uint32_t newpixel) { pixel=newpixel; }

        uint8_t inline GetR() const {return uint8_t(pixel&255);  }
        uint8_t inline GetG() const {return uint8_t((pixel>>8)&255);}
        uint8_t inline GetB() const {return uint8_t((pixel>>16)&255); }
        uint8_t inline GetA() const {return uint8_t((pixel>>24)&255);}

        void SetA(uint8_t a) {pixel &= 0xffffff; pixel |= a<<24;}

        /** Is this color fully transparant? */
        bool IsFullyTransparent() const
        {
                return GetA()==0;
        }

        bool operator== (const Pixel32 &p) const
        {
                return pixel==p.pixel;
        }

        bool operator!= (const Pixel32 &p) const
        {
                return !(*this==p);
        }
};

// ADDME: Maybe move these into an HSV class
void BLEXLIB_PUBLIC RGBtoHSV( Pixel32 rgb, double *h, double *s, double *v );
void BLEXLIB_PUBLIC HSVtoRGB( double h, double s, double v, Pixel32 *rgb );

/** Polygon - a polygon container class. A polygon must have more than two points! */
class Polygon
{
public:
        Polygon() {}
        /** points - a list of points describing the polygon */
        std::vector<FPPoint> points;
        /** Check to see if this is a valid polygon. Check is points.size()>2 */
        bool IsValid() const;
};

/** PolyLine - A list of points :)*/
class PolyLine
{
public:
        /** Constructs an empty PolyLine. */
        PolyLine()
        : is_closed(false) {}
        /** points - a list of points describing the polygon */
        std::vector<FPPoint> points;
        /** If it is closed or not. */
        bool is_closed;
        /** Closes this PolyLine. */
        void Close() { is_closed = true; }
        /** Check to see if this is a valid polyline. Check is points.size()>=2 */
        bool IsValid() const { return points.size()>=2; }
};

/**
 * Class to get parts of a contour (PolyLine).
 * A next part is obtained, using 'GetNextPart', given the wished
 * length of the part. This class remembers the position the
 * last part ended.
 */
class BLEXLIB_PUBLIC ContourIterator
{
        /** The contour. */
        PolyLine const& polyline;

        /** End point of the last part. (Rounded intermediate result.) */
        FPPoint last_point;

        /** Index in the polyline, of the first point after the last point of the last part. */
        unsigned next_point_number;

public:
        /**
         * Constructs a ContourIterator,beginning at the start
         * of the PolyLine.
         *
         * @param _polyline The polyline defining the contour.
         * During the use of this class this polyline may not get
         * altered or deleted!
         */
        ContourIterator(PolyLine const& _polyline);

        /**
         * Gets the next part of the contour, as a 'PolyLine'.
         *
         * @param part The 'PolyLine' getting entirely overwritten with
         * the part as result. It is undifined when no parts where left
         * any more. When defined the total length will be equal or less
         * than the parameter length.
         *
         * @param length The wished length of the part.
         *
         * @return If the part found is the last part.
         */
        bool GetNextPart(PolyLine *part, double length);
};

/** PolyPolygon - a container class for polygons. */
class PolyPolygon
{
public:
        PolyPolygon() {};
        /** polygons - a list of polygons */
        std::vector<Polygon> polygons;
        /** Check to see if this is a valid polypolygon. Check if all polygons have more than two points. */
        bool IsValid() const;
};

/** A structure to hold transformation matrices */
class BLEXLIB_PUBLIC XForm2D
{
public:
        ///Create a standard XForm2D structure (identity matrix with zero offset)
        XForm2D();
        ///Create an XForm2D with the specified matrix components
        XForm2D(double eM11, double eM12, double eM21, double eM22, FPPoint const &translation);


        /** Create an XForm2D with rotation, scaling and translation.
            @param[in] rotation - rotation in radians (for degrees multiply by (2*PI/360)
            @param[in] scaling  - an FPPoint used for scaling
            @param[in] translation - an FPPoint used for translation
        */
        XForm2D(double rotation, FPPoint const &scaling, FPPoint const &translation);

        ///Multiply this transformation against another worldtransform matrix
        XForm2D& operator*=(XForm2D const &xform);

        XForm2D operator *(XForm2D const &rhs) const;

        /** Invert this matrix
            @return The matrix, inverted*/
        XForm2D Invert() const;

        /** Get this matrix's rotation */
        double GetRotation() const;
        ///The matrix components
        double eM11, eM12, eM21, eM22;
        ///Translation
        FPPoint translation;
};

inline XForm2D XForm2D::operator *(XForm2D const &rhs) const
{
        FPPoint newtranslation(translation.x  * rhs.eM11 + translation.y  * rhs.eM21 + rhs.translation.x,
                               translation.x  * rhs.eM12 + translation.y  * rhs.eM22 + rhs.translation.y);

        return XForm2D( eM11 * rhs.eM11 + eM12 * rhs.eM21,
                        eM11 * rhs.eM12 + eM12 * rhs.eM22,
                        eM21 * rhs.eM11 + eM22 * rhs.eM21,
                        eM21 * rhs.eM12 + eM22 * rhs.eM22,
                        newtranslation);
}
inline XForm2D& XForm2D::operator*=(XForm2D const &rhs)
{
        return *this = *this * rhs;
}
inline FPPoint FPPoint ::operator*(XForm2D const &xform) const
{
        return FPPoint(xform.eM11 * x + xform.eM21 * y + xform.translation.x
                      ,xform.eM12 * x + xform.eM22 * y + xform.translation.y);
}
inline FPPoint& FPPoint::operator*=(XForm2D const &xform)
{
        return *this = *this * xform;
}
inline FPSize FPSize::operator*(XForm2D const &xform) const
{
        return FPSize(xform.eM11 * width + xform.eM21 * height
                     ,xform.eM12 * width + xform.eM22 * height);
}
inline FPSize& FPSize::operator*=(XForm2D const &xform)
{
        return *this = *this * xform;
}
inline FPBoundingBox FPBoundingBox::operator*(XForm2D const &xform) const
{
        return FPBoundingBox(upper_left*xform,lower_right*xform);
}
inline FPBoundingBox& FPBoundingBox::operator*=(XForm2D const &xform)
{
        return *this = *this * xform;
}

inline bool operator== (FPPoint p1, FPPoint p2)
{
        return ((p1.x==p2.x) && (p1.y==p2.y));
}

inline bool operator!= (FPPoint p1, FPPoint p2)
{
        return !(p1==p2);
}

bool inline ColorsAreEqual(const DrawLib::Pixel32 &p1, const DrawLib::Pixel32 &p2)
{
        if ( (p1.GetR()!=p2.GetR()) || (p1.GetG()!=p2.GetG()) || (p1.GetB()!=p2.GetB()))
            return false;

        return true;
}

BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, IRect const &point);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, ISize const &point);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, IPoint const &point);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, FPSize const &point);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, FPPoint const &point);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, FPBoundingBox const &point);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, Pixel32 const &pixel);
BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &out, XForm2D const &xform);

} //end namespace DrawLib

#endif
