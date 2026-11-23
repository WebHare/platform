#ifndef drawobject_h
#define drawobject_h

#include "bitmap.h"
#include "canvas.h"
#include "polyrenderer.h"
#include "outlinerenderer.h"
#include "drawpath.h"

namespace DrawLib
{

/** DrawObject - the mother class for DrawLib's drawing functionality */
class BLEXLIB_PUBLIC DrawObject
{
public:
        /** DrawObject - make a drawobject to draw stuff on a canvas.
            It will throw an exception if canvas==NULL! */
        explicit DrawObject(Canvas32 *canvas);

        /** FillMode - enumeration for setting the fillmode of the polyfiller */
        enum FillMode {SOLID=0, TEXTURED};

        /**
         * The DrawRectangle function fills a rectangle by using the specified fill color and mode.
         * This function includes the left and top borders, but excludes the right and
         * bottom borders of the rectangle.
         */
        void DrawRectangle(const FPPoint &upperleft, const FPPoint &lowerright);

        /** DrawEllipse - draw a filled ellipse */
        void DrawEllipse(const FPPoint &centerpoint, const FPSize &radius);

        /** DrawEllipseOutline - draw an ellipse outline */
        void DrawEllipseOutline(const FPPoint &centerpoint, const FPSize &radius);

        /** DrawPixel - draw a single pixel */
        void DrawPixel(const FPPoint &position, const Pixel32 &pixel);

        /** SetFillColor - sets the fill color used by the polygonfiller (FillMode = SOLID) */
        void SetFillColor(const Pixel32 &color);

        /** SetFillTexture - sets the fill texture used by the polygonfill (FillMode = TEXTURED) */
        void SetFillTexture(const Bitmap32 *texturebitmap, const IPoint &offset);

        /** SetFillMode - sets the filling mode (SOLID, TEXTURED) */
        void SetFillMode(const FillMode mode);

        /** SetOutlineColor - sets the color for drawing outlines */
        void SetOutlineColor(const Pixel32 &color);

        /** SetOutlineWidth - sets the width of the outline (in pixels) */
        void SetOutlineWidth(double pixels);

        /** GetCanvas - get a const pointer to the DrawObject's canvas32 object. */
        Canvas32 const* GetCanvas() const
                {return mycanvas;};

        /** StrokeFillPath - Stroke and/or Fill a path */
        void StrokeFillPath(Path const &thispath, bool stroke, bool fill);

private:
        Path CreateRectanglePath(const FPPoint &upperleft, const FPPoint &lowerright);
        Path CreateEllipsePath(const FPPoint &centerpoint, const FPSize &radius);

        /** DrawIntegerPixel - draw a pixel at an integer location*/
        void DrawIntegerPixel(int x, int y, const Pixel32 &pixel);

        /** Draws a polyline specified by 'line', which may be closed, using the current outline width
            @param line - A list of points. Lines get drawn between the points and,
                          when it is closed, from the end to the starting point.
        */
        void DrawPolyLine(PolyLine const& line);

        Canvas32                *mycanvas;

        //ADDME: Isn't construction of objects such as below a bit too heavy? eg, can't the functions just construct the necessary objects on their stack?
        PolyRenderer            polyrenderer;
        ThickOutlineRenderer    outlinerenderer;

        // Empty texture for default TexturedPolyCallback
        static Bitmap32         empty_texture;

        // All polygon callbacks
        SolidPolyCallback       fill_solidpolycallback;
        TexturedPolyCallback    fill_texturedpolycallback;
        SolidPolyCallback       outline_solidpolycallback;

        // Currently active polyfiller callback
        PolyScanlineCallbackBase *current_fillcallback;

        double                   outline_width;
        OutlineEndcapModes::Type outline_endcap_mode;
        OutlineJoinModes::Type  outline_join_mode;
};

}
#endif
