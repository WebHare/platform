#include <drawlib/drawlibv2/allincludes.h>

#include <iostream>
#include <blex/utils.h>
#include "segmentcalculator.h"
#include "drawobject.h"

namespace DrawLib
{

Bitmap32 DrawObject::empty_texture(1,1);

DrawObject::DrawObject(Canvas32 *canvas) : mycanvas(canvas),
        fill_texturedpolycallback(&empty_texture),
        fill_threedtexturedpolycallback(&empty_texture),
        outline_texturedpolycallback(&empty_texture),
        outline_threedtexturedpolycallback(&empty_texture),
        current_fillcallback(&fill_solidpolycallback),
        current_outlinecallback(&outline_solidpolycallback),
        polyedgemode_winding(false)
{
        if (mycanvas==NULL)
                throw std::runtime_error("Tried to make DrawObject with NULL-canvas");

        SetOutlineWidth(1.0);
        SetFillMode(SOLID);
        SetFillColor(Pixel32(0xFF,0xFF,0xFF,0xFF));
        SetOutlineColor(Pixel32(0xFF,0xFF,0xFF,0xFF));
        SetOutlineEndcapMode(OutlineEndcapModes::Rounded);
        SetOutlineJoinMode(OutlineJoinModes::Rounded);
        ResetOutlineJoinMiterLimit();
}
Canvas32* DrawObject::Exchange(Canvas32 *newcanvas)
{
        if (newcanvas==NULL)
                throw(std::runtime_error("DrawObject::Exchange used with NULL-canvas"));

        Canvas32 *returncanvas = mycanvas;
        mycanvas = newcanvas;
        return returncanvas;
}

void DrawObject::SetFillMode(FillMode mode)
{
        switch(mode)
        {
        case SOLID:
                current_fillcallback = &fill_solidpolycallback;
                break;
        case TEXTURED:
                current_fillcallback = &fill_texturedpolycallback;
                break;
        case THREEDTEXTURED:
                current_fillcallback = &fill_threedtexturedpolycallback;
                break;
        default:
                current_fillcallback = &fill_solidpolycallback;
                break;
        }
}

void DrawObject::SetOutlineMode(FillMode mode)
{
        switch(mode)
        {
        case SOLID:
                current_outlinecallback = &outline_solidpolycallback;
                break;
        case TEXTURED:
                current_outlinecallback = &outline_texturedpolycallback;
                break;
        case THREEDTEXTURED:
                current_outlinecallback = &outline_threedtexturedpolycallback;
                break;
        default:
                current_outlinecallback = &outline_solidpolycallback;
                break;
        }
}

void DrawObject::SetOutlineWidth(double width)
{
        outline_width = width;
}

void DrawObject::SetPolyEdgeMode(bool alternate)
{
        polyedgemode_winding = !alternate;
}

void DrawObject::DrawPolygon(const ::DrawLib::Polygon &polygon)
{
        DrawPolygonInternal(polygon);
}

void DrawObject::DrawPolygonInternal(const ::DrawLib::Polygon &polygon)
{
        // convert polygon to polypolgon..
        PolyPolygon pp;
        pp.polygons.push_back(polygon);
        polyrenderer.DrawPolygon(mycanvas, pp, *current_fillcallback,
                polyedgemode_winding);
}

void DrawObject::DrawPolyPolygon(const ::DrawLib::PolyPolygon &polypolygon)
{
        DrawPolyPolygonInternal(polypolygon);
}

void DrawObject::DrawPolyPolygonInternal(const ::DrawLib::PolyPolygon &polypolygon)
{
        polyrenderer.DrawPolygon(mycanvas, polypolygon, *current_fillcallback,
                polyedgemode_winding);
}

void DrawObject::DrawPolyLine(PolyLine const& line)
{
        DrawPolyLine(line, outline_width);
}

void DrawObject::DrawPolyLine(PolyLine const& line, double thickness)
{
        // Is no line-dashing defined ?
        if(!outline_dash_style.get())
        {
                // Just draw the entire polyline:
                DrawPolyLineInternal(line, thickness);
                return;
        }

        ContourIterator countour_iterator(line);

        // Remember the first part. When the line is closed, and ends in a dash
        // (and thus not in a space) it must still get merged with the last part
        // before it gets drawn, to assure correct outline-join drawing.
        PolyLine first_part;
        countour_iterator.GetNextPart(&first_part, outline_dash_style[0]);

        PolyLine part;
        bool first_time_in_pattern = true;

        // Repeat the dash pattern endlessly:
        uint32_t i;
        do
        {
                // Iterate the dash pattern:
                for(i=(first_time_in_pattern?1:0); i<outline_dash_style_length; ++i)
                {
                        if(countour_iterator.GetNextPart(&part, outline_dash_style[i]))
                        {
                                // It is the last part:

                                // Only draw the last part if it was an even part:
                                if(!(i & 1))
                                {
                                        if(line.is_closed)
                                        {
                                                // The last part was a even part and connected to the first part:

                                                // Now merge the last and the first part:
                                                for(unsigned k=1; k<first_part.points.size(); ++k)
                                                        part.points.push_back(first_part.points[k]);

                                                // ... and draw the result:
                                                DrawPolyLineInternal(part, thickness);
                                        }
                                        else
                                        {
                                                // The last part was a even part and not connected to the first part:
                                                // Just draw the first and last part separately:
                                                DrawPolyLineInternal(first_part, thickness);
                                                DrawPolyLineInternal(part      , thickness);
                                        }
                                }
                                else
                                {
                                        // The last part was a odd part: Just draw the first part:
                                        DrawPolyLineInternal(first_part, thickness);
                                }
                                break;
                        }

                        // Did we get a next part ?
                        if(!part.IsValid())
                                break;

                        // Draw only the even ones:
                        if(!(i & 1))
                                DrawPolyLineInternal(part, thickness);
                }

                first_time_in_pattern = false;
        }
        while(i >= outline_dash_style_length);
}

void DrawObject::DrawPolyLineInternal(PolyLine const& line, double thickness)
{
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
                                                 , outline_join_miter_limit);

        polyrenderer.DrawPolygon(mycanvas, outline_poly_polygon, *current_outlinecallback, true);
}

void DrawObject::SetOutlineEndcapMode(OutlineEndcapModes::Type mode)
{
        outline_endcap_mode = mode;
}

void DrawObject::SetOutlineJoinMode(OutlineJoinModes::Type mode)
{
        outline_join_mode = mode;
        outline_join_miter_limit = -1;
}

void DrawObject::SetOutlineJoinMiterLimit(double limit)
{
        outline_join_miter_limit = limit;
}

void DrawObject::ResetOutlineJoinMiterLimit()
{
        outline_join_miter_limit = -1;
}

void DrawObject::SetFillColor(const Pixel32 &color)
{
        fill_solidpolycallback.SetFillColor(color);
}

void DrawObject::SetOutlineColor(const Pixel32 &color)
{
        outline_solidpolycallback.SetFillColor(color);
        outline_color = color;
}

void DrawObject::SetFillTexture(const Bitmap32  *texturebitmap, const IPoint &offset)
{
        fill_texturedpolycallback.SetTexture(texturebitmap, offset);
}

void DrawObject::SetFillThreeDTexture(const Bitmap32 *texturebitmap, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc)
{
        fill_threedtexturedpolycallback.SetTexture(texturebitmap, sufunc, svfunc, szfunc);
}

void DrawObject::SetOutlineTexture(const Bitmap32  *texturebitmap, const IPoint &offset)
{
        outline_texturedpolycallback.SetTexture(texturebitmap, offset);
}

void DrawObject::SetOutlineThreeDTexture(const Bitmap32 *texturebitmap, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc)
{
        outline_threedtexturedpolycallback.SetTexture(texturebitmap, sufunc, svfunc, szfunc);
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

Pixel32 DrawObject::GetPixel(const FPPoint &position) const
{
        uint32_t yline = RoundFloat(position.y);
        uint32_t xline = RoundFloat(position.x);

        // boundary check...
        if (xline >= mycanvas->GetWidth())
                throw(std::runtime_error("Drawobject32::GetPixel out-of-bounds 'xline'"));
        if (yline >= mycanvas->GetHeight())
                throw(std::runtime_error("Drawobject32::GetPixel out-of-bounds 'yline'"));

        Scanline32 scanline = mycanvas->GetScanline32(yline); // Get the scanline from the canvas

        return scanline.Pixel(xline);                  // Get the pixel color
}


void DrawObject::DrawBitmap(const Bitmap32 &blitbitmap, DrawLib::XForm2D const &transform)
{
        DEBUGPRINT("DrawBitmap: transformation matrix " << transform);
        if (transform.eM11 == 1 && transform.eM22 == 1 && transform.eM12 == 0 && transform.eM21 == 0) //No interesting transformation
        {
                DEBUGPRINT("DrawBitmap: taking the fast path");
                FPPoint final_upperleft = DrawLib::FPPoint(0, 0) * transform;
                int initial_upperleft_x = RoundFloat(final_upperleft.x);
                int initial_upperleft_y = RoundFloat(final_upperleft.y);
                //Clip upperleft and lowerright
                int x_start = std::max(initial_upperleft_x, 0);
                int y_start = std::max(initial_upperleft_y, 0);
                int x_end = std::min(initial_upperleft_x + (int)blitbitmap.GetWidth(), (int)mycanvas->GetWidth());
                int y_end = std::min(initial_upperleft_y + (int)blitbitmap.GetHeight(), (int)mycanvas->GetHeight());

                //Painting outside the canvas
                if (x_end < 0 || y_end < 0 || x_start >= (int)mycanvas->GetWidth() || y_start >= (int)mycanvas->GetHeight())
                {
                        DEBUGPRINT("DrawBitmap: painting bitmap completely outside canvas");
                        return;
                }

                // do processing..
                Scanline32 newscanline(mycanvas->GetWidth(), false);
                Blex::SetBits(newscanline.GetRawMask(), x_start, x_end - x_start, true);

                for(int y = y_start; y < y_end; y++)
                {
                        const Scanline32 &src_ptr  = blitbitmap.GetScanline32(y - initial_upperleft_y);
                        for(int x = x_start; x < x_end; x++)
                            newscanline.Pixel(x) = src_ptr.Pixel(x - initial_upperleft_x);

                        mycanvas->SetScanline32(y, &newscanline);
                }
        }
        else
        {
                DEBUGPRINT("DrawBitmap: taking the slow path");
                //FIXME guard against alloc failures

                //There might be blending modes active, so let's just create a temporary canvas to receive the transformed scanlines
                DrawLib::Bitmap32 tempdest(mycanvas->GetWidth(), mycanvas->GetHeight());
                DEBUGPRINT("Topleft pixel = " << mycanvas->GetScanline32(0).Pixel(0));

                DrawLib::FPBoundingBox bigbox;
                bigbox.upper_left = bigbox.lower_right = DrawLib::FPPoint(0, 0) * transform;
                bigbox.ExtendTo(DrawLib::FPPoint(0, blitbitmap.GetHeight()) * transform); //lower_left
                bigbox.ExtendTo(DrawLib::FPPoint(blitbitmap.GetWidth(), blitbitmap.GetHeight()) * transform); //lower_right
                bigbox.ExtendTo(DrawLib::FPPoint(blitbitmap.GetWidth(), 0) * transform); //upper_right

                //based on https://svn.osgeo.org/mapserver/trunk/mapserver/mapcache/lib/image.c
                //Clone the images, so we can set our own transforms
                pixman_image_t *source = pixman_image_create_bits(PIXMAN_a8r8g8b8, blitbitmap.GetWidth(), blitbitmap.GetHeight(), pixman_image_get_data(blitbitmap.private_getimage()), pixman_image_get_stride(blitbitmap.private_getimage()));
                pixman_image_t *dest   = pixman_image_create_bits(PIXMAN_a8r8g8b8, tempdest.GetWidth(), tempdest.GetHeight(), pixman_image_get_data(tempdest.private_getimage()), pixman_image_get_stride(tempdest.private_getimage()));

                pixman_transform_t ptransform, sourcetransform;
                pixman_transform_init_identity(&ptransform);
                ptransform.matrix[0][0] = pixman_double_to_fixed(transform.eM11);
                ptransform.matrix[0][1] = pixman_double_to_fixed(transform.eM12);
                ptransform.matrix[0][2] = pixman_double_to_fixed(transform.translation.x);
                ptransform.matrix[1][0] = pixman_double_to_fixed(transform.eM21);
                ptransform.matrix[1][1] = pixman_double_to_fixed(transform.eM22);
                ptransform.matrix[1][2] = pixman_double_to_fixed(transform.translation.y);

                pixman_transform_invert(&sourcetransform, &ptransform);

                //based on https://bugs.freedesktop.org/attachment.cgi?id=78522
                pixman_filter_t pixman_filter;
                pixman_kernel_t pixman_kernel_sample, pixman_kernel_reconstruct;
                double scale_x, scale_y;
                int shrink_x, shrink_y;

                /* Compute scale factors as the length of basis vectors transformed by
                 * the pattern matrix. These scale factors are from user to pattern space,
                 * and as such they are greater than 1.0 for downscaling and less than 1.0
                 * for upscaling
                 * TODO: this approach may not be completely correct if the matri
                 * contains a skew component. */

                //http://lists.freedesktop.org/archives/cairo/2014-April/025141.html
                double alpha_x,alpha_y,det;
                alpha_x = hypot (transform.eM11, transform.eM21);
                alpha_y = hypot (transform.eM12, transform.eM22);
                det = transform.eM11 * transform.eM22 - transform.eM21 * transform.eM12;
                scale_x = 1.0/sqrt (fabs (det) * alpha_x / alpha_y);
                scale_y = 1.0/sqrt (fabs (det) * alpha_y / alpha_x);

                DEBUGONLY(
                  double legacy_scale_x;
                  double legacy_scale_y;

                  legacy_scale_x = hypot (1/transform.eM11, transform.eM21); //50/50 odds that eM21 == pattern->matrix.yx ? :P
                  legacy_scale_y = hypot (1/transform.eM22, transform.eM12);
                  DEBUGPRINT("legacy scalex " << legacy_scale_x << ", scaley " << legacy_scale_y););
            //   scale_y = hypot (1/transform.eM22, transform.eM12);
                pixman_filter = PIXMAN_FILTER_BEST;
                pixman_kernel_sample = PIXMAN_KERNEL_LANCZOS3;
                pixman_kernel_reconstruct = PIXMAN_KERNEL_LANCZOS3;

                /* Use convolution filtering if the transformation shrinks the image
                 * by more than half a pixel */

                shrink_x = (bigbox.GetWidth() / scale_x - bigbox.GetWidth()) < -0.5;
                shrink_y = (bigbox.GetHeight() / scale_y - bigbox.GetHeight()) < -0.5;

                DEBUGPRINT("bigbox " << bigbox.GetWidth() << "x" << bigbox.GetHeight() << ", scale_x " << scale_x << ", scale_y " << scale_y << ", shrink_x " << shrink_x << ", shrink_y " << shrink_y);

                if (pixman_filter != PIXMAN_FILTER_NEAREST && (shrink_x || shrink_y))
                {
                    pixman_kernel_t sampling_kernel_x, sampling_kernel_y;
                    int n_params;
                    pixman_fixed_t *params;

                    sampling_kernel_x = shrink_x ? pixman_kernel_sample : PIXMAN_KERNEL_IMPULSE;
                    sampling_kernel_y = shrink_y ? pixman_kernel_sample : PIXMAN_KERNEL_IMPULSE;
                    DEBUGPRINT("DrawBitmap: sampling kernel " << sampling_kernel_x << " " << sampling_kernel_y << "inscale " << scale_x << " " << scale_y);

                    DEBUGPRINT("scalex " << scale_x * 65536.0 + 0.5);
                    DEBUGPRINT("scaley " << scale_y * 65536.0 + 0.5);

                    n_params = 0;
                    params = pixman_filter_create_separable_convolution (&n_params,
                                                                         scale_x * 65536.0 + 0.5,
                                                                         scale_y * 65536.0 + 0.5,
                                                                         pixman_kernel_reconstruct,
                                                                         pixman_kernel_reconstruct,
                                                                         sampling_kernel_x,
                                                                         sampling_kernel_y,
                                                                         1, 1);

                    pixman_image_set_filter (source,
                                             PIXMAN_FILTER_SEPARABLE_CONVOLUTION,
                                             params, n_params);

                    free (params);
                }
                else
                {
                    pixman_image_set_filter (source, pixman_filter, NULL, 0);
                }

                // Use reflection for the missing pixels outside the image - pixman can't just ignore them.
                pixman_image_set_repeat(source, PIXMAN_REPEAT_REFLECT);
                pixman_image_set_transform (source, &sourcetransform);
                pixman_image_composite (PIXMAN_OP_OVER, source, 0/*source?*/, dest, 0, 0, 0, 0, 0, 0, mycanvas->GetWidth(), mycanvas->GetHeight());
                pixman_image_unref(source);
                pixman_image_unref(dest);

                //And now, let's straight-blit it onto our final canvas
                for(unsigned y = 0; y < mycanvas->GetHeight(); ++y)
                {
                        const Scanline32 &src_ptr = tempdest.GetScanline32(y);
                        mycanvas->SetScanline32(y, &src_ptr);
                }
                DEBUGPRINT("Topleft result pixel = " << mycanvas->GetScanline32(0).Pixel(0));



                /* ADDME: A three-step sheer is supposed to be faster, but figure that out later. Perhaps see graphics gems article in part 1: A fast algorithm for general raster rotation

                //Get the containing bounding box for the image
                DEBUGPRINT("DrawBitmap: inverse-transform weighted pixel merger");
                DrawLib::FPBoundingBox bigbox;
                bigbox.upper_left = bigbox.lower_right = DrawLib::FPPoint(0, 0) * transform;
                bigbox.ExtendTo(DrawLib::FPPoint(0, blitbitmap.GetHeight()) * transform); //lower_left
                bigbox.ExtendTo(DrawLib::FPPoint(blitbitmap.GetWidth(), blitbitmap.GetHeight()) * transform); //lower_right
                bigbox.ExtendTo(DrawLib::FPPoint(blitbitmap.GetWidth(), 0) * transform); //upper_right

                //Clip upperleft and lowerright
                int x_start = std::max((int)std::floor(bigbox.upper_left.x), 0);
                int y_start = std::max((int)std::floor(bigbox.upper_left.y), 0);
                int x_end = std::min((int)std::ceil(bigbox.lower_right.x), (int)mycanvas->GetWidth());
                int y_end = std::min((int)std::ceil(bigbox.lower_right.y), (int)mycanvas->GetHeight());

                DrawLib::XForm2D const inverse_transform = transform.Invert();
                for(int y=y_start; y<y_end; y++)
                {
                        Scanline32 scanline(mycanvas->GetWidth(), false);       // create a scanline

                        for(int x = x_start; x < x_end; x++)
                        {
                                //Use a snapping algorithm for now
                                FPPoint sourcepoint = DrawLib::FPPoint(x,y) * inverse_transform;
                                if(sourcepoint.x < 0 || sourcepoint.y < 0)
                                        continue;

                                unsigned source_x = static_cast<unsigned>(std::floor(sourcepoint.x));
                                unsigned source_y = static_cast<unsigned>(std::floor(sourcepoint.y));

                                double r=0,g=0,b=0,a=0;
                                for(unsigned i=0;i<4;++i) //iterate through our grid: topleft,toprigh,tbottomleft,bottomright
                                {
                                        //snap to real pixels
                                        unsigned coord_x = source_x + (i==1||i==3 ? 1 : 0);
                                        unsigned coord_y = source_y + (i>=2 ? 1 : 0);

                                        if(coord_x >= blitbitmap.GetWidth() || coord_y >= blitbitmap.GetHeight())
                                                continue;

                                        //grab input pixel at calculated positions
                                        Pixel32 thispixel = blitbitmap.GetScanline32(coord_y).Pixel(coord_x);

                                        // calculate pixel weight. eg, with real coordinate 2.3, the pixel @2 weighs 70%, and the pixel @3 weighs 30%
                                        // 2 - 2.3 gives -.3, weight 70. 3- 2.3 gives .7, weight 30
                                        double weightx = coord_x - sourcepoint.x;
                                        double weighty = coord_y - sourcepoint.y;
                                        double weight = ((weightx > 0) ? 1 - weightx : 1 + weightx) * ((weighty > 0 ? 1 - weighty : 1 + weighty));

                                        if(weight>0)
                                        {
                                                r += weight * thispixel.GetR() * thispixel.GetA();
                                                g += weight * thispixel.GetG() * thispixel.GetA();
                                                b += weight * thispixel.GetB() * thispixel.GetA();
                                                a += weight * thispixel.GetA();
                                        }
                                }

                                Pixel32 finalpixel(static_cast<uint8_t>(std::min<double>(255,(128+r)/255)),
                                                   static_cast<uint8_t>(std::min<double>(255,(128+g)/255)),
                                                   static_cast<uint8_t>(std::min<double>(255,(128+b)/255)),
                                                   static_cast<uint8_t>(std::min<double>(255,a)));

                                scanline.Pixel(x) = finalpixel;
                                scanline.SetMask(x, true);
                        }

                        mycanvas->SetScanline32(y, &scanline);       // write the scanline to the canvas
                }
                */
        }
}


void DrawObject::SetOutlineDashing(uint32_t length, uint32_t *style)
{
        if(length&1)
                throw std::runtime_error("DrawObject::SetOutlineDashing: The length must be even.");
        if(length < 2)
                throw std::runtime_error("DrawObject::SetOutlineDashing: The length must be at least 2.");
        if(style == NULL)
                throw std::runtime_error("DrawObject::SetOutlineDashing: The style parameter is NULL.");

        outline_dash_style.reset(new uint32_t[length]);
        outline_dash_style_length = length;

        for(uint32_t i = 0; i < length; ++i)
                outline_dash_style[i] = style[i];
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
        FillPath(CreateEllipsePath(centerpoint, radius));
}

void DrawObject::DrawEllipseOutline(const FPPoint &centerpoint, const FPSize &radius)
{
        StrokePath(CreateEllipsePath(centerpoint, radius));
}

double DrawObject::ConvertPoints2Rad(const FPPoint &centerpoint, const FPSize &size,
        const FPPoint &point_on_circle)
{
        double epsilon = 0.001;

        if ((fabs(size.width) < epsilon) || (fabs(size.height) < epsilon))
                throw(std::runtime_error("ConvertPoints2Rad::size to small. Object shouldn't have been drawn"));

        FPPoint radius(size.width / 2.0, size.height / 2.0);

        //if the circle is to small, just return 0.0 ...
        if ((fabs(point_on_circle.x) < epsilon) || (fabs(point_on_circle.y) < epsilon)) return 0.0;

        //if the point_on_circle is right above or below the center, then a straight angle is returned
        if ( fabs(point_on_circle.x - centerpoint.x) < epsilon)
        {
                if (point_on_circle.y > centerpoint.y)
                        return 1.5 * M_PI; //if it is below, return 270 degrees
                else
                        return 0.5 * M_PI; //if it is above, return 90 degrees
        }
        else
        {
                double normalized_x = (point_on_circle.x - centerpoint.x) / radius.x; //take care of anisotropicaties
                double normalized_y = (point_on_circle.y - centerpoint.y) / radius.y; //take care of anisotropicaties
                if (point_on_circle.x > centerpoint.x) //if the point is on the right, return a "small" angle
                        return 2.0 * M_PI - atan2(normalized_y, normalized_x);
                else                                 //return a "large" angle
                        return 2.0 * M_PI - (M_PI - atan2(normalized_y, fabs(normalized_x)));
        }
}


FPPoint DrawObject::DrawArcOutline(const FPPoint &centerpoint,
        const FPSize  &radius,
        const FPPoint &startpoint,
        const FPPoint &endpoint,
        bool clockwise)
{
        Path path;

        //Normalize startpoint
        FPPoint diff = startpoint - centerpoint;
        FPPoint newdiff(diff.x / radius.width, diff.y / radius.height);

        double size = sqrt(newdiff.x * newdiff.x + newdiff.y * newdiff.y);

        diff.x /= size;
        diff.y /= size;

        path.MoveTo(diff + centerpoint);

        if (clockwise)
                path.ArcTo(centerpoint, radius, endpoint);
        else
                path.ArcToR(centerpoint, radius, endpoint);

        StrokePath(path);

        return path.GetLastPoint();
}

void DrawObject::DrawPieOutline(const FPPoint &centerpoint, const FPSize &radius,
        const FPPoint &startpoint, const FPPoint &endpoint)
{       //UNTESTED!
        double startrad = ConvertPoints2Rad(centerpoint, radius, startpoint);
        double endrad   = ConvertPoints2Rad(centerpoint, radius, endpoint);

        DrawLib::PolyLine pline = GenerateArc(centerpoint, radius, startrad, endrad);

        pline.points.push_back(centerpoint);
        pline.points.push_back(pline.points[0]); //close the line.
        DrawPolyLine(pline, outline_width);
}

void DrawObject::DrawPie(const FPPoint &centerpoint, const FPSize &radius,
        const FPPoint &startpoint, const FPPoint &endpoint)
{       //UNTESTED!
        double startrad = ConvertPoints2Rad(centerpoint, radius, startpoint);
        double endrad   = ConvertPoints2Rad(centerpoint, radius, endpoint);

        DrawLib::PolyLine pline = GenerateArc(centerpoint, radius, startrad, endrad);
        DrawLib::Polygon polygon;
        polygon.points=pline.points;
        polygon.points.push_back(centerpoint);
        DrawPolygon(polygon);
}

void DrawObject::DrawRoundRectangle(const FPPoint &upperleft, const FPPoint &lowerright, const FPSize &radius)
{
        FillPath(CreateRoundRectanglePath(upperleft, lowerright, radius));
}


void DrawObject::DrawRoundRectangleOutline(const FPPoint &upperleft, const FPPoint &lowerright, const FPSize &radius)
{
        StrokePath(CreateRoundRectanglePath(upperleft, lowerright, radius));
}

Path DrawObject::CreateRoundRectanglePath(const FPPoint &upperleft, const FPPoint &lowerright, const FPSize &radius)
{
        Path path;

        //FIXME: what to do if points are wrongly sequenced?
        if (upperleft.x >= lowerright.x || upperleft.y >= lowerright.y) return Path();

        //FIXME: what to d if width or height is negative?
        if (radius.width < 0 || radius.height < 0) return Path();

        FPSize real_radius ( std::min (radius.width , 0.5 * (lowerright.x - upperleft.x)) ,
                             std::min (radius.height, 0.5 * (lowerright.y - upperleft.y)));

        FPPoint real_upperleft (upperleft.x + real_radius.width, upperleft.y + real_radius.height);
        FPPoint real_upperright(lowerright.x - real_radius.width, upperleft.y + real_radius.height);
        FPPoint real_lowerleft (upperleft.x + real_radius.width, lowerright.y - real_radius.height);
        FPPoint real_lowerright(lowerright.x - real_radius.width, lowerright.y - real_radius.height);

        FPPoint lefttop (upperleft.x, upperleft.y + real_radius.height);
        FPPoint leftbottom (upperleft.x, lowerright.y - real_radius.height);
        FPPoint righttop (lowerright.x, upperleft.y + real_radius.width);
        FPPoint rightbottom (lowerright.x, lowerright.y - real_radius.height);

        FPPoint topleft (upperleft.x + real_radius.width, upperleft.y);
        FPPoint topright (lowerright.x - real_radius.width, upperleft.y);
        FPPoint bottomleft (upperleft.x + real_radius.width, lowerright.y);
        FPPoint bottomright (lowerright.x - real_radius.width, lowerright.y);

        path.MoveTo(lefttop);

        path.ArcTo(real_upperleft, real_radius, topleft);
        path.LineTo(topright);

        path.ArcTo(real_upperright, real_radius, righttop);
        path.LineTo(rightbottom);

        path.ArcTo(real_lowerright, real_radius, bottomright);
        path.LineTo(bottomleft);

        path.ArcTo(real_lowerleft, real_radius, leftbottom);

        path.ClosePath();

        return path;
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
        FillPath(CreateRectanglePath(upperleft, lowerright));
}

void DrawObject::DrawRectangleOutline(const FPPoint &upperleft, const FPPoint &lowerright)
{
        StrokePath(CreateRectanglePath(upperleft, lowerright));
}

void DrawObject::DrawTextExtended(
        const FPPoint &baseline,
        const Blex::UnicodeString &textstring,
        const Font &myFont,
        const std::vector<double> &deltas,
        bool Antialiasing,
        TextRenderer::HorizontalAlignment halign,
        TextRenderer::VerticalAlignment valign,
        double baselineangle,
        double glyphangle,
        double letterspacing
        )
{
        renderer.DrawText(*mycanvas, textstring, baseline, myFont, deltas, Antialiasing, baselineangle, glyphangle, halign, valign, letterspacing);
}

uint32_t DrawObject::GetTextHeight(const Blex::UnicodeString &textstring, const Font &myFont, const std::vector<double> &deltas, bool antialiasing, double letterspacing)
{
        DrawLib::FPBoundingBox bbox = renderer.CalculateBoundingBox(
                textstring,
                DrawLib::FPPoint(0.0, 0.0),
                myFont,
                deltas,
                antialiasing,
                0.0, 0.0, DrawLib::TextRenderer::LEFT,DrawLib::TextRenderer::BASELINE, letterspacing);

        return static_cast<uint32_t>(bbox.lower_right.y - bbox.upper_left.y + 0.5);
}

uint32_t DrawObject::GetTextWidth(const Blex::UnicodeString &textstring, const Font &myFont, const std::vector<double> &deltas, bool antialiasing, double letterspacing)
{
        DrawLib::FPBoundingBox bbox = renderer.CalculateBoundingBox(
                textstring,
                DrawLib::FPPoint(0.0, 0.0),
                myFont,
                deltas,
                antialiasing,
                0.0, 0.0, DrawLib::TextRenderer::LEFT,DrawLib::TextRenderer::BASELINE, letterspacing);

        return static_cast<uint32_t>(bbox.lower_right.x - bbox.upper_left.x + 0.5);
}

DrawLib::PolyLine DrawObject::GenerateArc(const FPPoint &centerpoint, const FPSize &radius, double startradial, double endradial)
{
        DrawLib::PolyLine polyline;

        //get the number of segments needed to make a nice circle
        uint32_t  number_of_segments = GetNumberOfSegments(radius.width, radius.height);

        //get the arc to fill
        double arc = endradial- startradial ;
        if (arc < 0)
        {       arc = 2.0 * M_PI + arc;
        }
        double rad;

        for (uint32_t part = 0; part <= number_of_segments; part++)
        {
                rad = (arc + startradial - (arc * (double)(number_of_segments-part) / (double)number_of_segments));

                //add the point to the given vector (at the end)
                polyline.points.push_back( FPPoint (
                                           centerpoint.x + radius.width * cos (rad) ,
                                           centerpoint.y - radius.height* sin (rad) //-, cos (pun) the y-axis is swapped
                                          ));
        }
        return polyline;
}

Path DrawObject::CreateBezierPath(const DrawLib::PolyLine &beziercurvelist)
{
        // beziercurvelist should look like this:
        // start c1 c2 end c1 c2 end c1 c2 end ....

        // sanity check...
        // the (listlength-1 % 3) must be 0!
        if ((beziercurvelist.points.size() == 0) || (((beziercurvelist.points.size()-1) % 3)!=0))
                throw(std::runtime_error("DrawObject::DrawBezierOutline called with invalid argument."));

        // number of sections to render...
        int bezier_sections = ((beziercurvelist.points.size() - 1) / 3);
        if (bezier_sections == 0)
                return Path();

        // add starting point to path.
        DrawLib::Path bezierpath;
        bezierpath.MoveTo (beziercurvelist.points[0]);

        // add each section.
        int index = 1;
        for(int sec = 0; sec < bezier_sections; sec++)
        {
                bezierpath.BezierTo(beziercurvelist.points[index],
                        beziercurvelist.points[index+1],
                        beziercurvelist.points[index+2]);
                index += 3;
        }

        return bezierpath;
}

void DrawObject::DrawBezierOutline(const DrawLib::PolyLine &beziercurvelist)
{
        StrokePath(CreateBezierPath(beziercurvelist));
}

void DrawObject::DrawLine(const FPPoint &frompoint, const FPPoint &topoint, double thickness)
{
        if (frompoint - topoint == FPPoint(0,0))
            return;

        //build a line
        DrawLib::PolyLine line;

        line.points.push_back(frompoint);
        line.points.push_back(topoint);

        DrawPolyLine(line, thickness);
}

void DrawObject::DrawLine(const FPPoint &frompoint, const FPPoint &topoint)
{
        DrawLine(frompoint, topoint, outline_width);
}

void DrawObject::DrawThinLine(const FPPoint &start, const FPPoint &end)
{
        DrawLine(start, end, 1.0);
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
                    DrawPolyPolygonInternal(pp);
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

void DrawObject::StrokePath(Path const &thispath)
{
        StrokeFillPath(thispath, true, false);
}

void DrawObject::FillPath(Path const &thispath)
{
        StrokeFillPath(thispath, false, true);
}

void DrawObject::StrokeAndFillPath(Path const &thispath)
{
        StrokeFillPath(thispath, true, true);
}

void DrawObject::PathToProtectionRegion()
{
        //FIXME: implement!!!
}

} //end namespace DrawLib
