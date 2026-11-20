#ifndef drawlib_path_h
#define drawlib_path_h

#include "drawlib_v2_types.h"
#include <vector>

namespace DrawLib
{

/** Used by DrawLib::Path to hold path segements*/
class BLEXLIB_PUBLIC PathSegment
{
public:
        /** Segment type enum */
        enum SegmentType {MOVETO, LINETO, ELLIPSE, CLOSE};

        /** type of path segment */
        SegmentType type;

        /** 0..n parameters of a segment */
        std::vector<FPPoint> parameters;

        PathSegment();
        ~PathSegment();
};

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

        /** Add an ellipse to the path (This is a closed and separate path in itself!)
            @param[in] center - the center point of the ellipse
            @param[in] axes   - the x width and y height of the ellipse
        */
        void Ellipse(FPPoint const &center, FPSize const &radius);

        /** Close a path by connecting the current point to the first point of the path */
        void ClosePath();

        /** Set the transformation of a path, the internal transformation is overwritten. */
        void SetTransform(XForm2D const &xform);

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

        std::vector<PathSegment> segments;
        XForm2D xform;
};

} // namespace

#endif
