#ifndef drawobject_h
#define drawobject_h

#include "bitmap.h"
#include "canvas.h"
#include "polyrenderer.h"
#include "outlinerenderer.h"
#include "textrenderer.h"
#include "drawpath.h"

namespace DrawLib
{


/** DrawObject - the mother class for DrawLib's drawing functionality */

/*
#define TEXT_HALIGN_LEFT 0
#define TEXT_HALIGN_CENTER 1
#define TEXT_HALIGN_RIGHT 2

#define TEXT_VALIGN_BASELINE 0
#define TEXT_VALIGN_TOP 1
#define TEXT_VALIGN_BOTTOM 2
#define TEXT_VALIGN_CENTER 3*/

/** DrawObject is able to draw polygons, line, polylines, bezier curves. It also draws text using the FreeType library.*/
class BLEXLIB_PUBLIC DrawObject
{
public:
        /** DrawObject - make a drawobject to draw stuff on a canvas.
            It will throw an exception if canvas==NULL! */
        explicit DrawObject(Canvas32 *canvas);

        /** FillMode - enumeration for setting the fillmode of the polyfiller */
        enum FillMode {SOLID=0, TEXTURED, THREEDTEXTURED};

        /**
         * The FillRect function fills a rectangle by using the specified fill color and mode.
         * This function includes the left and top borders, but excludes the right and
         * bottom borders of the rectangle.
         */

        Path CreateRectanglePath(const FPPoint &upperleft, const FPPoint &lowerright);

        void DrawRectangle(const FPPoint &upperleft, const FPPoint &lowerright);

        /** DrawRectangleOutline - draw a rectangul outline */
        void DrawRectangleOutline(const FPPoint &upperleft, const FPPoint &lowerright);

        Path CreateRoundRectanglePath(const FPPoint &upperleft, const FPPoint &lowerright, const FPSize &radius);

        /** DrawRoundRectangle - Draws a filled rectangle with rounded corners. No drawing
            is done on the lines x=lowerright.x and y=lowerright.y. In spite of this,
            the roundings will be 'prefect'. */
        void DrawRoundRectangle(const FPPoint &upperleft, const FPPoint &lowerright, const FPSize &radius);

        Path CreateEllipsePath(const FPPoint &centerpoint, const FPSize &radius);

        /** DrawRoundRectangleOutline - draw a outline of a roundrectangle */
        void DrawRoundRectangleOutline(const FPPoint &upperleft, const FPPoint &lowerright, const FPSize &radius);

        /** DrawEllipse - draw a filled ellipse */
        void DrawEllipse(const FPPoint &centerpoint, const FPSize &radius);

        /** DrawEllipseOutline - draw an ellipse outline */
        void DrawEllipseOutline(const FPPoint &centerpoint, const FPSize &radius);

        /** DrawPolyPolygon - draw a list of polygons */
        void DrawPolyPolygon(const PolyPolygon &polylist);
        private:
        /**
         * Internally draws a poly polygon. It is used by 'DrawPolyPolygon'.
         * @param also_draw_lower_right When true, pixels ON the right or
         * lower edged of the polygons, also get drawn. This paramater is
         * for example true for filling paths.
         */
        void DrawPolyPolygonInternal(const ::DrawLib::PolyPolygon &polylist);
        public:

        /** DrawPolygon - draw a single filled polygon */
        void DrawPolygon(const Polygon &polygon);

        /** DrawPixel - draw a pixel at an integer location*/
        void DrawIntegerPixel(int x, int y, const Pixel32 &pixel);
        private:
        /**
         * Internally draws a polygon. It is used by 'DrawPolygon'.
         * @param also_draw_lower_right When true, pixels ON the right or
         * lower edged of the polygons, also get drawn. This paramater is
         * for example true for drawing an ellipse.
         */
        void DrawPolygonInternal(const ::DrawLib::Polygon &polygon);

        public:

        /** DrawPixel - draw a single pixel */
        void DrawPixel(const FPPoint &position, const Pixel32 &pixel);

        /** Draws a polyline specified by 'line', which may be closed.
            @param line - A list of points. Lines get drawn between the points and,
                          when it is closed, from the end to the starting point.
            @param thickness - the thickness of the line (in pixels),
              if set negative DrawObject will use it's internal OutlineWidth setting.
        */

        Pixel32 GetPixel(const FPPoint &position) const;

        //private:

        void DrawPolyLine(PolyLine const& line);
        void DrawPolyLine(PolyLine const& line, double thickness);

        /** Used by the DrawPolyLine method to separately draw each dash or,
            @param line - A list of points. Lines get drawn between the points and,
                          when it is closed, from the end to the starting point.
            @param thickness - the thickness of the line (in pixels)
            when no line dashing is set, just the entire polyline.
        */
        void DrawPolyLineInternal(PolyLine const& line, double thickness);

        /** DrawLine - draw a line between two points.*/
        void DrawLine(const FPPoint &frompoint, const FPPoint &topoint, double thickness);
        void DrawLine(const FPPoint &frompoint, const FPPoint &topoint);


        /** DrawArcOutline - draw a Arc
            AU: documenteer dit ff beter...
            @returns the last point drawn.
        */
        FPPoint DrawArcOutline(const FPPoint &centerpoint, const FPSize &radius,
                const FPPoint &startpoint, const FPPoint &endpoint, bool clockwise);

        /** DrawBezierOutline
            @param beziercurvelist - polyline list containing bezier curve points. (see below..)
            @param update_current_pos - if true, update the current pos.

            Bezier curve point list is as follows:
            index 0 = start-point of first segment
            index 1 = 1st control point of first segment
            index 2 = 2nd control point of first segment
            index 3 = end-point of first segment (and start point of second segment)
            index 4 = 1st control point of second segment..
            index 5 = 2nd control point of second segment..
            ..
            ..
        */
        Path CreateBezierPath(const PolyLine &beziercurvelist);
        void DrawBezierOutline(const PolyLine &beziercurvelist);

        /** DrawPie - draws a solid pie  */
        void DrawPie(const FPPoint &centerpoint, const FPSize &radius,
                const FPPoint &startpoint, const FPPoint &endpoint);

        /** DrawPieOutline - draws a pie-outline  */
        void DrawPieOutline(const FPPoint &centerpoint, const FPSize &radius,
                const FPPoint &startpoint, const FPPoint &endpoint);

        /** DrawThinkLine - draw a line from 'start' to 'end' 1 pixel wide. */
        void DrawThinLine(const FPPoint &start, const FPPoint &end);

        //public:

        /** DrawBitmap - copy a bitmap onto the canvas */
        void DrawBitmap(const Bitmap32  &mybitmap, DrawLib::XForm2D const &transform);

        /*-------------------------------------------
                Text methods...
        ---------------------------------------------*/
        /** DrawTextExt - draw a text string (extended)
            @param plotpoint - position of the text.
            @param textstring - text string in Unicode format
            @param myFont - pointer to the font to be used
            @param antialiasing - if true text is rendered in antialiased mode
            @param h_alignment  - 0 = LEFT, 1 = CENTER, 2 = RIGHT
            @param v_alignment  - 0 = BASELINE, 1 = TOP, 2 = BOTTOM, 3 = CENTER, 4 = ASCENDER, 5 = DESCENDER
            @param baselineangle  Angle of the baseline. The basepoint of glyphs changes location.
            @param glyphangle     Angle of the glyphs. The rotation of the glyphs changes
            */
        void DrawTextExtended(const FPPoint &baseline, const Blex::UnicodeString &textstring,
                const Font &myFont, const std::vector<double> &deltas,
                bool Antialiasing,
                TextRenderer::HorizontalAlignment horizontal_alignment,
                TextRenderer::VerticalAlignment vertical_alignment,
                double baselineangle,
                double glyphangle,
                double letterspacing
        );

        /** GetTextWidth - get the width in pixels of a text string
            @param textstring - text string in Unicode format
            @param myFont - pointer to the font to be used
            @param antialiasing - if true text is rendered in antialiased mode
                */
        uint32_t GetTextWidth(const Blex::UnicodeString &textstring, const Font &myFont, const std::vector<double> &deltas, bool antialiasing, double letterspacing);

        /** GetTextHeight - get the height in pixels of a text string
            @param textstring - text string in Unicode format
            @param myFont - pointer to the font to be used
            @param antialiasing - if true text is rendered in antialiased mode
                */
        uint32_t GetTextHeight(const Blex::UnicodeString &textstring, const Font &myFont, const std::vector<double> &deltas, bool antialiasing, double letterspacing);

        /** SetFillColor - sets the fill color used by the polygonfiller (FillMode = SOLID) */
        void SetFillColor(const Pixel32 &color);

        /** SetFillTexture - sets the fill texture used by the polygonfill (FillMode = TEXTURED) */
        void SetFillTexture(const Bitmap32 *texturebitmap, const IPoint &offset);

        /** SetFillTreeDTexture - set the fill texture and the mapping from screen to texture for the threed texture renderer (FillMode = THREEDTEXTURED) */
        void SetFillThreeDTexture(const Bitmap32 *texturebitmap, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc);

        /** SetFillMode - sets the filling mode (SOLID, TEXTURED, THREEDTEXTURED) */
        void SetFillMode(const FillMode mode);
        //ADDME: Need a GetFillMode to get current fill mode

        /** SetOutlineColor - sets the color for drawing outlines (OutlineMode = SOLID) */
        void SetOutlineColor(const Pixel32 &color);

        /** SetPolyEdgeMode - sets the poly filler mode to Alternate or Winding */
        void SetPolyEdgeMode(bool alternate);

        /** SetOutlineTexture - sets the outline texture (OutlineMode = TEXTURED) */
        void SetOutlineTexture(const Bitmap32 *texturebitmap, const IPoint &offset);

        /** SetOutlineMode - sets the outline mode (SOLID, TEXTURED, THREEDTEXTURED) */
        void SetOutlineMode(FillMode mode);

        /** SetFillTreeDTexture - set the fill texture and the mapping from screen to texture for the threed texture renderer (FillMode = THREEDTEXTURED) */
        void SetOutlineThreeDTexture(const Bitmap32 *texturebitmap, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc);

        /** SetOutlineWidth - sets the width of the outline (in pixels) */
        void SetOutlineWidth(double pixels);

        /** Sets the polyline outline endcap style mode (default: OutlineEndRounded) */
        void SetOutlineEndcapMode(OutlineEndcapModes::Type mode);
        /** Sets the polyline outline join style mode (default: OutlineJoinRounded).
            Any outline join miter limit will get reset. See also 'SetOutlineJoinMiterLimit'. */
        void SetOutlineJoinMode(OutlineJoinModes::Type mode);
        /** Sets the miter limit used when joining lines in miter mode.
            @param limit The limit, should be positive. A negative value removes any limit. */
        void SetOutlineJoinMiterLimit(double limit);
        /** Resets/removes any miter limit used when joining lines in miter mode, if any is set. */
        void ResetOutlineJoinMiterLimit();

        /**
         * Sets the line-dashing for all outline drawing. The default for a
         * DrawObject is no dashing.
         *
         * @param length The length of the array of parameter 'style'.
         * It must be even and at least 2.
         * @param style Points to an array of lengths. The first length
         * is the length of the forst dash, in pixels. The second is the
         * space till the start of the next dash. And so on. Warning:
         * When ont or more of the lengths is (very) close to zero,
         * Rendering can end up in a endless loop! Lengths of at least
         * one are preferred.
         */
        void SetOutlineDashing(uint32_t length, uint32_t *style);
        /**
         * Resets any dashing, set with the member function 'SetOutlineDashing'.
         */
        void ResetOutlineDashing()
        {
                outline_dash_style.reset(NULL);
                outline_dash_style_length = 0;
        }

        /** GetCanvas - get a const pointer to the DrawObject's canvas32 object. */
        Canvas32 const* GetCanvas() const
                {return mycanvas;};

        /** GetCanvasNonConstPtr - get a non const pointer to the DrawObject's canvas32 object. */
        Canvas32* GetCanvasNonConstPtr()
                {return mycanvas;};

        /** Exchange - replace the canvas32 with a new one and return the original pointer
            throws exception when given a NULL-pointer. */
        Canvas32* Exchange(Canvas32 *newcanvas);

        //------------------------------------------------------------------------
        // PATH FUNCTIONS
        //------------------------------------------------------------------------

        /** StrokePath - 'Stroke' (=draw) a path using the outline renderer */
        void StrokePath(Path const &thispath);

        /** FillPath - Fill a path using the filler */
        void FillPath(Path const &thispath);

        /** StrokeAndFillPath - fill and stroke a path */
        void StrokeAndFillPath(Path const &thispath);

        /** FillPath - Stroke and/or Fill a path using the filler */
        void StrokeFillPath(Path const &thispath, bool stroke, bool fill);

        /** PathToProtectionRegion - set a path as the protection region (NOT IMPLEMENTED YET!)*/
        void PathToProtectionRegion();

private:
        /** Calculates how many segments to use (if you draw an ellipse)
            Basically, just calculates the maximum error per segment.
            A triangle is drawn useing the center and 2 following arcpoints. The max distance
            between the line of the triangle connection the two arcpoints and the ellipseborder
            should be epsilon.
          */
        int CalcNumberOfEllipseSegments(double xradius, double yradius);

        /** Generates arc points. They are returned in order from strartradial to endradial
            Automatically detects how many points to use.
            @param centerpoint  The center of the ellips where the arc is on
            @param radius       The radius in x direction and y direction.
            @param startradial  The startradial. Radials are meausured just as normal maths
                                (be aware of the y-axis is the drawlib system down NOT
                                 follow the normal maths).

                                The arc is always drawn in ascending order:
                                IF the startradial is 0.5Pi and the endradial Pi,
                                The arc is a quarter of an ellipse.
                                IF the startradial is Pi and the endradial 0.5Pi,
                                The arc is three quarters of an ellipse.

                                So: 0 =         0----

                                                |
                                    0.5*Pi      |
                                                0

                                    Pi      ----0

                                                0
                                    1.5*Pi      |
                                                |

            @param endradial    The end radial. See startradial for more detail
        */

        DrawLib::PolyLine GenerateArc(const FPPoint &centerpoint, const FPSize &radius, double startradial, double endradial);

        double ConvertPoints2Rad(const FPPoint &centerpoint, const FPSize &size, const FPPoint &point_on_circle);

        Canvas32                *mycanvas;

        //ADDME: Isn't construction of objects such as below a bit too heavy? eg, can't the functions just construct the necessary objects on their stack?
        PolyRenderer            polyrenderer;
        ThickOutlineRenderer    outlinerenderer;

        // Empty texture for default TexturedPolyCallback
        static Bitmap32         empty_texture;

        // All polygon callbacks
        SolidPolyCallback       fill_solidpolycallback;
        TexturedPolyCallback    fill_texturedpolycallback;
        ThreeDTexturedPolyCallback fill_threedtexturedpolycallback;

        SolidPolyCallback       outline_solidpolycallback;
        TexturedPolyCallback    outline_texturedpolycallback;
        ThreeDTexturedPolyCallback outline_threedtexturedpolycallback;

        // textrenderer
        TextRenderer            renderer;

        // Currently active polyfiller callback
        PolyScanlineCallbackBase *current_fillcallback;
        PolyScanlineCallbackBase *current_outlinecallback;

        double                   outline_width;
        Pixel32                 outline_color;

        OutlineEndcapModes::Type outline_endcap_mode;
        OutlineJoinModes::Type  outline_join_mode;
        double                   outline_join_miter_limit;

        /**
         * This array contains the outline dashing style. When NULL, no dashing
         * is set. The first value is the length of the first dash, in pixels.
         * The second is the space till the start of the next dash. When not
         * NULL, the length must be even and at least 2.
         */
        std::unique_ptr<uint32_t[]> outline_dash_style;
        /** Contains the length of the array in field 'outline_dash_style'. */
        uint32_t                     outline_dash_style_length;

        bool                    polyedgemode_winding;
};

}
#endif
