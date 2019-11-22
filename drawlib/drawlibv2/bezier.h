#ifndef bezier_h
#define bezier_h

#include "drawlib_v2_types.h"


namespace DrawLib
{
        /** EvaluateBezier - calculate a point on a Bezier curve with 2 control points.
            @param  start - the 2D starting point of the Bezier curve.
            @param  control1 - the first control point of the Bezier curve.
            @param  control2 - the second control point of the Bezier curve.
            @param  end - the 2D ending point of the Bezier curve.
            @param  t - the parametric position (0<t<=1)
            @return FPPoint containing the point on the Bezier curve.
        */

        FPPoint EvaluateBezier(const FPPoint &start, const FPPoint &control1,
                const FPPoint &control2, const FPPoint &end, double t);

        /** BezierListToPolyline - convert a list of bezier control points to a polyline
            @param bezierlist - a list of bezier points
            @param output     - a polyline that will receive the output
        */

        //void BezierListToPolyline(const PolyLine &bezierlist,
        //        DrawLib::PolyLine &output);
}


#endif

