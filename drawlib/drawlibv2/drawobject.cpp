#include <drawlib/drawlibv2/allincludes.h>

#include <blex/utils.h>
#include "drawobject.h"

namespace DrawLib
{

Bitmap32 DrawObject::empty_texture(1,1);

DrawObject::DrawObject(Canvas32 *canvas) : mycanvas(canvas),
        fill_texturedpolycallback(&empty_texture),
        current_fillcallback(&fill_solidpolycallback),
        outline_endcap_mode(OutlineEndcapModes::Rounded),
        outline_join_mode(OutlineJoinModes::Rounded)
{
        if (mycanvas==NULL)
                throw std::runtime_error("Tried to make DrawObject with NULL-canvas");

        SetOutlineWidth(1.0);
        SetFillMode(SOLID);
        SetFillColor(Pixel32(0xFF,0xFF,0xFF,0xFF));
        SetOutlineColor(Pixel32(0xFF,0xFF,0xFF,0xFF));
}

void DrawObject::SetFillMode(FillMode mode)
{
        switch(mode)
        {
        case TEXTURED:
                current_fillcallback = &fill_texturedpolycallback;
                break;
        case SOLID:
        default:
                current_fillcallback = &fill_solidpolycallback;
                break;
        }
}

void DrawObject::SetOutlineWidth(double width)
{
        outline_width = width;
}

void DrawObject::DrawPolyLine(PolyLine const& line)
{
        double thickness = outline_width;

        // check if this is really a line!
        if (!line.IsValid())
                throw(std::runtime_error("DrawObject::DrawPolyLine called with less than 2 points"));

        //skip invisible lines
        if (thickness <= 0.0)
                return;

        //Draw at least with thickness of 1 since we don't have AA (yet)
        if (thickness < 1.0)
            thickness = 1.0;

        //Rounded joins for small lines only cause trouble
        if (thickness == 1.0)
        {
            outline_endcap_mode = OutlineEndcapModes::Flat;
            outline_join_mode = OutlineJoinModes::Miter;
        }

        DrawLib::PolyPolygon outline_poly_polygon;

        outlinerenderer.GenerateOutlinePolyPolygon(line
                                                 , thickness
                                                 , &outline_poly_polygon
                                                 , outline_join_mode
                                                 , outline_endcap_mode
                                                 , -1 /* no miter limit */);

        polyrenderer.DrawPolygon(mycanvas, outline_poly_polygon, outline_solidpolycallback, true);
}

void DrawObject::SetFillColor(const Pixel32 &color)
{
        fill_solidpolycallback.SetFillColor(color);
}

void DrawObject::SetOutlineColor(const Pixel32 &color)
{
        outline_solidpolycallback.SetFillColor(color);
}

void DrawObject::SetFillTexture(const Bitmap32  *texturebitmap, const IPoint &offset)
{
        fill_texturedpolycallback.SetTexture(texturebitmap, offset);
}

void DrawObject::DrawIntegerPixel(int x, int y, const Pixel32 &pixel)
{
        if (x < 0 || unsigned(x) >= mycanvas->GetWidth() || y < 0 || unsigned(y) >= mycanvas->GetHeight())
            return;

        //ADDME: later add pixel setting methods so we don't need to construct a scanline object.
        Scanline32 scanline(mycanvas->GetWidth(), false);       // create a scanline
        scanline.SetMask(x, true);                        // set the mask for the pixel!
        scanline.Pixel(x) = pixel;                  // set the pixel color
        mycanvas->SetScanline32(y, &scanline);       // write the scanline to the canvas
}

void DrawObject::DrawPixel(const FPPoint &position, const Pixel32 &pixel)
{
        DrawIntegerPixel(RoundFloat(position.x), RoundFloat(position.y), pixel);
}

Path DrawObject::CreateEllipsePath(const FPPoint &centerpoint, const FPSize &radius)
{
        Path path;
        path.MoveTo(centerpoint);
        path.Ellipse(centerpoint, radius);
        path.ClosePath();
        return path;
}

void DrawObject::DrawEllipse(const FPPoint &centerpoint, const FPSize &radius)
{
        StrokeFillPath(CreateEllipsePath(centerpoint, radius), false, true);
}

void DrawObject::DrawEllipseOutline(const FPPoint &centerpoint, const FPSize &radius)
{
        StrokeFillPath(CreateEllipsePath(centerpoint, radius), true, false);
}

Path DrawObject::CreateRectanglePath(const FPPoint &upperleft, const FPPoint &lowerright)
{
        Path path;
        path.MoveTo(upperleft);
        path.LineTo(DrawLib::FPPoint(lowerright.x, upperleft.y));
        path.LineTo(lowerright);
        path.LineTo(DrawLib::FPPoint(upperleft.x, lowerright.y));
        path.ClosePath();

        return path;
}

void DrawObject::DrawRectangle(const FPPoint &upperleft, const FPPoint &lowerright)
{
        StrokeFillPath(CreateRectanglePath(upperleft, lowerright), false, true);
}

void DrawObject::StrokeFillPath(Path const &thispath, bool stroke, bool fill)
{
        // Nothing to do
        if (!stroke && !fill)
          return;

        std::vector<PolyLine> polylines;
        thispath.ConvertToPolylines(&polylines);
        unsigned numpolylines = polylines.size();

        if (fill)
        {
                PolyPolygon pp;
                for(unsigned i = 0; i < numpolylines; i++)
                {
                        // Is the path closed and formed a valid polygon??
                        if (polylines[i].IsValid() && polylines[i].is_closed && polylines[i].points.size() > 2)
                        {
                                DrawLib::Polygon polygon;
                                polygon.points.resize(polylines[i].points.size());
                                std::copy(polylines[i].points.begin(), polylines[i].points.end(),
                                        polygon.points.begin());

                                pp.polygons.push_back(polygon);
                        }
                }
                if (!pp.polygons.empty())
                    polyrenderer.DrawPolygon(mycanvas, pp, *current_fillcallback, false);
        }

        if (stroke)
        {
                for(unsigned i = 0; i < numpolylines; i++)
                {
                        // In rare cases WMF inserts empty paths. It does this by directly
                        // closing a path. At those paths empty (and thus invalid) PolyLines
                        // emerge. We have to check for this.
                        if(polylines[i].IsValid())
                                DrawPolyLine(polylines[i]);
                }
        }
}

} //end namespace DrawLib
