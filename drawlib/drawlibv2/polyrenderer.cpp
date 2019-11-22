#include <drawlib/drawlibv2/allincludes.h>


#include <blex/utils.h>
#include <cmath>
#include "polyrenderer.h"

namespace DrawLib
{

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
     PolyScanlineCallbackBase stuff
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

PolyScanlineCallbackBase::~PolyScanlineCallbackBase()
{
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
     Polygon & PolyPolygon stuff
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

bool Polygon::IsValid() const
{
        if (points.size() <= 2)
           return false;
        for (unsigned i = 0; i < points.size(); ++i)
          if (!points[i].IsValid())
            return false;

        return true;
}

bool PolyPolygon::IsValid() const
{
        if (polygons.size() < 1)
            return false;
        for(unsigned i = 0; i < polygons.size(); i++)
        {
                if (polygons[i].IsValid() == false)
                        return false;
        }
        return true;
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
     SolidPolyCallback stuff
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

void SolidPolyCallback::GenerateScanline(int startx, int limitx, int, Scanline32 *scanline)
{
        if (startx > limitx) std::swap(startx, limitx);

        if (limitx <= 0 || startx >= (int)scanline->GetWidth())
            return; //scanline is invisible, ignore

        startx = Blex::Bound<int>(0, scanline->GetWidth(), startx);
        limitx = Blex::Bound<int>(0, scanline->GetWidth(), limitx);
        if (startx > limitx)
            throw std::runtime_error("Received reversed scanline for solid polygon rendering");

        std::fill_n(scanline->GetRawPixels() + startx, limitx - startx, color);
        Blex::SetBits(scanline->GetRawMask(), startx, limitx - startx, true);
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
     TexturedPolyCallback stuff
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
void TexturedPolyCallback::GenerateScanline(int startx, int limitx , int y, Scanline32 *scanline)
{
        if (startx > limitx) std::swap(startx, limitx);

        if (limitx <= 0 || startx >= (int)scanline->GetWidth())
            return; //scanline is invisible, ignore

        startx=Blex::Bound<int>(0,scanline->GetWidth(),startx);
        limitx=Blex::Bound<int>(0,scanline->GetWidth(),limitx);
        if (startx>limitx)
            throw std::runtime_error("Received reversed scanline for solid polygon rendering");

        // draw..
        uint32_t texturewidth  = texture->GetWidth();
        uint32_t textureheight = texture->GetHeight();

        const Scanline32 &texturescanline = texture->GetScanline32((y - offset.y) % textureheight);
        for(int x = startx; x < limitx; x++)
            scanline->Pixel(x) = texturescanline.Pixel((x - offset.x) % texturewidth);

        Blex::SetBits(scanline->GetRawMask(), startx, limitx - startx, true);
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
     ThreeDTexturedPolyCallback stuff
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
void ThreeDTexturedPolyCallback::GenerateScanline(int startx, int limitx , int y, Scanline32 *scanline)
{
        if (startx > limitx) std::swap(startx, limitx);

        if (limitx <= 0 || startx >= (int)scanline->GetWidth())
            return; //scanline is invisible, ignore

        startx=Blex::Bound<int>(0,scanline->GetWidth(),startx);
        limitx=Blex::Bound<int>(0,scanline->GetWidth(),limitx);

        int32_t texturewidth  = texture->GetWidth();
        int32_t textureheight = texture->GetHeight();

        // Calculate su, sv & sz at startx
        double su = sufunc.Calc(startx, y);
        double sv = svfunc.Calc(startx, y);
        double sz = szfunc.Calc(startx, y);

        DEBUGPRINT("ThreeDTexturedPolyCallback::GenerateScanline");

        // sz won't change as x increases, uses quick path that loses some divisions
        if (szfunc.a == 0)
        {
                if (fabs(sz) < 0.00001)
                    return;

                // Calculate z, u and v at start point, plus the differences per pixel
                double z = 1 / sz;
                double u = su * z + 0.00001; // For rounding errors
                double v = sv * z + 0.00001; // For rounding errors

                double du = sufunc.a * z;
                double dv = svfunc.a * z;

                for (int x = startx; x < limitx; x++)
                {
                        if (u < 0 || u >= texturewidth)
                            u -= static_cast< int32_t >(floor(u /  texturewidth) * texturewidth);
                        if (v < 0 || v >= textureheight)
                            v -= static_cast< int32_t >(floor(v /  textureheight) * textureheight);

                        int32_t int_u = static_cast< int32_t >(u);
                        int32_t int_v = static_cast< int32_t >(v);

                        if (int_u < 0 || int_u >= texturewidth)
                            int_u = 0;
                        if (int_v < 0 || int_v >= textureheight)
                            int_v = 0;

                        const Scanline32 &texturescanline = texture->GetScanline32(int_v);
                        scanline->Pixel(x) = texturescanline.Pixel(int_u);

                        u += du;
                        v += dv;
                }
        }
        else
        {
                for(int x = startx; x < limitx; x++)
                {
                        // sz too small: bail out
                        if (fabs(sz) < 0.000001)
                            continue;

                        // Calc u & v for this point
                        float z = 1 / sz;
                        float u = su*z + 0.00001; // for rounding errors
                        float v = sv*z + 0.00001; // for rounding errors

                        // Bring within texture size
                        u -= static_cast< int32_t >(floor(u /  texturewidth) * texturewidth); // for rounding errors
                        v -= static_cast< int32_t >(floor(v /  textureheight) * textureheight); // for rounding errors

                        int32_t int_u = static_cast< int32_t >(u);
                        int32_t int_v = static_cast< int32_t >(v);

                        if (int_u < 0 || int_u >= texturewidth)
                            int_u = 0;
                        if (int_v < 0 || int_v >= textureheight)
                            int_v = 0;

                        const Scanline32 &texturescanline = texture->GetScanline32(int_v);
                        scanline->Pixel(x) = texturescanline.Pixel(int_u);

                        // Calculate su, sv & sz for next x pixel
                        su += sufunc.a;
                        sv += svfunc.a;
                        sz += szfunc.a;
                }
        }

        // Mark bits as drawn
        Blex::SetBits(scanline->GetRawMask(), startx, limitx - startx, true);
}





/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
     PolyRenderer stuff
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

bool PolyRenderer::AugmentedPointSort(const AugmentedPoint& p1, const AugmentedPoint& p2)
{
        return (p1.point.y < p2.point.y);
}

bool PolyRenderer::ActiveEdgeXSort(const Edge& e1, const Edge& e2)
{
        return (e1.x < e2.x);
}

void PolyRenderer::delete_vertex(int i)
{
        for(unsigned j = 0; j < active_edgelist.size(); j++)
        {
                if (active_edgelist[j].i == i)
                {
                        active_edgelist.erase(active_edgelist.begin() + j);
                        break;
                }
        }
}

void PolyRenderer::insert_vertex(int i, int y)
{
//        int num_vertices = pointlist.size();
        int p = 0;
        int q = 0;
        // j is next vertex
        int j = pointlist[i].next_index;

        if (pointlist[i].point.y < pointlist[j].point.y)
        {
                p = i;
                q = j;
        }
        else
        {
                p = j;
                q = i;
        }
        // initialize x position at intersection of edge with scanline y
        double denom = pointlist[q].point.y - pointlist[p].point.y;
        if (fabs(denom) > 0.00001)
        {
                Edge my_edge;
                my_edge.dx = (pointlist[q].point.x - pointlist[p].point.x) / (denom);
                my_edge.x  = my_edge.dx * ((double)y - pointlist[p].point.y) + pointlist[p].point.x;
                my_edge.i  = i;
                active_edgelist.push_back(my_edge);
        }
}

void PolyRenderer::DrawPolygonToProtection(DrawLib::Canvas32 *canvas, const DrawLib::PolyPolygon &polypolygon,
                PolyScanlineCallbackBase &callback, bool winding)
{
        DrawPolygonInternal(canvas, polypolygon, callback, winding, true);
}

void PolyRenderer::DrawPolygon(DrawLib::Canvas32 *canvas, const DrawLib::PolyPolygon &polypolygon,
        PolyScanlineCallbackBase &callback, bool winding)
{
        DrawPolygonInternal(canvas, polypolygon, callback, winding, false);
}


void PolyRenderer::DrawPolygonInternal(DrawLib::Canvas32 *canvas, const DrawLib::PolyPolygon &polypolygon,
        PolyScanlineCallbackBase &callback, bool winding, bool /*set_protection*/)
{
        //Put the polygon points into a a vertex list

        pointlist.clear();
        active_edgelist.clear();
        // create y-sorted array of indices ind[k] into vertex list..

        if (polypolygon.IsValid() == false)
        {
                DEBUGPRINT("*** PolyPolygon reports an invalid polygon list.");
                return; // don't throw here -- too heavy..
        }

        int VertexCounter = 0;
        for(unsigned int poly = 0; poly < polypolygon.polygons.size(); poly++)
        {
                if (polypolygon.polygons[poly].points.empty())
                    continue;

                int startvertex = VertexCounter;

                AugmentedPoint apoint;
                // add all the points from the polygon to the augmented pointlist.
                for(unsigned int i = 0; i < polypolygon.polygons[poly].points.size(); i++)
                {
                        apoint.point = polypolygon.polygons[poly].points[i];
                        //Reduce precision of the point to prevent drawing errors due to roundings
                        apoint.point.x = floor(apoint.point.x * 8.0 + 0.5) / 8.0;
                        apoint.point.y = floor(apoint.point.y * 8.0 + 0.5) / 8.0;
                        apoint.prev_index = VertexCounter - 1;
                        apoint.vertex_index = VertexCounter++;
                        apoint.next_index = VertexCounter;

                        pointlist.push_back(apoint);
                }

                // close the polygon by connecting the first and last point
                pointlist[startvertex].prev_index = VertexCounter - 1;
                pointlist.back().next_index = startvertex;
        }

        if (pointlist.empty()) // bail if no points
            return;

        // sort vertex_index_list according to points[vertex_index_list[k]].y
        pointlist_sorted = pointlist;
        std::sort(pointlist_sorted.begin(), pointlist_sorted.end(), AugmentedPointSort);

        // start processing...
        unsigned n = pointlist.size();
        unsigned k = 0;

        // First and last scanline to draw
        int y_min = std::max<int32_t>(static_cast<int32_t>(ceil(pointlist_sorted.front().point.y)), 0L);
        int y_max = std::min<int32_t>(static_cast<int32_t>(ceil(pointlist_sorted.back().point.y)) - 1, static_cast<int32_t>(canvas->GetHeight() - 1));

        // get a temporary scanline for generating horizontal spans!
        Scanline32 tempscanline(canvas->GetWidth(), false);
        for(int y = y_min; y <= y_max; y++) //step through scanlines
        {
                // Check vertices between previous scanline and current one, if any
                for (; k < n && (pointlist_sorted[k].point.y <= (double)y); ++k)
                {
                        unsigned i = pointlist_sorted[k].vertex_index;
                        unsigned j = pointlist_sorted[k].prev_index;

                        // insert or delete edges before and after vertex i
                        // from active list if they cross scanline y!
                        if (pointlist[j].point.y <= (y - 1))
                            delete_vertex(j);
                        else if (pointlist[j].point.y > y)
                            insert_vertex(j, y);

                        j = pointlist_sorted[k].next_index;

                        if (pointlist[j].point.y <= (y - 1))
                            delete_vertex(i);
                        else if (pointlist[j].point.y > y)
                            insert_vertex(i, y);
                }

                // sort active edge list by x-coordinate
                std::sort(active_edgelist.begin(), active_edgelist.end(), ActiveEdgeXSort);

                //set all the pixels to not_to_be_drawn_mode
                //FIXME: Need a fast mask setter: std::fill_n(tempscanline.GetRawMask(), tempscanline.GetWidth(), Scanline32::NO_DRAW);
                Blex::SetBits(tempscanline.GetRawMask(), 0, tempscanline.GetWidth(), false);

                // generate horizontal scanlines!
                // we may draw more than one span simultaneously!!
                if (winding)
                {
                        int wnum = 0;
                        int x_start = 0;
                        bool startstop = true;
                        for(unsigned j = 0; j < active_edgelist.size(); j++)
                        {
                                int index = active_edgelist[j].i;

                                // check the y-direction of the edge.
                                double ydir = pointlist[pointlist[index].next_index].point.y - pointlist[index].point.y;
                                // if the winding number is zero here,
                                if ((wnum == 0) && startstop)
                                {
                                        x_start = ceil(active_edgelist[j].x);
                                        startstop = false;
                                }
                                else
                                {
                                        int x_end = ceil(active_edgelist[j].x);
                                        callback.GenerateScanline(x_start, x_end, y, &tempscanline); //FIXME: Texture offsetting.
                                        startstop = true;
                                }

                                if (ydir > 0.0)
                                        wnum++;
                                else
                                        wnum--;

                                active_edgelist[j].x += active_edgelist[j].dx;
                        }
                        canvas->SetScanline32(y, &tempscanline);
                }
                else
                {
                        for(unsigned j = 0; j + 1 < active_edgelist.size(); j += 2)
                        {
                                int x_left = ceil(active_edgelist[j].x);
                                int x_right = ceil(active_edgelist[j + 1].x);

                                // generate a span here...
                                if (x_left <= x_right)
                                {
                                        //clamp the left x-coordinat to '0' if negative.
                                        if (x_left < 0)
                                                x_left = 0;
                                        //if the right point is left of '0'.. skip the scanline!
                                        if (x_right >= 0)
                                                callback.GenerateScanline(x_left, x_right, y, &tempscanline); //FIXME texture offsetting
                                }

                                active_edgelist[j].x += active_edgelist[j].dx;
                                active_edgelist[j + 1].x += active_edgelist[j + 1].dx;
                        }
                        // now, actually draw the scanline!
                        canvas->SetScanline32(y, &tempscanline);
                }
        }
}

} // end namespace DrawLib
