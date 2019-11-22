#include <drawlib/drawlibv2/allincludes.h>


#include "bezier.h"
#include "drawpath.h"
#include "outlinerenderer.h"
#include "segmentcalculator.h"

using namespace DrawLib;

Path::Path()
{
        Reset();
}

Path::~Path()
{
}

bool Path::IsEmpty() const
{
        return segments.empty();
}

void Path::AddSegment(const PathSegment::SegmentType _type)
{
        PathSegment newsegment;
        newsegment.type = _type;
        segments.push_back(newsegment);
}

void Path::AddSegment(const PathSegment::SegmentType _type, FPPoint const &p1)
{
        PathSegment newsegment;
        newsegment.type = _type;
        newsegment.parameters.push_back(p1);
        segments.push_back(newsegment);
}

void Path::AddSegment(const PathSegment::SegmentType _type, FPPoint const &p1, FPPoint const &p2)
{
        PathSegment newsegment;
        newsegment.type = _type;
        newsegment.parameters.push_back(p1);
        newsegment.parameters.push_back(p2);
        segments.push_back(newsegment);
}

void Path::AddSegment(const PathSegment::SegmentType _type, FPPoint const &p1, FPPoint const &p2
        ,FPPoint const &p3)
{
        PathSegment newsegment;
        newsegment.type = _type;
        newsegment.parameters.push_back(p1);
        newsegment.parameters.push_back(p2);
        newsegment.parameters.push_back(p3);
        segments.push_back(newsegment);
}

void Path::Reset()
{
        segments.clear();
}

void Path::MoveTo(FPPoint const &point)
{
        //collapse multiple movetos..
        if(segments.size()>0 && segments[segments.size()-1].type == PathSegment::MOVETO)
            segments.erase(segments.end()-1);

        AddSegment(PathSegment::MOVETO, point);
}

void Path::LineTo(FPPoint const &point)
{
        AddSegment(PathSegment::LINETO, point);
}

void Path::BezierTo(FPPoint const &control1, FPPoint const &control2, FPPoint const &endpoint)
{
        AddSegment(PathSegment::BEZIERTO, control1, control2, endpoint);
}

void Path::Ellipse(FPPoint const &center, FPSize const &radius)
{
        AddSegment(PathSegment::ELLIPSE, center, FPPoint(radius.width, radius.height));
}

void Path::ArcTo(FPPoint const &center, FPSize const &radius, FPPoint const &endradial)
{
        AddSegment(PathSegment::ARCTO, center, FPPoint(radius.width, radius.height), endradial);
}

void Path::ArcToR(FPPoint const &center, FPSize const &radius, FPPoint const &endradial)
{
        AddSegment(PathSegment::ARCTO_R, center, FPPoint(radius.width, radius.height), endradial);
}

void Path::ClosePath()
{
        AddSegment(PathSegment::CLOSE);
}

void Path::Dump(std::ostream &output) const
{
        for(unsigned int i=0; i<segments.size(); i++)
        {
                segments[i].Dump(output);
        }
}

void Path::SetTransform(XForm2D const &_xform)
{
        xform = _xform;
}

void Path::ApplyTransform(XForm2D const &_xform)
{
        xform = xform*_xform;
}

/*******************************************************************************

        PathSegment

*******************************************************************************/

PathSegment::PathSegment()
{
}
PathSegment::~PathSegment()
{
}

void PathSegment::Dump(std::ostream &output) const
{
        switch(type)
        {
        case MOVETO:
                output << "MOVETO   : \n";
                output << "  point = (" << parameters[0].x << " , " << parameters[0].y << ")\n";
                break;
        case LINETO:
                output << "LINETO   : \n";
                output << "  point = (" << parameters[0].x << " , " << parameters[0].y << ")\n";
                break;
        case BEZIERTO:
                output << "BEZIERTO : \n";
                output << "  ctrl1 = (" << parameters[0].x << " , " << parameters[0].y << ")\n";
                output << "  ctrl2 = (" << parameters[1].x << " , " << parameters[1].y << ")\n";
                output << "  point = (" << parameters[2].x << " , " << parameters[2].y << ")\n";
                break;
        case ARCTO:
                output << "ARCTO    : \n";
                output << " center = (" << parameters[0].x << " , " << parameters[0].y << ")\n";
                output << "   axes = (" << parameters[1].x << " , " << parameters[1].y << ")\n";
                output << " endrad = (" << parameters[2].x << " , " << parameters[2].y << ")\n";
                break;
        case ARCTO_R:
                output << "ARCTO_R  : \n";
                output << " center = (" << parameters[0].x << " , " << parameters[0].y << ")\n";
                output << "   axes = (" << parameters[1].x << " , " << parameters[1].y << ")\n";
                output << " endrad = (" << parameters[2].x << " , " << parameters[2].y << ")\n";
                break;
        case ELLIPSE:
                output << "ELLIPSE  : \n";
                output << " center = (" << parameters[0].x << " , " << parameters[0].y << ")\n";
                output << "   axes = (" << parameters[1].y << " , " << parameters[1].y << ")\n";
                break;
        case CLOSE:
                output << "CLOSE    : \n";
                break;
        }
}

/*******************************************************************************

        Path segment conversion..

*******************************************************************************/

void Path::ConvertToPolylines(std::vector<PolyLine> *polylines) const
{
        PolyLine templine;
        FPPoint  lastpoint;
        FPPoint  lastpoint_noXFORM;
        if (polylines==NULL)
                throw(std::runtime_error("DrawLib::ConvertPathToPolylines was called with NULL argument"));

        for(unsigned int i=0; i<segments.size(); i++)
        {
                PathSegment const *mysegment = &(segments[i]);
                switch(mysegment->type)
                {
                case PathSegment::MOVETO:
                        // if there is a polyline, submit it to polylines..
                        // and reset.
                        if(i>0 && segments[i-1].type == PathSegment::MOVETO)
                                throw std::runtime_error("DrawLib::ConvertPathToPolylines: Cannot sequence MoveTos.");
                        if (!templine.points.empty())
                        {
                                if (templine.IsValid())
                                        polylines->push_back(templine);

                                templine.points.clear();
                                templine.is_closed = false;
                        }
                        // add the new move point!
                        lastpoint_noXFORM = mysegment->parameters[0];
                        lastpoint = mysegment->parameters[0]*xform;
                        templine.points.push_back(lastpoint);
                        break;
                case PathSegment::LINETO:
                        if (templine.points.empty())
                                throw(std::runtime_error("Path contains no starting point (use MoveTo first)"));
                        lastpoint_noXFORM = mysegment->parameters[0];
                        lastpoint = mysegment->parameters[0]*xform;
                        templine.points.push_back(lastpoint);
                        break;
                case PathSegment::BEZIERTO:
                        {
                                if (templine.points.empty())
                                        throw(std::runtime_error("Path contains no starting point (use MoveTo first)"));

                                FPPoint control1 = mysegment->parameters[0] * xform;
                                FPPoint control2 = mysegment->parameters[1] * xform;
                                FPPoint endpoint = mysegment->parameters[2] * xform;
                                FPPoint newpoint;
                                for(unsigned int t = 1; t < 20; t++)
                                {
                                        newpoint = EvaluateBezier(lastpoint, control1,
                                                control2, endpoint, static_cast<double>(t) / 20.);
                                        templine.points.push_back(newpoint);
                                }
                                lastpoint_noXFORM = mysegment->parameters[2];
                                templine.points.push_back(endpoint);
                                lastpoint = endpoint;
                        }
                        break;
                case PathSegment::ARCTO:
                case PathSegment::ARCTO_R:
                          {
                                if (templine.points.empty())
                                        throw(std::runtime_error("Path contains no starting point (use MoveTo first)"));

                                FPPoint center    = mysegment->parameters[0];
                                FPPoint endradial = mysegment->parameters[2];
                                FPPoint axes      = mysegment->parameters[1];
                                FPPoint axes_norm = axes;
                                FPPoint axes_abs (fabs(axes.x), fabs(axes.y));

                                if (axes_abs.x < 1e-10f || axes_abs.y < 1e-10f)
                                        break;

                                if(lastpoint_noXFORM == center)
                                        throw std::runtime_error("Path::ArcTo(R): The center point may not be the same as the last point.");
                                if(endradial         == center)
                                        throw std::runtime_error("Path::ArcTo(R): The end point may not be the same as the last point.");

                                axes_norm.Normalize();
                                double Angle1 = atan2( (-lastpoint_noXFORM.y + center.y) / axes_norm.y,
                                        (lastpoint_noXFORM.x - center.x) / axes_norm.x);

                                double Angle2 = atan2( (-endradial.y + center.y) / axes_norm.y,
                                        (endradial.x - center.x) / axes_norm.x);

                                // go clockwise!
                                if(mysegment->type == PathSegment::ARCTO && Angle2 > Angle1)
                                        Angle2 -= 2.0 * M_PI;

                                // go counter clockwise!
                                else if(mysegment->type == PathSegment::ARCTO_R && Angle2 < Angle1)
                                        Angle1 -= 2.0 * M_PI;

                                FPPoint transaxes = axes * xform;

                                uint32_t number_of_segments = 2 + GetNumberOfSegments(transaxes.x, transaxes.y) * (fabs(Angle2 - Angle1) / (2.0 * M_PI));
                                double dAngle = (Angle2 - Angle1) / number_of_segments;

                                FPPoint p;
                                for(unsigned int i = 1; i <= number_of_segments; i++)
                                {
                                        double a = Angle1 + dAngle * static_cast<double>(i);
                                        p = FPPoint(center.x + axes.x * cos(a), center.y - axes.y * sin(a));
                                        lastpoint = p * xform;
                                        templine.points.push_back(lastpoint);
                                }
                                lastpoint_noXFORM = p;
                        }
                        break;
                case PathSegment::ELLIPSE:
                        {
                                // commit the previous templine if not empty.
                                if (!templine.points.empty())
                                {
                                        if (templine.IsValid())
                                                polylines->push_back(templine);

                                        templine.points.clear();
                                        templine.is_closed = false;
                                }

                                //ADDME: should we round the center and/or axes?
                                FPPoint centerpoint(mysegment->parameters[0]);
                                FPPoint axes(mysegment->parameters[1]);

                                if(axes.x <= 0.0 || axes.y <= 0.0)
                                        throw std::runtime_error("Path::Ellipse: The radius must be bigger than 0.");

                                // Don't draw anything if the ellipse is impossible
                                if (axes.x > 1e-10f && axes.y > 1e-10f)
                                {

                                        FPPoint transaxes = axes * xform;

                                        uint32_t number_of_segments = GetNumberOfSegments(transaxes.x, transaxes.y);

                                        //get the arc to fill
                                        for (uint32_t part = 0; part < number_of_segments; part++)
                                        {
                                                //the radial is altered to slowly get form 0 to the arc (=2.0 PI)
                                                double rad = (M_PI * 2.0 * part / static_cast<double>(number_of_segments));

                                                //add the point to the given vector (at the end)
                                                FPPoint temp ( centerpoint.x - axes.x * cos(rad) ,
                                                       centerpoint.y - axes.y * sin(rad)); //-, cos (pun) the y-axis is swapped

                                                templine.points.push_back(temp * xform);
                                        }

                                        // close the ellipse!
                                        templine.Close();
                                        // commit the ellipse
                                        polylines->push_back(templine);
                                        templine.points.clear();
                                        templine.is_closed = false;
                                }
                        }
                        break;
                case PathSegment::CLOSE:
                        templine.Close();
                        if (templine.IsValid())
                          polylines->push_back(templine);
                        templine.points.clear();
                        templine.is_closed = false;
                        break;
                }
        }

        // close the line if begin and end are the same
        // ADDME: should this hack be in drawlib at all?
        if (templine.points.size() > 2 && templine.points.front() == templine.points.back())
             templine.is_closed = true;

        // commit the last line..
        if (templine.IsValid())
                polylines->push_back(templine);
}

DrawLib::FPPoint Path::GetLastPoint() const
{
        if (segments.empty() || segments.back().parameters.empty())
            return DrawLib::FPPoint(0.0, 0.0);
        return segments.back().parameters.back();
}

FPBoundingBox Path::GetPathBoundingBox(OutlineEndcapModes::Type outline_endcap_mode,
                                                OutlineJoinModes::Type  outline_join_mode,
                                                  double outline_width,
                                                  double  outline_join_miter_limit) const
{
        //TODO: expand path and determine bounding box!
        FPBoundingBox bbox;

        bbox.upper_left = FPPoint(1e20,1e20);
        bbox.lower_right = FPPoint(-1e20,-1e20);

        // get a copy of the PolyLine...
        std::vector<PolyLine> polylines;
        ConvertToPolylines(&polylines);
        unsigned numpolylines = polylines.size();

        if (outline_width <= 1.0)
        {
                // In case the line width is 1 or less, we add the pixels
                // with each point at its center

                for(unsigned int l = 0; l < numpolylines; l++)
                {
                        for(unsigned int i = 0; i<polylines[l].points.size(); i++)
                        {
                                DrawLib::FPPoint p = polylines[l].points[i];
                                bbox.ExtendTo(DrawLib::FPPoint(p.x - 0.5, p.y - 0.5));
                                bbox.ExtendTo(DrawLib::FPPoint(p.x + 0.5, p.y + 0.5));
                        }
                }
        }
        else
        {
                ThickOutlineRenderer  outlinerenderer;

                for(unsigned int l = 0; l < numpolylines; l++)
                {
                        PolyPolygon outline_poly_polygon;
                        outlinerenderer.GenerateOutlinePolyPolygon(polylines[l]
                                                                 , outline_width
                                                                 , &outline_poly_polygon
                                                                 , outline_join_mode
                                                                 , outline_endcap_mode
                                                                 , outline_join_miter_limit);

                        for(unsigned int j = 0; j < outline_poly_polygon.polygons.size(); j++)
                          for(unsigned int i = 0; i < outline_poly_polygon.polygons[j].points.size(); i++)
                            bbox.ExtendTo(outline_poly_polygon.polygons[j].points[i]);
                }
        }
        DEBUGPRINT(bbox);
        if (bbox.upper_left.x > bbox.lower_right.x)
            throw std::runtime_error("DrawLib:GetPathBoundingBox: calculating bounding box of an empty path");
        return bbox;
}

