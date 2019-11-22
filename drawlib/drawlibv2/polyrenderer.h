#ifndef polyrenderer_h
#define polyrenderer_h

#include "drawlib_v2_types.h"
#include "canvas.h"

namespace DrawLib
{

/** PolyScanlineCallbackBase - a baseclass for drawing polygons on DrawLib::Bitmap32 objects
    This class must not be used directly, but must be used through a derived class.
    Derived classes exist for drawing solid polygons, and textured polygons. */

class BLEXLIB_PUBLIC PolyScanlineCallbackBase
{
public:
        virtual ~PolyScanlineCallbackBase();

        /** GenerateScanline - generate a scanline from (startx,y) to (and including) (endx,y)
            @param scanlineptr must point to a valid scanline!
            @param startx Starting position
            @param endx Ending position
            @param y current y line (used for pattern offsetting)
        */
        virtual void GenerateScanline(int startx, int limity, int y, Scanline32 *scanlineptr) = 0;
};

/** SolidPolyCallback - a class that is called by DrawLib::PolyRenderer.
    This gets called for every scanline in a polygon. It generates a solid scanline
    with the correct length and mask. The color is set using the SetFillColor method. */

class BLEXLIB_PUBLIC SolidPolyCallback : public PolyScanlineCallbackBase
{
public:
        void GenerateScanline(int startx, int limity, int y, Scanline32 *scanlineptr);

        void SetFillColor(Pixel32 fillcolor)
        {
                color = fillcolor;
        }
private:
        Pixel32 color;
};

/** TexturedPolyCallback - a class that is called by DrawLib::PolyRenderer.
    This gets called for every scanline in a polygon. It generates a textured scanline
    with the correct length and mask. The color is set using the SetFillColor method. */

class BLEXLIB_PUBLIC TexturedPolyCallback : public PolyScanlineCallbackBase
{
public:
        TexturedPolyCallback(const Bitmap32 *bitmap) : texture(bitmap)
        {
                assert(bitmap->GetWidth()>0);
                assert(bitmap->GetHeight()>0);
        };

        void GenerateScanline(int startx, int limity, int y, Scanline32 *scanlineptr);

        void SetTexture(const Bitmap32 *texbitmap, IPoint textureoffset)
        {
                assert(texbitmap->GetWidth()>0);
                assert(texbitmap->GetHeight()>0);
                texture = texbitmap;
                offset = textureoffset;
        };

        void SetOffset(IPoint textureoffset)
        {
                offset = textureoffset;
        };

private:
        const Bitmap32 *texture;
        IPoint offset;
};

/** Describes a fp linear function with 2 parameters. ( f(x,y) = ax + by + c )
*/
struct TwoParamFunc
{
        TwoParamFunc(float _a, float _b, float _c) : a(_a), b(_b), c(_c) { }

        float Calc(float x, float y) { return x * a + y * b + c; }

        float a, b, c;
};

/** TexturedPolyCallback - a class that is called by DrawLib::PolyRenderer.
    This gets called for every scanline in a polygon. It draws perspective correct
    textures onto the scanline with the correct length and mask.

    The idea is that in perspective correct projection of a plane (of u,v,z toward uvz=(0,0,0) onto z=1) to (x,y)
    the 1/z of the projected point is linear in x and y, as are the u/z and v/z of the projected point.
    In this class, you set the functions to calculate 1/z, u/z and v/z and a texture for every (x,y), and
    scanline rendering will then construct the original (u,v) within the texture to draw.
*/
class BLEXLIB_PUBLIC ThreeDTexturedPolyCallback : public PolyScanlineCallbackBase
{
public:
        ThreeDTexturedPolyCallback(const Bitmap32 *bitmap)
        : texture(bitmap)
        , sufunc(1.0, 0.0, 0.0)
        , svfunc(0.0, 1.0, 0.0)
        , szfunc(0.0, 0.0, 1.0)
        {
        }

        void GenerateScanline(int startx, int limity, int y, Scanline32 *scanlineptr);

        void SetTexture(const Bitmap32 *texturebitmap, TwoParamFunc const &_sufunc, TwoParamFunc const &_svfunc, TwoParamFunc const &_szfunc)
        {
                assert(texturebitmap->GetWidth()>0);
                assert(texturebitmap->GetHeight()>0);
                texture = texturebitmap;
                sufunc = _sufunc;
                svfunc = _svfunc;
                szfunc = _szfunc;
        }

private:
        const Bitmap32 *texture;
        TwoParamFunc sufunc;
        TwoParamFunc svfunc;
        TwoParamFunc szfunc;
};

/** PolyRenderer - fills a polygon described by the DrawLib::PolyPolygon class.
    By providing a DrawLib::PolyScanlineCallbackBase class, the polygon can be filled.
    The callback is called for every scanline in the polygon. */

class PolyRenderer
{
public:
        /** DrawPolygon
            @param canvas       A pointer to the canvas the polygon should be drawn on.
            @param polypolygon  A reference to a container class describing the point in the polygon.
            @param callback     A reference to a callback class that provides a DrawLib::Scanline32 for every scanline in the polygon. (See DrawLib::SolidPolyCallback) */
        void DrawPolygon(DrawLib::Canvas32 *canvas, const DrawLib::PolyPolygon &polypolygon,
                PolyScanlineCallbackBase &callback, bool winding = false);

        /** DrawPolygonToProtection - draw to the protection area, not the visible bitmap
            @param bitmap       A pointer to the canvas.
            @param polypolygon  A reference to a container class describing the point in the polygon.
            */
        void DrawPolygonToProtection(DrawLib::Canvas32 *canvas, const DrawLib::PolyPolygon &polypolygon,
                PolyScanlineCallbackBase &callback, bool winding);
private:

        void DrawPolygonInternal(DrawLib::Canvas32 *canvas, const DrawLib::PolyPolygon &polypolygon,
                PolyScanlineCallbackBase &callback, bool winding, bool set_protection);


        /** Edge - A class that keeps track of all the vertexes of the polygon (edges) */
        class Edge
        {
        public:
                double   x;      // x-coordinate of edge's intersection of current scanline
                double  dx;      // change in x with respect to y
                int     i;      // edge number: edge goes from pt[i] to pt[i+1]..
        };

        /** AugmentedPoint - a pointclass that keeps track of which point belongs to which vertex */
        class AugmentedPoint
        {
        public:
                DrawLib::FPPoint        point;
                int                     vertex_index;
                int                     prev_index;
                int                     next_index;
        };

        std::vector<Edge>                       active_edgelist;        // active edge list!!
        std::vector<AugmentedPoint>             pointlist;         // vertex index list!!
        std::vector<AugmentedPoint>             pointlist_sorted;  // vertex index list!!

        void inline insert_vertex(int i, int y);
        void inline delete_vertex(int i);
        static bool AugmentedPointSort(const AugmentedPoint& p1, const AugmentedPoint& i2);
        static bool ActiveEdgeXSort(const Edge& e1, const Edge& e2);
};

}

#endif
