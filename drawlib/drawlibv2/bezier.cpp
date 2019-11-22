#include <drawlib/drawlibv2/allincludes.h>


#include "bezier.h"

namespace DrawLib
{

DrawLib::FPPoint EvaluateBezier(const FPPoint &start, const FPPoint &control1,
        const FPPoint &control2, const FPPoint &end, double t)
{
        // check the parametric position.. clip if necessary..
        if (t<0.0) t = 0.0;
        if (t>1.0) t = 1.0;

        FPPoint P0 = start;
        FPPoint P1 = (start*-3.0) + (control1*3.0);
        FPPoint P2 = (start*3.0) + (control1*-6.0) + (control2*3.0);
        FPPoint P3 = (start*-1.0) + (control1*3.0) + (control2*-3.0) + end;

        FPPoint bpoint = (P0 + (P1*t) + (P2*(t*t)) + (P3*(t*t*t)));
        return bpoint;
}

/*
void DrawLib::BezierListToPolyline(const ::DrawLib::PolyLine &bezierlist,
                DrawLib::PolyLine &output)
{
        // check if the number of points is correct!
        if (((bezierlist.points.size()-1) % 3) != 0)
                throw(std::runtime_error("BezierListToPolyline called with wrong number of points"));

        if (bezierlist.points.size()==0)
                throw(std::runtime_error("BezierListToPolyline called with no points"));

        output.points.clear();
        int bezier_sections = (bezierlist.points.size()-1) / 3;

        FPPoint bstart = bezierlist.points[0];
        FPPoint c1     = bezierlist.points[1];
        FPPoint c2     = bezierlist.points[2];
        FPPoint bend   = bezierlist.points[3];
        int pcount = 3;
        for(unsigned int section=0; section<bezier_sections; section++)
        {
                for(unsigned int t=0; t<40; t++)
                {
                        output.points.push_back(
                                DrawLib::EvaluateBezier(bstart,c1,c2,bend, (double)t/40.0));
                }
                bstart = bezierlist.points[pcount++];
                c1     = bezierlist.points[pcount++];
                c2     = bezierlist.points[pcount++];
                bend   = bezierlist.points[pcount];     // ps: don't ++!
        }
}
*/

} //end namespace DrawLib



