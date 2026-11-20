#include <drawlib/drawlibv2/allincludes.h>


#include "drawpath.h"
#include "segmentcalculator.h"

using namespace DrawLib;

Path::Path()
{
}

Path::~Path()
{
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

void Path::Ellipse(FPPoint const &center, FPSize const &radius)
{
        AddSegment(PathSegment::ELLIPSE, center, FPPoint(radius.width, radius.height));
}

void Path::ClosePath()
{
        AddSegment(PathSegment::CLOSE);
}

void Path::SetTransform(XForm2D const &_xform)
{
        xform = _xform;
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

/*******************************************************************************

        Path segment conversion..

*******************************************************************************/

void Path::ConvertToPolylines(std::vector<PolyLine> *polylines) const
{
        PolyLine templine;
        FPPoint  lastpoint;
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
                        lastpoint = mysegment->parameters[0]*xform;
                        templine.points.push_back(lastpoint);
                        break;
                case PathSegment::LINETO:
                        if (templine.points.empty())
                                throw(std::runtime_error("Path contains no starting point (use MoveTo first)"));
                        lastpoint = mysegment->parameters[0]*xform;
                        templine.points.push_back(lastpoint);
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
