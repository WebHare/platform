#ifndef drawlib_path_h
#define drawlib_path_h

#include "drawlib_v2_types.h"
#include <vector>
#include <ostream>

namespace DrawLib
{

/** Used by DrawLib::Path to hold path segements*/
class BLEXLIB_PUBLIC PathSegment
{
public:
        /** Segment type enum */
        enum SegmentType {MOVETO, LINETO, BEZIERTO, ARCTO, ARCTO_R, ELLIPSE, CLOSE};

        /** type of path segment */
        SegmentType type;

        /** 0..n parameters of a segment */
        std::vector<FPPoint> parameters;

        /** dump information about this path segment to 'output' ostream */
        void Dump(std::ostream &output) const;

        PathSegment();
        ~PathSegment();
};

class Path;


/** A class to build vector paths */
class BLEXLIB_PUBLIC Path
{
public:
        Path();
        ~Path();

        /** Move the current position to a specified point */
        void MoveTo(FPPoint const &point);

        /** Add a line to the path from the current point to a specified point */
        void LineTo(FPPoint const &endpoint);

        /** Add a bezier curve to the path from the current point to a specified point
           and two control points */
        void BezierTo(FPPoint const &control1, FPPoint const &control2, FPPoint const &endpoint);

        /** Add an arc curve to the path from the current point to a specified point
            An arc is a part of an ellipse. This ellipse is descriped by it's bounding box.
            This box is determined by the upper left and lower right coordinates.
            The start of the arc is determined by the intersection of a radial vector
            (from the center point of the ellipse to the current point) and the ellipse itself.
            Similarly, the end point of the arc is determined by the intersection of a radial vector
            (from the center point of the ellipse to the end point) and the ellipse itself.
            An arc is drawn from the start point to the end point in a clockwise direction.
        */
        void ArcTo (FPPoint const &center, FPSize const &radius, FPPoint const &endradial);
        /** Same as 'ArcTo', but draws the arc in COUNTER-clockwise direction. */
        void ArcToR(FPPoint const &center, FPSize const &radius, FPPoint const &endradial);

        /** Add an ellipse to the path (This is a closed and separate path in itself!)
            @param[in] center - the center point of the ellipse
            @param[in] axes   - the x width and y height of the ellipse
        */
        void Ellipse(FPPoint const &center, FPSize const &radius);

        /** Reset the path to a 'NULL' path */
        void Reset();

        /** Close a path by connecting the current point to the first point of the path */
        void ClosePath();

        /** Dump a path to an ostream */
        void Dump(std::ostream &output) const;

        /** Set the transformation of a path, the internal transformation is overwritten. */
        void SetTransform(XForm2D const &xform);

        /** Apply a transformation to a path, this transformation is combined with the internal transformation. */
        void ApplyTransform(XForm2D const &xform);

        /** Returns the current transformation of this path. */
        XForm2D GetCurrentTransform() const
        {
                return xform;
        }

        /** Are the segments in the current path? */
        bool IsEmpty() const;

        /** Get the last drawn point (ADDME: can it go away? it's needed now to get Escher's ArcTo to work) */
        DrawLib::FPPoint GetLastPoint() const;

        /** Get a path's boundingbox when it would be stroked with the current settings
            ADDME: Perhaps it would make sense, esp. if the number of parameters grows, to combine the state below into a PathRenderOptions structure or something similair?*/
        FPBoundingBox GetPathBoundingBox(OutlineEndcapModes::Type outline_endcap_mode,
                                                  OutlineJoinModes::Type  outline_join_mode,
                                                  double outline_width,
                                                  double  outline_join_miter_limit) const;

        /** Get a thin line path's bounding box (defaults all values to 1) */
        FPBoundingBox GetThinPathBoundingBox() const
        {
                return GetPathBoundingBox(OutlineEndcapModes::Square, OutlineJoinModes::Rounded, 1, -1);
        }

        /**
         * Converts this path object to polylines so they can get rendered.
         * The result strongly depends on the current transformation. It should
         * get used directly for rendering and especially not scaled in between.
         *
         * @param[out] polylines - a pointer to a vector of polylines.
         */
        void ConvertToPolylines(std::vector<PolyLine> *polylines) const;

private:
        /** Add a path segment with no arguments */
        void AddSegment(const PathSegment::SegmentType _type);
        /** Add a path segment with one argument */
        void AddSegment(const PathSegment::SegmentType _type, FPPoint const &p1);
        /** Add a path segment with two arguments */
        void AddSegment(const PathSegment::SegmentType _type, FPPoint const &p1,
                FPPoint const &p2);
        /** Add a path segment with three arguments */
        void AddSegment(const PathSegment::SegmentType _type, FPPoint const &p1,
                FPPoint const &p2, FPPoint const &p3);

        std::vector<PathSegment> segments;

        XForm2D xform;
};

} // namespace

#endif

