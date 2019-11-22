#ifndef outlinerenderer_h
#define outlinerenderer_h

#include "drawlib_v2_types.h"
#include "polyrenderer.h"

namespace DrawLib
{

/** ThickOutlineRenderer - an internal class for DrawObject that generates polygons
 for lines with thickness greater than 1 pixel wide.
*/

class ThickOutlineRenderer
{
public:
        void GenerateOutlinePolyPolygon(PolyLine const &_line, double thickness,
                DrawLib::PolyPolygon *outline_poly_polygon,
                OutlineJoinModes::Type jmode, OutlineEndcapModes::Type emode,
                double miter_limit = -1) const;

private:
        void  CreatePolygonForLine(
                DrawLib::Polygon *polygon, OutlineJoinModes::Type jmode, OutlineEndcapModes::Type emode, double miter_limit, double thickness,
                bool end1, DrawLib::FPPoint const& point1, DrawLib::FPPoint const& vector1, DrawLib::FPPoint const& vectorm,
                bool end2, DrawLib::FPPoint const& point2, DrawLib::FPPoint const& vector2) const;
        void  CreateEndInPolygon(
                DrawLib::Polygon *polygon, OutlineEndcapModes::Type emode,  double thickness,
                DrawLib::FPPoint const& point, DrawLib::FPPoint const& vector) const;
        void  CreateJoinInPolygon(
                DrawLib::Polygon *polygon, OutlineJoinModes::Type jmode,  double thickness, double miter_limit,
                DrawLib::FPPoint const& point, DrawLib::FPPoint const& vector_o, DrawLib::FPPoint const& vector_i) const;



// From here funtionality used by the OLD and NEW outlinerendering:
private:
        double CCWAngle(const FPPoint &v1, const FPPoint &v2) const;
        double GetRelativeAngle(double a1, double a2) const;
        double AngleXAxis(const FPPoint &v) const;
        double SimpleAngle(const FPPoint &v1, const FPPoint &v2) const;
        void  AddArcPoints(std::vector<FPPoint> & output,  const FPPoint &center, double xradius, double yradius, double startradial, double endradial, bool reverse) const;

        /** Generate a vector from center(point) to direction(point), normalize it's length to '1' */
        FPPoint  NormalizedVector(const FPPoint &center, const FPPoint &direction) const;

        FPPoint  CalcBisectionalPoint(const FPPoint &v1, const FPPoint &v2, const FPPoint &center, double thickness, double sharp) const;

        double Inproduct(FPPoint const & a, FPPoint const & b) const
        {
                return a.x*b.x + a.y*b.y;
        }

        double SquareDistance(FPPoint const & a, FPPoint const & b) const
        {
                double dy = (a.y-b.y);
                double dx = (a.x-b.x);
                return dy*dy + dx*dx;
        }

        FPPoint Rotate90(FPPoint const& v) const
        {
                return FPPoint(v.y, -v.x);
        }

        FPPoint Neg(FPPoint const& v) const
        {
                return FPPoint(-v.x, -v.y);
        }
};

}
#endif
