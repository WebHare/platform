#include <drawlib/drawlibv2/allincludes.h>



#include "segmentcalculator.h"
#include "outlinerenderer.h"

#include <cmath>

namespace DrawLib {

void ThickOutlineRenderer::GenerateOutlinePolyPolygon(PolyLine const &polyline, double thickness,
        DrawLib::PolyPolygon *outline_poly_polygon,
        OutlineJoinModes::Type jmode, OutlineEndcapModes::Type emode,
        double miter_limit) const
{
        if(!outline_poly_polygon)
                throw std::runtime_error("ThickOutlineRenderer::GenerateOutlinePolyPolygon: Parameter outline_poly_polygon is NULL.");
        if(!polyline.IsValid())
                throw std::runtime_error("ThickOutlineRenderer::GenerateOutlinePolyPolygon: PolyLine parameter is invalid.");

        //eliminate sequentional double points !!!!!
        std::vector<FPPoint> uniquepoints(polyline.points);
        uniquepoints.erase(std::unique(uniquepoints.begin(), uniquepoints.end()), uniquepoints.end());

        //eleminate duplicate begin and end points for closed paths
        if (!uniquepoints.empty() && polyline.is_closed)
        {
            if (*uniquepoints.begin() == *uniquepoints.rbegin())
              uniquepoints.pop_back();
        }

        // Clear the output poly polygon:
        outline_poly_polygon->polygons.clear();

        if (uniquepoints.size() < 2)
                return;

        thickness /= 2.0;

        // Create all normalized vectors, pointing from one point to the next one:
        std::vector<DrawLib::FPPoint> normalized_vectors;
        normalized_vectors.resize(uniquepoints.size());

        // ... iterate all points and add a vector here:
        std::vector<DrawLib::FPPoint>::const_iterator p_ci = uniquepoints.begin(); // Read
        std::vector<DrawLib::FPPoint>::iterator v_i = normalized_vectors.begin(); // Write
        DrawLib::FPPoint previous_point = *uniquepoints.rbegin();
        while(p_ci != uniquepoints.end())
        {
                *v_i = NormalizedVector(previous_point, *p_ci);

                previous_point = *p_ci;
                ++p_ci;
                ++v_i;
        }


        // Now add a polygon to the poly polygon for each (connection between two) point(s):
        DrawLib::FPPoint previous_vector1, previous_vector2;
        std::vector<DrawLib::FPPoint>::const_iterator v_ci; // Read
        if(polyline.is_closed)
        {
                p_ci = uniquepoints.begin();
                previous_point = *uniquepoints.rbegin();

                previous_vector1 = *normalized_vectors.rbegin();
                previous_vector2 = *normalized_vectors.begin();
                v_ci = normalized_vectors.begin() + 1;

                outline_poly_polygon->polygons.resize(uniquepoints.size());
        }
        else
        {
                p_ci = uniquepoints.begin() + 1;
                previous_point = *uniquepoints.begin();

                previous_vector1 = *normalized_vectors.begin();
                previous_vector2 = normalized_vectors[1];
                v_ci = normalized_vectors.begin() + 2;
                if(v_ci == normalized_vectors.end())
                    v_ci = normalized_vectors.begin();

                outline_poly_polygon->polygons.resize(uniquepoints.size() - 1);
        }

        std::vector<DrawLib::Polygon>::iterator poly_i = outline_poly_polygon->polygons.begin();

        DrawLib::Polygon polygon;
        bool first = true;
        while(p_ci != uniquepoints.end())
        {
                CreatePolygonForLine(&*poly_i
                                   , jmode
                                   , emode
                                   , thickness
                                   , miter_limit
                                   , first && !polyline.is_closed
                                   , previous_point
                                   , previous_vector1
                                   , previous_vector2
                                   , !polyline.is_closed && p_ci == uniquepoints.end() - 1
                                   , *p_ci
                                   , *v_ci);


                previous_point = *p_ci;
                first = false;
                ++p_ci;

                previous_vector1 = previous_vector2;
                previous_vector2 = *v_ci;
                if(++v_ci == normalized_vectors.end())
                        v_ci = normalized_vectors.begin();

                ++poly_i;
        }
}

void  ThickOutlineRenderer::CreatePolygonForLine(
        DrawLib::Polygon *polygon, OutlineJoinModes::Type jmode, OutlineEndcapModes::Type emode, double thickness, double miter_limit,
        bool end1, DrawLib::FPPoint const& point1, DrawLib::FPPoint const& vector1, DrawLib::FPPoint const& vectorm,
        bool end2, DrawLib::FPPoint const& point2, DrawLib::FPPoint const& vector2) const
{
        if(!polygon)
                throw std::runtime_error("ThickOutlineRenderer::CreatePolygonForLine: Parameter polygon is NULL.");

        // Let the points for the first side get added clockwise:
        if(end1)
                CreateEndInPolygon (polygon, emode, thickness, point1, Neg(vectorm));
        else
                CreateJoinInPolygon(polygon, jmode, thickness, miter_limit, point1, vector1, Neg(vectorm));


        // Let the points for the second side get added clockwise:
        if(end2)
                CreateEndInPolygon (polygon, emode, thickness, point2, vectorm);
        else
                CreateJoinInPolygon(polygon, jmode, thickness, miter_limit, point2, Neg(vector2), vectorm);
}

void  ThickOutlineRenderer::CreateEndInPolygon(
        DrawLib::Polygon *polygon, OutlineEndcapModes::Type emode,  double thickness,
        DrawLib::FPPoint const& point, DrawLib::FPPoint const& vector) const
{
        double vector_angle = AngleXAxis(vector);
        DrawLib::FPPoint p2;

        switch(emode)
        {
        case OutlineEndcapModes::Flat:
                p2 = point;
                p2.x += cos (vector_angle - M_PI_2) * thickness;
                p2.y += sin (vector_angle - M_PI_2) * thickness;
                polygon->points.push_back(p2);

                p2 = point;
                p2.x += cos (vector_angle + M_PI_2) * thickness;
                p2.y += sin (vector_angle + M_PI_2) * thickness;
                polygon->points.push_back(p2);
                return;


        case OutlineEndcapModes::Rounded:
                AddArcPoints(polygon->points, point, thickness, thickness,
                                vector_angle - M_PI_2,
                                vector_angle + M_PI_2, false);
                return;


        case OutlineEndcapModes::Square:
                // sqrt(2) ~= 1.414
                thickness *= 1.414;

                p2 = point;
                p2.x += cos (vector_angle - M_PI_4) * thickness;
                p2.y += sin (vector_angle - M_PI_4) * thickness;
                polygon->points.push_back(p2);

                p2 = point;
                p2.x += cos (vector_angle + M_PI_4) * thickness;
                p2.y += sin (vector_angle + M_PI_4) * thickness;
                polygon->points.push_back(p2);
                return;
        }
}

void  ThickOutlineRenderer::CreateJoinInPolygon(
        DrawLib::Polygon *polygon, OutlineJoinModes::Type jmode,  double thickness, double miter_limit,
        DrawLib::FPPoint const& point, DrawLib::FPPoint const& vector_o, DrawLib::FPPoint const& vector_i) const
{
        double vector_i_angle = AngleXAxis(vector_i);
        DrawLib::FPPoint p2;

        switch(jmode)
        {
        case OutlineJoinModes::Miter:
                {
                DrawLib::FPPoint sharp_point = CalcBisectionalPoint(vector_i, vector_o, point, thickness, true);

                // Is the miter limit exceeded ?:
                if(miter_limit > 0 && SquareDistance(point, sharp_point) > miter_limit * miter_limit)
                {
                        DrawLib::FPPoint p2 = point;
                        p2.x += cos (vector_i_angle - M_PI_2) * thickness;
                        p2.y += sin (vector_i_angle - M_PI_2) * thickness;
                        polygon->points.push_back(p2);

                        double vector_i_angle2 = AngleXAxis(vector_o);

                        p2 = point;

                        // Is the v2 vector is less than 180 degrees ?:
                        if (CCWAngle(vector_i,vector_o) > M_PI)
                        {
                                p2.x += cos (vector_i_angle2 + M_PI_2) * thickness;
                                p2.y += sin (vector_i_angle2 + M_PI_2) * thickness;
                                polygon->points.push_back(p2);
                        }
                        else
                        {
                                p2.x += cos (vector_i_angle2 + M_PI_2) * thickness;
                                p2.y += sin (vector_i_angle2 + M_PI_2) * thickness;
                                polygon->points.push_back(p2);
                        }

                        p2 = point;
                        p2.x += cos (vector_i_angle + M_PI_2) * thickness;
                        p2.y += sin (vector_i_angle + M_PI_2) * thickness;
                        polygon->points.push_back(p2);
                }


                // Miter limit not exceeded:
                else
                {
                        // Is the v2 vector is less than 180 degrees ?:
                        if (CCWAngle(vector_i,vector_o) > M_PI)
                        {
                                // First add the sharp point:
                                polygon->points.push_back(sharp_point);

                                // Second add the opposite point at the height of the point:
                                p2 = point;
                                p2.x += cos (vector_i_angle + M_PI_2) * thickness;
                                p2.y += sin (vector_i_angle + M_PI_2) * thickness;
                                polygon->points.push_back(p2);
                        }
                        else //if the v2 vector is less than 180 degrees, else swap 'm
                        {
                                // First add the opposite point at the height of the point:
                                p2 = point;
                                p2.x += cos (vector_i_angle - M_PI_2) * thickness;
                                p2.y += sin (vector_i_angle - M_PI_2) * thickness;
                                polygon->points.push_back(p2);

                                // Second add the sharp point:
                                polygon->points.push_back(CalcBisectionalPoint(vector_i, vector_o , point, thickness, true));
                        }
                }
                }
                return;


        case OutlineJoinModes::Rounded:
                {
                double vector_o_angle = AngleXAxis(vector_o * -1.0);

                // Bending in this join to the left or to the right:
                if (GetRelativeAngle(vector_i_angle,vector_o_angle) > M_PI)
                {
                        // Add the first point:
                        p2 = point;
                        p2.x += cos (vector_i_angle - M_PI_2) * thickness;
                        p2.y += sin (vector_i_angle - M_PI_2) * thickness;
                        polygon->points.push_back(p2);

                        AddArcPoints(polygon->points, point, thickness, thickness,
                                        vector_o_angle + M_PI_2,
                                        vector_i_angle + M_PI_2, false);
                }
                else
                {
                        AddArcPoints(polygon->points, point, thickness, thickness,
                                        vector_i_angle - M_PI_2,
                                        vector_o_angle - M_PI_2, false);

                        // Add the last point:
                        p2 = point;
                        p2.x += cos (vector_i_angle + M_PI_2) * thickness;
                        p2.y += sin (vector_i_angle + M_PI_2) * thickness;
                        polygon->points.push_back(p2);
                }
                }
                return;
       }
}


FPPoint ThickOutlineRenderer::NormalizedVector(const FPPoint &center, const FPPoint &direction) const
{
        if (direction==center)
                return FPPoint(0.0, 0.0) ;

        FPPoint vector = FPPoint (direction.x - center.x, direction.y - center.y);
        vector.Normalize();
        //FIXME: Rob, wat als Norm(vector)==0 ??? Kan niet zie if hierboven :)
        return vector;
}

FPPoint ThickOutlineRenderer::CalcBisectionalPoint(const FPPoint &v1, const FPPoint &v2, const FPPoint &center, double thickness, double sharp) const
{
                //vector result is always the sharp edge
                FPPoint result = FPPoint(v1.x + v2.x, v1.y + v2.y);

                //calculate the angle between the result vector and the x-axis.
                double angle = AngleXAxis(result);

                //the vectors v1 and v2 are normalized, so it will return a valid value
                double tempangle = SimpleAngle(v1, v2);

                //adjust tempangle to be the smallest possible angle (rotate and mirror if needed)
                if (tempangle < 0.0)
                        tempangle += 2.0 * M_PI;

                if (tempangle > M_PI)
                        tempangle = 2.0 * M_PI - tempangle;

                double sharpfactor         = sin(tempangle / 2.0);
                double sharppointlength;

                if (fabs(sharpfactor) * 100.0 > 1.0)
                        sharppointlength = thickness / sharpfactor ;
                else
                        sharppointlength = thickness ;


                if (sharp)
                {
                        return FPPoint (center.x + sharppointlength * cos(angle),
                                        center.y + sharppointlength * sin(angle) );
                }
                else
                {
                        return FPPoint (center.x - sharppointlength * cos(angle),
                                        center.y - sharppointlength * sin(angle) );
                }
}


double  ThickOutlineRenderer::SimpleAngle(const FPPoint &v1, const FPPoint &v2) const
{
        double divider = v1.Norm() * v2.Norm();
        double in      = Inproduct(v1, v2);

        if (in!=in) return 0.0;
        if (divider!=divider) return 0.0;
        //division by 0 check. Not nice, but it works.
        if (fabs(divider)<=0.00005) return 0.0;
        if (fabs(in     )<=0.00005) return acos(0);
        return acos (in/divider);

}

double ThickOutlineRenderer::AngleXAxis(const FPPoint &v) const
{

        double angle = SimpleAngle (v, FPPoint(1.0, 0.0));
        if (v.y <= 0)
                return 2.0 * M_PI - angle;
        else
                return angle;
}

double ThickOutlineRenderer::CCWAngle(const FPPoint &v1, const FPPoint &v2) const
{
        //get the angle from v1 to v2, if looking counter clockwise.
        //so if the angle of v2 = PI, and the angle of V1 = 1/2 * PI, the result is 1/2*PI

        //so if the angle of v1 = PI, and the angle of V2 = 1/2 * PI, the result is 3/2*PI

        double raw_angle = AngleXAxis(v2)-AngleXAxis(v1);

        if (raw_angle<0)
                raw_angle+=2.0*M_PI;
        return raw_angle; //want we werken ondersteboven :(
}

double ThickOutlineRenderer::GetRelativeAngle(double a1, double a2) const
{
        //get the relative angle between two angles a1 and a2, if looking counter clockwise.
        //so if the angle of a2 = PI, and the angle of a1 = 1/2 * PI, the result is 1/2*PI

        //so if the angle of a1 = PI, and the angle of a2 = 1/2 * PI, the result is 3/2*PI

        double raw_angle = a2 - a1;

        if (raw_angle<0)
                raw_angle+=2.0*M_PI;
        return raw_angle; //want we werken ondersteboven :(
}

void ThickOutlineRenderer::AddArcPoints(std::vector<FPPoint> & output,
        const FPPoint &center, double xradius, double yradius, double startradial, double endradial, bool reverse ) const
{
        //get the arc to fill
        double arc = endradial- startradial ;
        if (arc<0)
        {
                arc = 2.0 * M_PI + arc;
        }

        //get the number of segments needed to make a nice circle
        uint32_t  number_of_segments = GetNumberOfSegments(xradius, yradius);

        double rad;
        for (uint32_t part=0; part<=number_of_segments; part++)
        {
                //the radial is altered to slowly get form the startarc to the endarc
                if (reverse)
                        rad = (startradial + (arc * (double)(number_of_segments - part) / (double)number_of_segments));
                else
                        rad = (startradial + (arc * (double)part / (double)number_of_segments));

                //add the point to the given vector (at the end)
                output.push_back( FPPoint (
                                           center.x + xradius * cos (rad) ,
                                           center.y + yradius * sin (rad) //-, cos (pun) the y-axis is swapped
                                          ));
        }
}

} //end namespace DrawLib
