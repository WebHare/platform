#include <ap/libwebhare/allincludes.h>

#include <sstream>
#include "shapes.h"
#include "util.h"
#include <drawlib/drawlibv2/bitmapmanip.h>

// For testing, uncomment the following define.
// Then thin boxes get drawn around all textareas / textboxes of all shapes
// containing text.
// These boxes are aware of the text-marges defined by text-properties!
#define DEBUG_DRAW_TEXT_BOXES

namespace Parsers {
namespace Office {
namespace Escher {

using Blex::getu8;
using Blex::getu16lsb;
using Blex::getu32lsb;
using Blex::gets32lsb;

void RotateAroundInternal(DrawLib::FPPoint const &center, DrawLib::FPPoint *point,
        float cos, float sin)
{
        if(!point)
                throw std::runtime_error("RotateAround: Called with NULL point parameter.");

        // Translate back:
        *point -= center;

        float x_temp = point->x;

        // Rotate:
        point->x = cos*point->x - sin*point->y;
        point->y = cos*point->y + sin*x_temp;

        // Retranslate:
        *point += center;
}

void RotateAroundRad(DrawLib::FPPoint const &center, DrawLib::FPPoint *point,
        float radials)
{
        RotateAroundInternal(center, point,
            cos(radials),
            sin(radials));
}

float GetDirectionTo(
        DrawLib::FPPoint const &base,
        DrawLib::FPPoint const &direction)
{
        DrawLib::FPPoint p = base - direction;
        if(p.y == 0)
        {
                if(p.x > 0)
                        return -M_PI/2;
                else
                        return  M_PI/2;
        }
        else
        {
                float at = -atan(p.x / p.y) - M_PI;

                if(p.y > 0)
                        return at + M_PI;
                else
                        return at;
        }
}

float GetAspectRatio(DrawLib::XForm2D const &stored_transformation)
{
        DrawLib::FPPoint upper_left  = DrawLib::FPPoint(-1,-1) * stored_transformation;
        DrawLib::FPPoint upper_right = DrawLib::FPPoint( 1,-1) * stored_transformation;
        DrawLib::FPPoint lower_left  = DrawLib::FPPoint(-1, 1) * stored_transformation;
        float div = Escher::Distance(upper_left,lower_left);
        if(div > -1e-7 && div < 1e-7) return 1.0;
        return Escher::Distance(upper_left,upper_right) / div;
}

DrawLib::FPBoundingBox GetOuterBoundingBoxOfTransformedBoundingBox(
        DrawLib::FPBoundingBox const& bounding_box,
        DrawLib::XForm2D const& transformation)
{
        DrawLib::FPPoint startingpoint = DrawLib::FPPoint(bounding_box.upper_left .x,bounding_box.upper_left .y) * transformation;
        DrawLib::FPBoundingBox result(startingpoint,startingpoint);

        // Now make it fit around the other 3 transformed corners:
        result.ExtendTo(
                DrawLib::FPPoint(bounding_box.lower_right.x,bounding_box.upper_left .y) *
                transformation);
        result.ExtendTo(
                DrawLib::FPPoint(bounding_box.upper_left .x,bounding_box.lower_right.y) *
                transformation);
        result.ExtendTo(
                DrawLib::FPPoint(bounding_box.lower_right.x,bounding_box.lower_right.y) *
                transformation);

        return result;
}

/**
 * Constant for the gammma correction. 2.2 seems to be the one
 * used by MS Escher. Also there can be found many information about
 * this correctionvalue on the internet.
 */
const float gamma_correction_constant = 2.2;


using Escher::ToIPoint;
using Escher::RotateAroundRad;

DrawLib::Pixel32 FactorizeColor(
        DrawLib::Pixel32 const &color, float factor)
{
        uint32_t r = color.GetR();
        uint32_t g = color.GetG();
        uint32_t b = color.GetB();
        if(factor > 1.0)
        {
                factor = 1.0 - (factor - 1.0);

                r = 255 - ((255-r) * factor);
                g = 255 - ((255-g) * factor);
                b = 255 - ((255-b) * factor);

                if(r>255) r=255;
                if(g>255) g=255;
                if(b>255) b=255;
        }
        else
        {
                r *= factor;
                g *= factor;
                b *= factor;
        }

        return DrawLib::Pixel32((uint8_t)r, (uint8_t)g, (uint8_t)b);
}

/**
 * Safely blends two DrawLib colors.
 *
 * @param color1  The first color.
 * @param color2  The second color.
 * @param factor2 The multiply factor in the range [0.0 - 1.0].
 * @return The blended color. This is in pseudo code:
 * (factor)*color1 + (1-factor)*color2.
 */
DrawLib::Pixel32 BlendColors(
        DrawLib::Pixel32 const &color1,
        DrawLib::Pixel32 const &color2, float factor)
{
        uint32_t r = color1.GetR() + factor*(color2.GetR() - (int32_t)color1.GetR());
        uint32_t g = color1.GetG() + factor*(color2.GetG() - (int32_t)color1.GetG());
        uint32_t b = color1.GetB() + factor*(color2.GetB() - (int32_t)color1.GetB());

        if(r>255) r = 255;
        if(g>255) g = 255;
        if(b>255) b = 255;
        return DrawLib::Pixel32((uint8_t)r, (uint8_t)g, (uint8_t)b);
}

/**
 * Applies a gamma correction to the given DrawLib color.
 *
 * @param color Points to the color corrected.
 * @param g The correction factor. A value greater than 1
 * lightens the color, a value lower than 1 darkens it.
 */
void GammaCorrect(DrawLib::Pixel32 *color, float g)
{
        /* The gamma correction as below seems to be the most common one.
           This seems to be the one done by for example Paint Shop.
           Note that this correction can actually change the real color.
           In other words: This gamma correction has on the same color
           transformed to a HSL effect on all values: H, S and L. Also
           there is hardly any information to find on how to calculate a
           gamma correction on a HSL color.
        */

        g = 1/g;
        color->SetRGBA(
                255.0 * pow(color->GetR()/255.0, g),
                255.0 * pow(color->GetG()/255.0, g),
                255.0 * pow(color->GetB()/255.0, g),
                255);
}

/////////////////////////////////////////////////////////////////////////////
// Implementation class 'TextPart':

TextPart::TextPart(Properties const &properties, int32_t shapeid) :
 properties(properties)
{
        text_shape_id          = shapeid;
        text_id                = properties.Get(Properties::lTxid);

        text_left_margin       = properties.GetAsPixelsFromEMUs(Properties::dxTextLeft, 0.0);
        text_top_margin        = properties.GetAsPixelsFromEMUs(Properties::dyTextTop, 0.0);
        text_right_margin      = properties.GetAsPixelsFromEMUs(Properties::dxTextRight, 0.0);
        text_bottom_margin     = properties.GetAsPixelsFromEMUs(Properties::dyTextBottom, 0.0);

        text_direction         = (MSOTXFL)properties.Get(Properties::txflTextFlow);
        text_auto_text_margin  = properties.GetAsBoolean(Properties::fAutoTextMargin);
        text_rotate_text       = properties.GetAsBoolean(Properties::fRotateText);
        text_shape_to_text     = properties.GetAsBoolean(Properties::fFitShapeToText);
        text_text_to_shape     = properties.GetAsBoolean(Properties::fFitTextToShape);
}

void TextPart::SetupTextBox(
        float text_m_left , float text_m_top,
        float text_m_right, float text_m_bottom)
{
        bounding_box.upper_left.x  = -text_m_left;
        bounding_box.upper_left.y  = -text_m_top;
        bounding_box.lower_right.x =  text_m_right;
        bounding_box.lower_right.y =  text_m_bottom;
}

DrawLib::FPBoundingBox TextPart::ApplyTextBoxToCanvas(
        TransformationState const& pars)
{
        // Any text defined for this shape ?
        // And any textbox defined by the shape specific implementation?
        if(!text_id)
            DrawLib::FPBoundingBox();

        // First get the stored transformation unrotated, but with the same translation:
        DrawLib::XForm2D unrotated_transform = pars.stored_transformation;
        unrotated_transform.translation = DrawLib::FPPoint(0,0);
        float rotation = unrotated_transform.GetRotation();
        unrotated_transform *= DrawLib::XForm2D(-rotation,
                DrawLib::FPPoint(1,1), DrawLib::FPPoint(0,0));
        unrotated_transform.translation = pars.stored_transformation.translation;


        // Get the BB transformed from [-1,-1,  1,1] to pixels:
        pixel_bounding_box = bounding_box;
        pixel_bounding_box.upper_left  *= unrotated_transform;
        pixel_bounding_box.lower_right *= unrotated_transform;

        // Check if the BB if flipped in any way:
        bool is_flipped_horizontally =
                (pixel_bounding_box.upper_left .x >
                 pixel_bounding_box.lower_right.x);
        bool is_flipped_vertically =
                (pixel_bounding_box.upper_left .y >
                 pixel_bounding_box.lower_right.y);


        // Now first unflip the BB, if it is flipped:
        if(is_flipped_horizontally)
                std::swap(pixel_bounding_box.upper_left .x,
                          pixel_bounding_box.lower_right.x);
        if(is_flipped_vertically)
                std::swap(pixel_bounding_box.upper_left .y,
                          pixel_bounding_box.lower_right.y);



        // Add the marges from the properties and from the line_width here.
        // Where to add them, depends on how the BB is flipped.
        // That the line_width must get multiplied, seems to be a Microsoft feature.

        // For the left:
        pixel_bounding_box.upper_left.x  +=
                (is_flipped_horizontally?text_right_margin:text_left_margin);
        pixel_bounding_box.upper_left.x  += (line_width/2.0)*
                (is_flipped_horizontally?bounding_box.lower_right.x : -bounding_box.upper_left.x);

        // For the right:
        pixel_bounding_box.lower_right.x -=
                (is_flipped_horizontally?text_left_margin:text_right_margin);
        pixel_bounding_box.lower_right.x -= (line_width/2.0)*
                (is_flipped_horizontally?-bounding_box.upper_left.x : bounding_box.lower_right.x);


        // For the top:
        pixel_bounding_box.upper_left.y  +=
                (is_flipped_vertically?text_bottom_margin:text_top_margin);
        pixel_bounding_box.upper_left.y  += (line_width/2.0)*
                (is_flipped_vertically?bounding_box.lower_right.y : -bounding_box.upper_left.y);

        // For the bottom:
        pixel_bounding_box.lower_right.y -=
                (is_flipped_vertically?text_top_margin:text_bottom_margin);
        pixel_bounding_box.lower_right.y -= (line_width/2.0)*
                (is_flipped_vertically?-bounding_box.upper_left.y : bounding_box.lower_right.y);


        // Check if the marges made the box 'empty':
        if(pixel_bounding_box.upper_left.x > pixel_bounding_box.lower_right.x ||
           pixel_bounding_box.upper_left.y > pixel_bounding_box.lower_right.y)
                // If so: Skip the rest and return this undefined BB:
                return pixel_bounding_box;


        ////////////////////////////////////////////////////////
        // Flipping / rotation of the text-box:

        // Now temporary translate the box back to the center of the shape:
        pixel_bounding_box *= DrawLib::XForm2D(1,0,0,1,  DrawLib::FPPoint(0,0)-pars.stored_transformation.translation);


        // Determine the quadrant of the rotation..
        float f = (rotation/(2*M_PI))*360; // From radials to degrees
        f = (std::abs(f)+45) / 90;         // To 45 degrees rotated quadrants
        int quadrant = ((int)f) % 4;       // To quadrant as integer

        // Need to put the text bounding box upside down or
        // swap the width and the height ?:
        // (This works cause the box is not translated.)
        switch(quadrant)
        {
        case 0://Top at top
                // No flipping needed
                break;
        case 1://Top at left
                pixel_bounding_box *= DrawLib::XForm2D(  M_PI_2, DrawLib::FPPoint(1, 1), DrawLib::FPPoint());
                break;
        case 2://Top at bottom
                pixel_bounding_box *= DrawLib::XForm2D(  M_PI  , DrawLib::FPPoint(1, 1), DrawLib::FPPoint());
                break;
        case 3://Top at right
                pixel_bounding_box *= DrawLib::XForm2D(3*M_PI_2, DrawLib::FPPoint(1, 1), DrawLib::FPPoint());
                break;
        }

        // Now re-translate the box to the original place:
        pixel_bounding_box *= DrawLib::XForm2D(1,0,0,1,  pars.stored_transformation.translation);


        return pixel_bounding_box;
}

void TextPart::Draw(ShapeDrawParameters const &pars) const
{
        // Is any text defined for this shape ?
        // Is any textbox defined by the shape specific implementation?
        // Is the volume of the textbox not empty, made by for example to large marges?
        if(!text_id ||
           pixel_bounding_box.upper_left.x >= pixel_bounding_box.lower_right.x ||
           pixel_bounding_box.upper_left.y >= pixel_bounding_box.lower_right.y)
            return;

        if (!pars.bitmap)
        {
                pars.text_callback(0, text_shape_id);
                return;
        }

        // First get the final, translated, pixel-units BB locally:
        DrawLib::FPBoundingBox final_text_bounding_box = pixel_bounding_box * pars.final_transformation;

        // Now determine the  color of the area
        DrawLib::Pixel32 fill_color = properties.GetColor(Properties::fillColor, pars.scheme_colors);

        DrawLib::TextFormatter text_renderer(pars.final_transformation, fill_color);
        pars.text_callback(&text_renderer, text_shape_id);

        // Translate the escher text direction to the DrawLib version:
        int drawlib_text_direction = 0;//Default: Horizontal, left to right
        switch(text_direction)
        {
        case msotxflHorzN:
        case msotxflTtoBA:
        case msotxflHorzA:
        case msotxflVertN:
                break; //ADDME implement the above?

        case msotxflBtoT: // Vert, bottom to top
                drawlib_text_direction = 2;
                break;
        case msotxflTtoBN: // Vert, top to bottom
                drawlib_text_direction = 1;
                break;
        }

        //final_text_bounding_box *= pars.final_transformation;
        DrawLib::Canvas32 canvas(pars.bitmap);
        text_renderer.RenderText(canvas, final_text_bounding_box,
                                 drawlib_text_direction, true, 0.0);

        #ifdef DEBUG
        #ifdef DEBUG_DRAW_TEXT_BOXES
        // test code :
        DrawLib::DrawObject drawobj(&canvas);
        drawobj.SetOutlineMode(DrawLib::DrawObject::SOLID);
        drawobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0,0));
        drawobj.SetOutlineWidth(0);
        drawobj.DrawRectangleOutline(
                final_text_bounding_box.upper_left,
                final_text_bounding_box.lower_right);
        #endif
        #endif
}




/////////////////////////////////////////////////////////////////////////////
// Implementation class 'FillPart':

FillPart::FillPart(ShapeContainer const &shape_container,
        Properties const &properties, bool _shade_shape_to_outline,
        bool fill_flag_default)
: shade_shape_to_outline(_shade_shape_to_outline)
, properties(properties)
{
        // Make the fill_texture_bounding_box undefined:
        fill_texture_bounding_box.upper_left .x =  1;
        fill_texture_bounding_box.lower_right.x = -1;

        filltextureblip = shape_container.GetProperties().GetPropertyAsBlip(390);
        fill_type              = (MSOFILLTYPE)properties.Get   (Properties::fillType);
        fill_opacity           = properties.GetAsFloatFrom16_16(Properties::fillOpacity, 0.0f);

        fill_back_opacity      = properties.GetAsFloatFrom16_16(Properties::fillBackOpacity, 0.0f);
        fill_angle             = properties.GetAsFloatFrom16_16(Properties::fillAngle, 0.0f);
        fill_focus             = (int32_t)properties.Get           (Properties::fillFocus);
        fill_to_left           = properties.GetAsFloatFrom16_16(Properties::fillToLeft, 0.0f);
        fill_to_top            = properties.GetAsFloatFrom16_16(Properties::fillToTop, 0.0f);
        fill_to_right          = properties.GetAsFloatFrom16_16(Properties::fillToRight, 0.0f);
        fill_to_bottom         = properties.GetAsFloatFrom16_16(Properties::fillToBottom, 0.0f);

        // Microsoft seems to have made one strange exception.
        // Don't ask me why.
        if(fill_type == (MSOFILLTYPE)msofillShadeScale && fill_angle == -45.0)
        {
                if(fill_focus == 0)
                        fill_focus = 100;
                else if(fill_focus == 100)
                        fill_focus = 0;
        }

        std::vector<uint8_t> const shade_colors_array_data = properties.GetComplex(Properties::fillShadeColors);
        if(shade_colors_array_data.size()>0) // Found property ?:
                shade_colors.reset(new IMsoColorsArray(shade_colors_array_data));

        bool is_default;
        fill_flag = properties.GetAsBoolean(Properties::fFilled, &is_default);
        if(is_default)
                fill_flag = fill_flag_default;


        fill_shade_type        = properties.Get         (Properties::fillShadeType);
        fill_pattern_flag      = properties.GetAsBoolean(Properties::fillShape);

        // Set the transparancy (alpha) of the colors:
        if(fill_opacity < 0.0 || fill_opacity > 1.0)
                throw std::runtime_error("EscherShape::EscherShape fill_opacity out of bounds.");

        if(fill_back_opacity < 0.0 || fill_back_opacity > 1.0)
                throw std::runtime_error("EscherShape::EscherShape fill_back_opacity out of bounds.");
}

void FillPart::ExtendBoundingBox(DrawLib::FPBoundingBox const &bbox)
{
        // Is the fill_texture_bounding_box still undefined?
        if(fill_texture_bounding_box.upper_left.x > fill_texture_bounding_box.lower_right.x)
                fill_texture_bounding_box = bbox;
        else
                fill_texture_bounding_box.ExtendTo(bbox);
}

void FillPatternBitmapWithColors(DrawLib::BitmapInterface *texture,
        DrawLib::Pixel32 const &color1, DrawLib::Pixel32 const &color2)
{
        for(unsigned y = 0; y<texture->GetHeight(); y++)
        {
                DrawLib::Scanline32 const &read_scanline = texture->GetScanline32(y);
                DrawLib::Scanline32 write_scanline(texture->GetWidth(),
                        true);

                for(unsigned x = 0; x<texture->GetWidth(); x++)
                {
                        DrawLib::Pixel32 color = read_scanline.Pixel(x);
                        if(color.GetR())
                                write_scanline.Pixel(x) = color1;
                        else
                                write_scanline.Pixel(x) = color2;
                }

                texture->SetScanline32(y, write_scanline);
        }
}

void FillPart::GetFillTextureBitmap(std::unique_ptr<DrawLib::BitmapInterface> *textureptr) const
{
        if(!filltextureblip)
                throw std::runtime_error("Reading shape properties: Fill texture expected, but not found.");

        // Rewind stream, in case this is not the first time this picture getsloaded:
        textureptr->reset(filltextureblip->GetUnprocessedBitmap());
        if(!textureptr->get()) //Hmm, previous code put this check AFTER FillPatternBitmapWithColors, would have probably crashed stuff.
                throw std::runtime_error("EscherShape::GenerateFillTexture: Resizing picture: Expected picture not found.");
}

DrawLib::BitmapInterface const *FillPart::GenerateFillTexture(ShapeDrawParameters const &drawparams,
        DrawLib::Path const& path,
        DrawLib::FPBoundingBox const* custom_bounding_box) const
{
        if(!fill_flag)
                return NULL;

        // Not needed for this type of fill ?
        if(!(fill_type == (MSOFILLTYPE)msofillPicture     ||
             fill_type == (MSOFILLTYPE)msofillShade       ||
             fill_type == (MSOFILLTYPE)msofillShadeCenter ||
             fill_type == (MSOFILLTYPE)msofillShadeShape  ||
             fill_type == (MSOFILLTYPE)msofillShadeScale  ||
             fill_type == (MSOFILLTYPE)msofillShadeTitle  ||
             fill_type == (MSOFILLTYPE)msofillTexture     ||
             fill_type == (MSOFILLTYPE)msofillPattern     ))
                return NULL;

        DrawLib::FPSize size = custom_bounding_box ? custom_bounding_box->GetSize() : fill_texture_bounding_box.GetSize();
        size = size * drawparams.final_transformation;

        // These plus 2, to make the fill texture cover the invisible
        // lines of shapes with no outline, which have width 1:
        uint32_t width  = size.width  + 2;
        uint32_t height = size.height + 2;

        std::unique_ptr<DrawLib::BitmapInterface> texture_bitmap;



        // Precalculate / cache the fill and fill-back colors here:
        DrawLib::Pixel32 fill_color      = properties.GetColor(Properties::fillColor    , drawparams.scheme_colors);
        DrawLib::Pixel32 fill_back_color = properties.GetColor(Properties::fillBackColor, drawparams.scheme_colors);

        fill_color     .SetA(255*fill_opacity     );
        fill_back_color.SetA(255*fill_back_opacity);

        // Need to apply a gamma correction ?:
        if(fill_shade_type & 0x1)
        {
                // First do an opposite correction on the fill and fill-back
                // colors. This because Escher seems, creating a gradient fill,
                // not to correct the start and end of the gradient:

                GammaCorrect(&fill_color     , 1/gamma_correction_constant);
                GammaCorrect(&fill_back_color, 1/gamma_correction_constant);
        }



        // **** Picture fill (just resize): ****
        if(fill_type == (MSOFILLTYPE)msofillPicture && filltextureblip)
        {
                std::unique_ptr<DrawLib::BitmapInterface> fill_texture;
                GetFillTextureBitmap(&fill_texture);

                std::unique_ptr<DrawLib::BitmapInterface> resized_bitmap;
                resized_bitmap.reset(DrawLib::CreateResizedBitmap(*fill_texture,
                      DrawLib::ISize(width, height)));
                if(resized_bitmap.get()==NULL)
                        throw(std::runtime_error("EscherShape::GenerateFillTexture: Could not resize the bitmap."));

                return resized_bitmap.release();
        }


        // **** Shade / gradient fills: ****
        else if(fill_type == (MSOFILLTYPE)msofillShadeScale)
        {
                if(fill_angle == 0.0)
                // Horizontal:
                {
                        texture_bitmap.reset(new DrawLib::Bitmap32(1, height));

                        for(uint32_t y=0; y<height; y++)
                        {
                                DrawLib::Scanline32 scanline(1, true);

                                scanline.Pixel(0) = GetShadeFillTextureColor(y/(float)height,
                                        fill_color, fill_back_color);

                                texture_bitmap->SetScanline32(y, scanline);
                        }
                }
                else if(fill_angle == -90.0)
                // Vertical:
                {
                        texture_bitmap.reset(new DrawLib::Bitmap32(width, 1));

                        DrawLib::Scanline32 scanline(width, true);

                        for(uint32_t x=0; x<width; x++)
                                scanline.Pixel(x) = GetShadeFillTextureColor((float)x/(float)width,
                                        fill_color, fill_back_color);

                        texture_bitmap->SetScanline32(0, scanline);
                }

                else if(fill_angle == -135.0)
                // Diagonal up:
                {
                        texture_bitmap.reset(new DrawLib::Bitmap32(width, height));

                        for(uint32_t y=0; y<height; y++)
                        {
                                DrawLib::Scanline32 scanline(width, true);

                                float f_y = y/(float)height;

                                for(uint32_t x=0; x<width; x++)
                                        scanline.Pixel(x) = GetShadeFillTextureColor(
                                                (f_y + x/(float)width) / 2.0,
                                                fill_color, fill_back_color);

                                texture_bitmap->SetScanline32(y, scanline);
                        }
                }

                else if(fill_angle == -45.0)
                // Diagonal down:
                {
                        texture_bitmap.reset(new DrawLib::Bitmap32(width, height));

                        for(uint32_t y=0; y<height; y++)
                        {
                                DrawLib::Scanline32 scanline(width, true);

                                float f_y = y/(float)height;

                                uint32_t x2 = width-1;
                                for(uint32_t x=0; x<width; x++, x2--)
                                        scanline.Pixel(x) = GetShadeFillTextureColor(
                                                (f_y + x2/(float)width) / 2.0,
                                                fill_color, fill_back_color);

                                texture_bitmap->SetScanline32(y, scanline);
                        }
                }

                else
                // Undefined shade-fill angle:
                {
                        std::ostringstream str;
                        str << "Encountered unrecognized fill angle " << fill_angle;
                        throw std::runtime_error(str.str());
                }
        }


        // **** Shape corner fills: ****
        else if(fill_type == (MSOFILLTYPE)msofillShadeCenter)
        {
                texture_bitmap.reset(new DrawLib::Bitmap32(width, height));

                for(uint32_t y=0; y<height; y++)
                {
                        DrawLib::Scanline32 scanline(width, true);

                        float f_y = y/(float)height;

                        // We don't know exactly why this works:
                        // (fill_to_top == fill_to_bottom == (1.0 || 0.0))
                        if(fill_to_top != 0.0)
                                f_y = 1.0 - f_y;

                        uint32_t x2 = width-1;
                        for(uint32_t x=0; x<width; x++, x2--)
                        {
                                float f_x = x2/(float)width;

                                // We don't know exactly why this works:
                                // (fill_to_left == fill_to_right == (1.0 || 0.0))
                                if(fill_to_left == 0.0)
                                        f_x = 1.0 - f_x;

                                scanline.Pixel(x) = GetShadeFillTextureColor(
                                        std::max(f_y, f_x),
                                        fill_color, fill_back_color);
                        }

                        texture_bitmap->SetScanline32(y, scanline);
                }
        }


        // **** Shapeoutline to center fills: ****
        else if(fill_type == (MSOFILLTYPE)msofillShadeShape)
        {
                // Need to fill from the outline of the shape to the center point ?:
                if(shade_shape_to_outline)
                {
                        texture_bitmap.reset(new DrawLib::Bitmap32(width, height));

                        GetShapeFormedGradientFillTexture(*texture_bitmap, path, width, height,
                                drawparams, fill_color, fill_back_color);
                }

                // Need to fill from the shape-bounding-box to the center point ?:
                else
                {
                        texture_bitmap.reset(new DrawLib::Bitmap32(width, height));

                        for(uint32_t y=0; y<height; y++)
                        {
                                DrawLib::Scanline32 scanline(width, true);

                                float f_y = y/(float)height;
                                if (f_y < 0.5)
                                  f_y = 1.0 - 2.0 * f_y;
                                else
                                  f_y = 2.0 * (f_y - 0.5);

                                for(uint32_t x=0; x<width; x++)
                                {
                                        float f_x = x/(float)width;
                                        if (f_x < 0.5)
                                          f_x = 1.0 - 2.0 * f_x;
                                        else
                                          f_x = 2.0 * (f_x - 0.5);

                                        scanline.Pixel(x) = GetShadeFillTextureColor(
                                                std::max(f_x, f_y),
                                                fill_color, fill_back_color);
                                }

                                texture_bitmap->SetScanline32(y, scanline);
                        }
                }
        }
                // Fill with a (preloaded) texture, which is a pattern or just a texture:
        else if(fill_type == (MSOFILLTYPE)msofillTexture ||
                fill_type == (MSOFILLTYPE)msofillPattern)
        {
                GetFillTextureBitmap(&texture_bitmap);

                // Fill it with the foreground and backgroundfillcolor, when it is a pattern:
                if(fill_type == (MSOFILLTYPE)msofillPattern)
                    FillPatternBitmapWithColors(texture_bitmap.get(),
                        properties.GetColor(Properties::fillColor    , drawparams.scheme_colors),
                        properties.GetColor(Properties::fillBackColor, drawparams.scheme_colors));
        }

        else
        // FIXME: Delete this,and implement the other shading styles:
        {
                texture_bitmap.reset(new DrawLib::Bitmap32(1, 1));
                DrawLib::Scanline32 scanline(1, true);
                scanline.Pixel(0) = properties.GetColor(Properties::fillColor, drawparams.scheme_colors);
                scanline.Pixel(0).SetA(255*fill_opacity);
                texture_bitmap->SetScanline32(0, scanline);
        }

        return texture_bitmap.release();
}

void FillPart::GetShapeFormedGradientFillTexture(
        DrawLib::BitmapInterface &texture_bitmap,
        DrawLib::Path const& path,
        uint32_t width, uint32_t height,ShapeDrawParameters const &pars,
        DrawLib::Pixel32 const& corrected_fill_color,
        DrawLib::Pixel32 const& corrected_fill_back_color) const
{
        //ADDME: Optimize this function implementation.
        DrawLib::Canvas32 canvas(&texture_bitmap);
        DrawLib::DrawObject draw_object(&canvas);

        DrawLib::FPPoint half_size(width  / 2, height / 2);

        unsigned num_steps = std::max(half_size.x, half_size.y);

        DrawLib::Path local_path = path;

        local_path.ApplyTransform(pars.final_transformation);

        DrawLib::FPPoint final_left_top = fill_texture_bounding_box.upper_left * pars.final_transformation;

        // Translate back to center the path on the left-top point:
        local_path.ApplyTransform(DrawLib::XForm2D(0.0,
                DrawLib::FPPoint(1.0, 1.0),
                (final_left_top*-1.0) - half_size));

        for(unsigned step=0; step<num_steps; step++)
        {
                float frac = 1.0 - (step / (float)num_steps);

                DrawLib::Path scaled_path = local_path;

                // Scale down as much as necessary. The constants 1.1
                // are here to assure that the fill texture is fully
                // covered. This seems to be necessary, cause of precision-errors.
                scaled_path.ApplyTransform(DrawLib::XForm2D(0.0,
                        DrawLib::FPPoint(1.1*frac, 1.1*frac), DrawLib::FPPoint(0, 0)));

                // Retranslate:
                scaled_path.ApplyTransform(DrawLib::XForm2D(0.0,
                        DrawLib::FPPoint(1.0, 1.0), half_size));

                draw_object.SetFillColor(GetShadeFillTextureColor(frac,
                        corrected_fill_color, corrected_fill_back_color));
                draw_object.FillPath(scaled_path);
        }
}

float ColorIntensity(DrawLib::Pixel32 const& color)
{
        return (color.GetR() + color.GetG() + color.GetB()) / (3*255.0);
}

DrawLib::Pixel32 FillPart::GetShadeFillTextureColor(float i,
        DrawLib::Pixel32 const& corrected_fill_color,
        DrawLib::Pixel32 const& corrected_fill_back_color) const
{
        // NOTE: fill_focus, the fill focus, expected to be 100, 50, 0 or -50.

        // Change the index (within [0.0 - 1.0]), by looking at the fill_focus:
        if(std::abs(fill_focus) == 50) // a to b to a
        {
                if (i < 0.5)
                  i = 1.0 - 2.0 * i;
                else
                  i = 2.0 * (i - 0.5);
        }

        // Not exacty known why this is needed ...
        // Determine if it is needed to flip the back and front color:
        bool need_to_flip = (fill_focus <= 0);
        if(fill_angle >= 0.0 && std::abs(fill_focus) == 50)
                need_to_flip = !need_to_flip;
        // Do the flip:
        if(need_to_flip)
                i = 1.0 - i;


        // Need to apply a sigma transfer ?:
        if(fill_shade_type & 0x2)
        {
                //As optical aproximation method, we use acosinus
                // still leading from 0.0 to 1.0:
                i = 1.0 - (cos(i*M_PI)+1.0)/2.0;
        }

        // Is the shade colors property (407) det for this shape,
        // then use those colors to get the final color:
        if(shade_colors.get())
                return shade_colors->GetShadedColor(i);


        // Now blend the two colors:
        DrawLib::Pixel32 p = BlendColors(corrected_fill_color, corrected_fill_back_color, i);

        // Need to apply a gamma correction ?:
        if(fill_shade_type & 0x1)
                // This corrects the entire gradient:
                GammaCorrect(&p, gamma_correction_constant);

        return p;
}

DrawLib::Pixel32 FillPart::GetFillColor(ShapeDrawParameters const &drawparams)
{
        return properties.GetColor(Properties::fillColor, drawparams.scheme_colors);
}

bool FillPart::EffectProperties(DrawLib::DrawObject *drawobj,
        bool use_pattern,
        DrawLib::BitmapInterface const *texture_bitmap,
        float fill_color_factor,
        DrawLib::FPBoundingBox const* custom_bounding_box,
        ShapeDrawParameters const &drawparams) const
{
        if(!fill_flag)
                return false;

        if(!use_pattern)
        // Use only the foreground color, in spite of any pattern as indicated in the properties:
        {
                if(fill_color_factor <= 0.0)
                        throw std::runtime_error("FillProperties::EffectProperties fill_color_factor mut be greater than zero.");

                DrawLib::Pixel32 fill_color             = properties.GetColor           (Properties::fillColor, drawparams.scheme_colors);
                fill_color.SetA(255*fill_opacity);

                DrawLib::Pixel32 temp_color = FactorizeColor(fill_color, fill_color_factor);

                // Clip the opacity to [0.0 - 1.0]:
                float opacity2 = fill_opacity;
                if(opacity2 < 0.0) opacity2 = 0.0;
                if(opacity2 > 1.0) opacity2 = 1.0;

                temp_color.SetA((uint8_t)(255 * opacity2));

                drawobj->SetFillMode(DrawLib::DrawObject::SOLID);
                drawobj->SetFillColor(temp_color);
        }
        else
        // Use a pattern, as indicates in the properties:
        // (fill_color_factor assumed to be 1.0)
        {
                switch(fill_type)
                {
                case (MSOFILLTYPE)msofillBackground:
                        return true;

                // Fill with a solid color
                case (MSOFILLTYPE)msofillSolid:
                {
                        DrawLib::Pixel32 fill_color             = properties.GetColor           (Properties::fillColor, drawparams.scheme_colors);
                        fill_color.SetA(255*fill_opacity);

                        // Just use the fill color:
                        drawobj->SetFillMode(DrawLib::DrawObject::SOLID);
                        drawobj->SetFillColor(fill_color);
                        return true;
                }


                // Fill with a (in 'GenerateFillTexture') generated fill texture,
                // which will be a shaded fill texture or a resized picture:
                case (MSOFILLTYPE)msofillPicture:
                case (MSOFILLTYPE)msofillShade:
                case (MSOFILLTYPE)msofillShadeCenter:
                case (MSOFILLTYPE)msofillShadeShape:
                case (MSOFILLTYPE)msofillShadeScale:
                case (MSOFILLTYPE)msofillShadeTitle:
                case (MSOFILLTYPE)msofillTexture:
                case (MSOFILLTYPE)msofillPattern:
                        if(!texture_bitmap)
                                throw std::runtime_error("FillProperties::EffectProperties Texture bitmap expected but not found.");

                        drawobj->SetFillMode(DrawLib::DrawObject::TEXTURED);

                        DrawLib::FPPoint p;
                        if(custom_bounding_box)
                                p = custom_bounding_box->upper_left;
                        else

                                p = fill_texture_bounding_box.upper_left;
                        p = p * drawparams.final_transformation;
                        drawobj->SetFillTexture(texture_bitmap, ToIPoint(p));
                        return true;
                }
        }

        return true;
}

void FillPart::ResetNecessaryProperties(DrawLib::DrawObject *drawobj) const
{
        drawobj->SetFillMode(DrawLib::DrawObject::SOLID);
}



/////////////////////////////////////////////////////////////////////////////
// Implementation class 'LinePart':

LinePart::LinePart(ShapeContainer const &shape_container, Properties const &properties)
: properties(properties)
{
        line_type              = (MSOLINETYPE)properties.Get   (Properties::lineType);
        line_width             = properties.GetAsPixelsFromEMUs(Properties::lineWidth, 0.0);
        line_dashing_mode      = (MSOLINEDASHING)properties.Get(Properties::lineDashing);
        line_flag              = properties.GetAsBoolean       (Properties::fLine);
        line_join_style        = (MSOLINEJOIN)properties.Get   (Properties::lineJoinStyle);
        line_end_cap_style     = (MSOLINECAP )properties.Get   (Properties::lineEndCapStyle);
        miter_limit            = properties.GetAsFloatFrom16_16(Properties::lineMiterLimit, 0.0f);
        filltextureblip = shape_container.GetProperties().GetPropertyAsBlip(Properties::lineFillBlip);
}

DrawLib::BitmapInterface const* LinePart::GenerateLineFillTexture(ShapeDrawParameters const &drawparams) const
{
        // Do we need to generate a texture at all?
        if(!line_flag ||
           (line_type != (MSOLINETYPE)msolineTexture &&
            line_type != (MSOLINETYPE)msolinePattern) )
                return NULL;

        if(!filltextureblip)
                throw std::runtime_error("Reading shape properties: Line fill texture expected, but not found.");

        std::unique_ptr<DrawLib::BitmapInterface> filltextureptr;

        // Rewind stream, in case this is not the first time this picture getsloaded:
        filltextureptr.reset(filltextureblip->GetUnprocessedBitmap());
        //FIXME: check for blip-find failure ?!?!

        DrawLib::Pixel32 line_color      = properties.GetColor(Properties::lineColor    , drawparams.scheme_colors);
        DrawLib::Pixel32 line_back_color = properties.GetColor(Properties::lineBackColor, drawparams.scheme_colors);

        // Is the bitmap a pattern ?
        if(line_type == (MSOLINETYPE)msolinePattern)
                // Fill it fot the foreground and backgroundlinecolor:
                FillPatternBitmapWithColors(filltextureptr.get(), line_color, line_back_color);

        return filltextureptr.release();
}

bool LinePart::EffectProperties(DrawLib::DrawObject *drawobj,
        DrawLib::OutlineEndcapModes::Type outline_endcap_mode,
        DrawLib::OutlineJoinModes::Type   outline_join_mode,
        bool use_linefill_as_fill, DrawLib::BitmapInterface const* outline_bitmap,
        ShapeDrawParameters const &drawparams) const
{
        if(!line_flag)
                return false;

        DrawLib::Pixel32 line_color      =
                properties.GetColor(Properties::lineColor    , drawparams.scheme_colors);
//        DrawLib::Pixel32 line_back_color =
//                properties.GetColor(Properties::lineBackColor, drawparams.scheme_colors);


        drawobj->SetOutlineColor(line_color);
        if(use_linefill_as_fill)
                drawobj->SetFillColor(line_color);

        float scaled_line_width = line_width * GetLinewidthScaleFactor(drawparams);

        drawobj->SetOutlineWidth(scaled_line_width);
        drawobj->SetOutlineEndcapMode(outline_endcap_mode);
        drawobj->SetOutlineJoinMode  (outline_join_mode  );
        drawobj->SetOutlineJoinMiterLimit(GetMiterLimit());

        if(scaled_line_width < 1) scaled_line_width = 1;

        // NOTE: A shape will never have dashed lines which are not solid.

        uint32_t dashing_style[6];

        switch(line_type)
        {
        // Fill with a solid color:
        case (MSOLINETYPE)msolineSolidType:
                switch(line_dashing_mode)
                {
                default:
                case msolineSolid:              // Solid (continuous) pen
                        drawobj->ResetOutlineDashing();
                        break;
                case msolineDashSys:            // PS_DASH system   dash style
                        drawobj->ResetOutlineDashing();
                        break;
                case msolineDotSys:             // PS_DOT system   dash style
                        dashing_style[0] = scaled_line_width;
                        dashing_style[1] = scaled_line_width;
                        drawobj->SetOutlineDashing(2, dashing_style);
                        break;
                case msolineDashDotSys:         // PS_DASHDOT system dash style
                        drawobj->ResetOutlineDashing();
                        break;
                case msolineDashDotDotSys:      // PS_DASHDOTDOT system dash style
                        drawobj->ResetOutlineDashing();
                        break;
                case msolineDotGEL:             // square dot style
                        drawobj->ResetOutlineDashing();
                        break;
                case msolineDashGEL:            // dash style
                        dashing_style[0] = 4 * scaled_line_width;
                        dashing_style[1] = 3 * scaled_line_width;
                        drawobj->SetOutlineDashing(2, dashing_style);
                        break;
                case msolineLongDashGEL:        // long dash style
                        dashing_style[0] = 8 * scaled_line_width;
                        dashing_style[1] = 3 * scaled_line_width;
                        drawobj->SetOutlineDashing(2, dashing_style);
                        break;
                case msolineDashDotGEL:         // dash short dash
                        dashing_style[0] = 4 * scaled_line_width;
                        dashing_style[1] = 3 * scaled_line_width;
                        dashing_style[2] = 1 * scaled_line_width;
                        dashing_style[3] = 3 * scaled_line_width;
                        drawobj->SetOutlineDashing(4, dashing_style);
                        break;
                case msolineLongDashDotGEL:     // long dash short dash
                        dashing_style[0] = 8 * scaled_line_width;
                        dashing_style[1] = 3 * scaled_line_width;
                        dashing_style[2] = 1 * scaled_line_width;
                        dashing_style[3] = 3 * scaled_line_width;
                        drawobj->SetOutlineDashing(4, dashing_style);
                        break;
                case msolineLongDashDotDotGEL:   // long dash short dash short dash
                        dashing_style[0] = 8 * scaled_line_width;
                        dashing_style[1] = 3 * scaled_line_width;
                        dashing_style[2] = 1 * scaled_line_width;
                        dashing_style[3] = 3 * scaled_line_width;
                        dashing_style[4] = 1 * scaled_line_width;
                        dashing_style[5] = 3 * scaled_line_width;
                        drawobj->SetOutlineDashing(6, dashing_style);
                        break;
                }

                drawobj->SetOutlineMode(DrawLib::DrawObject::SOLID);
                if(use_linefill_as_fill)
                        drawobj->SetFillMode(DrawLib::DrawObject::SOLID);
                return true;


        // Fill with a pattern (bitmap):
        case (MSOLINETYPE)msolinePattern:

                /* intentional fall-through */

        // A texture (pattern with its own color map):
        case (MSOLINETYPE)msolineTexture:
                if(use_linefill_as_fill)
                {
                        drawobj->SetFillMode(DrawLib::DrawObject::TEXTURED);
                        drawobj->SetFillTexture(outline_bitmap, DrawLib::IPoint());
                }
                drawobj->SetOutlineMode(DrawLib::DrawObject::TEXTURED);
                drawobj->SetOutlineTexture(outline_bitmap, DrawLib::IPoint());
                return true;

        // Center a picture in the shape:
        case (MSOLINETYPE)msolinePicture:
                throw std::runtime_error("EscherShape::EffectProperties Texture line fill not supported.");

        }

        throw std::runtime_error("EscherShape::EffectProperties Unrecognized line fill type encountered.");
}

void LinePart::StrokePath(DrawLib::DrawObject & drawobject,
        DrawLib::Path const& path,
        ShapeDrawParameters const &drawparams) const
{
        // Do we need to draw the line dashing, which is the big exception:
        if(line_dashing_mode  == msolineDotSys     &&
           line_end_cap_style == msolineEndCapRound)
        {
                // Now we must use the linecolor as solid fill:
                drawobject.SetFillMode (DrawLib::DrawObject::SOLID);
                drawobject.SetFillColor(properties.GetColor(Properties::lineColor,
                        drawparams.scheme_colors));

                float scaled_line_width = line_width * GetLinewidthScaleFactor(drawparams);
                if(scaled_line_width < 1) scaled_line_width = 1;

                std::vector<DrawLib::PolyLine> polylines;
                path.ConvertToPolylines(&polylines);

                for(unsigned i = 0; i < polylines.size(); ++i)
                {
                        // Draw the circle outline as line dashing, using a DrawLib::ContourIterater.
                        DrawLib::ContourIterator contour_iterator(polylines[i]);
                        DrawLib::PolyLine part;

                        for(;;)
                        {
                                contour_iterator.GetNextPart(&part, 2 * scaled_line_width);

                                if(!part.IsValid())
                                        break;

                                drawobject.DrawEllipse(
                                        part.points[0],
                                        DrawLib::FPSize(
                                          0.5 * scaled_line_width,
                                          0.5 * scaled_line_width));
                        }
                }

                return;
        }

        // Otherwise just stroke the path regularly:
        drawobject.StrokePath(path);
}

float LinePart::GetLinewidthScaleFactor(ShapeDrawParameters const &drawparams) const
{
        //ADDME: Verify linewidth formula with rotations?
        return std::min(
                drawparams.final_transformation.eM11,
                drawparams.final_transformation.eM22);
}
void LinePart::ResetNecessaryProperties(DrawLib::DrawObject *drawobj,
        bool use_linefill_as_fill) const
{
        drawobj->SetOutlineMode(DrawLib::DrawObject::SOLID);
        if(use_linefill_as_fill)
                drawobj->SetFillMode(DrawLib::DrawObject::SOLID);
}


/////////////////////////////////////////////////////////////////////////////
// Implementation class 'GeometryPart':

GeometryPart::GeometryPart(Properties const &_properties)
: properties(_properties)
{
        geo_left   = properties.Get(Properties::geoLeft);
        geo_top    = properties.Get(Properties::geoTop);
        geo_right  = properties.Get(Properties::geoRight);
        geo_bottom = properties.Get(Properties::geoBottom);

        DEBUGPRINT("Geo " << geo_left << "," << geo_top << "-" << geo_right << "," << geo_bottom);

        // To prevent division by zero..
        // ADDME: Arnold: waarom niet dichter bij de deling controleren? dat maakt het een stuk
        // makkelijker de code na te lopen dat delingen door 0 inderdaad voorkomen worden.
        if(geo_left == geo_right )
                geo_right ++;
        if(geo_top  == geo_bottom)
                geo_bottom++;

        // Try to read the 'pVertices' (325) property data:
        std::vector<uint8_t> const data = properties.GetComplex(Properties::pVertices);
        if(data.size()>0) // Found property ?:
        {
                vertices.reset(new IMsoVerticesArray(data));

                vertices->MakeRelativeToBox(geo_left, geo_top, geo_right, geo_bottom);
        }

        // Try to read the 'pSegmentInfo' (326) property data:
        std::vector<uint8_t> const data2 = properties.GetComplex(Properties::pSegmentInfo);
        if(data2.size()>0) // Found property ?:
        {
                segment_info.reset(new IMsoArray(data2));
        }
}

void throw_bounds_sanity_exception(uint16_t index, float value, float min, float max)
{
        std::ostringstream str;
        str << "Sanity check failed: An adjust value falls ";
        str << "out of its expected value-range: index="<<index;
        str << ", value="<<value<<" min="<<min<<" max="<<max;
        throw std::runtime_error(str.str());
}

float GeometryPart::GetAdjustX_Value(uint16_t index, float default_value) const
{
        bool use_default_value = false;

        float av = (float)(int32_t)properties.Get( (Properties::PropertyID)(Properties::adjustValue + index),
                                               &use_default_value);
        if(use_default_value)
                return default_value;

        return ((av-geo_left) * 2.0 / (geo_right-geo_left)) - 1.0;
}

float GeometryPart::GetAdjustX_ValueMinMax(uint16_t index, float default_value, float min, float max) const
{
        float f = GetAdjustX_Value(index, default_value);
        if(f < min || f > max)
                throw_bounds_sanity_exception(index, f, min, max);
        return f;
}

float GeometryPart::GetAdjustY_Value(uint16_t index, float default_value) const
{
        bool use_default_value = false;

        float av = (float)(int32_t)properties.Get(
                (Properties::PropertyID)(Properties::adjustValue + index),
                &use_default_value);

        if(use_default_value)
                return default_value;

        return ((av-geo_top) * 2.0 / (geo_bottom-geo_top)) - 1.0;
}

float GeometryPart::GetAdjustY_ValueMinMax(uint16_t index, float default_value, float min, float max) const
{
        float f = GetAdjustX_Value(index, default_value);
        if(f < min || f > max)
                throw_bounds_sanity_exception(index, f, min, max);
        return f;
}

float GeometryPart::GetAdjust16_16_Value(uint16_t index, float default_value, float min, float max) const
{
        bool use_default_value = false;

        int32_t av = (int32_t)properties.Get(
                (Properties::PropertyID)(Properties::adjustValue + index),
                &use_default_value);

        if(use_default_value)
                return default_value;

        float f=av / (float)(1<<16);
        if(f < min || f > max)
                throw_bounds_sanity_exception(index, f, min, max);
        return f;
}

float GeometryPart::GetScaledAdjustX_Value(uint16_t index, float defaultvalue, float aspect_ratio)const
{
        float adjust_x = GetAdjustX_Value(index, defaultvalue);

        if (aspect_ratio > 1.0)
            adjust_x = -1.0 + (1.0 + adjust_x) / aspect_ratio;

        return adjust_x;
}
float GeometryPart::GetScaledAdjustY_Value(uint16_t index, float defaultvalue, float aspect_ratio)const
{
        float adjust_y = GetAdjustY_Value(index, defaultvalue);

        if (aspect_ratio < 1.0)
            adjust_y = -1.0 + (1.0 + adjust_y) * aspect_ratio;

        return adjust_y;
}

/* FIXME: seeing that GeometryPart::ApplyToCanvas is only used by FreeFormShape::ApplyToCanvas,
   why not merge this in there? */
DrawLib::FPBoundingBox GeometryPart::ApplyToCanvas(TransformationState const &pars,
        ArrowHeadsPart *arrowheads_part, FillPart *fill_part, float line_width)
{
        path_open_with_arrowheads = true;

        if(!vertices.get() || vertices->vertices.size() < 2
           || !segment_info.get() || segment_info->points.size() < 4)
            throw std::runtime_error("Escher: corrupt GeometryPart without proper geometry information");

        path.reset(new DrawLib::Path());

        // Create an empty BB. At least the center point should fit in and
        // the point (0,0) is not guaranteed to fit in, so make it fit around
        // the center point only.
        DrawLib::FPPoint center = DrawLib::FPPoint(0,0) * pars.stored_transformation;
        DrawLib::FPBoundingBox outerbox(center,center);

        // Does the last segment close the path ?:
        if(((segment_info->points[segment_info->points.size()-1].y & 0xF000)>>12) == 0x6)
        {
                // Then do not use an arrowheads part object (if any defined):
                arrowheads_part = NULL;
                path_open_with_arrowheads = false;
        }

        // Is an arrowheads part defined ?:
        if(arrowheads_part)
        {
                // Get the current first and last points of the path
                // and thepoints next to those:
                DrawLib::FPPoint const& first   = vertices->vertices[0];
                DrawLib::FPPoint const& d_first = vertices->vertices[1];
                DrawLib::FPPoint const& last    = vertices->vertices[vertices->vertices.size()-1];
                DrawLib::FPPoint const& d_last  = vertices->vertices[vertices->vertices.size()-2];

                // Apply / map the arrowheads part to the same canvas
                outerbox = arrowheads_part->ApplyToCanvas(pars.stored_transformation,
                        first.x, first.y,
                        d_first.x, d_first.y,
                        last.x, last.y,
                        d_last.x, d_last.y,
                        line_width);

                // Naw make the 'connection points' the first and last
                // points of the path below.
        }

        unsigned ver_index = 0; // Index in vertices data

        // Need to connect to the back of a start arrow ?:
        if(arrowheads_part)
                path->MoveTo(arrowheads_part->GetConnectionPoint(ArrowHeadsPart::START));

        // Just need to take over the first point as starting point ?:
        else
                path->MoveTo(vertices->vertices[ver_index] * pars.stored_transformation); /* FIXME: perhaps stored_transfomration should go away here?*/

        ++ver_index;

        // Iterate points 2 to n-1, of the segment info which seem to tell
        // something about a segment.
        // FIXME: We should get some more knowledge about the segment info
        // data (allow to the documentation just of type 'IMsoArray' (array
        // of U16s)):
        unsigned si_index = 2; // Index in segment info
        while(si_index < segment_info->points.size()-1)
        {
                unsigned segment_type = (segment_info->points[si_index].y & 0xF000)>>12;

                // Is the next segment a bezier ? (?):
                if(segment_type == 0x2)
                {
                        // Not enough vertices left, which there should be ?:
                        if(ver_index+2 >= vertices->vertices.size())
                                break;

                        DrawLib::FPPoint last_point;
                        // Should the last point be a 'connection point' of an end arrow ?:
                        if(arrowheads_part && ver_index+2 == vertices->vertices.size()-1)
                                last_point = arrowheads_part->GetConnectionPoint(ArrowHeadsPart::END);
                        // ... or just the last point directly from the data ?:
                        else
                                last_point = vertices->vertices[ver_index+2] * pars.stored_transformation;


                        path->BezierTo(vertices->vertices[ver_index+0] *pars.stored_transformation,
                                       vertices->vertices[ver_index+1] *pars.stored_transformation,
                                last_point);

                        ver_index += 3;
                }
                // Is the next segment a line ? (?):
                else if(segment_type == 0x0)
                {
                        // Not enough vertices left, which there should be ?:
                        if(ver_index >= vertices->vertices.size())
                                break;

                        DrawLib::FPPoint last_point;
                        // Should the last point be a 'connection point' of an end arrow ?:
                        if(arrowheads_part && ver_index == vertices->vertices.size()-1)
                                last_point = arrowheads_part->GetConnectionPoint(ArrowHeadsPart::END);
                        // ... or just the last point directly from the data ?:
                        else
                                last_point = (vertices->vertices[ver_index]) * pars.stored_transformation;


                        path->LineTo(
                                last_point);

                        ver_index += 1;
                }
                // Is the next segment a line closing the path ? (?):
                else if(segment_type == 0x6)
                {
                        path->ClosePath();

                        break;
                }
                // Is the segment an unknown type ? (?):
                else
                {
                        break;
                }

                ++si_index;
        }

        DrawLib::FPBoundingBox bb = path->GetPathBoundingBox(DrawLib::OutlineEndcapModes::Flat
                                                            ,DrawLib::OutlineJoinModes::Rounded
                                                            ,line_width
                                                            ,-1);
        outerbox.ExtendTo(bb);

        if(fill_part)
            fill_part->ExtendBoundingBox(bb);

        return outerbox;
}


DrawLib::Path* GeometryPart::CreatePathToDraw(
        ShapeDrawParameters const &pars) const
{
        if(path.get())
        {
                std::unique_ptr<DrawLib::Path> local_path;
                // Make a local copy, to transform:
                local_path.reset(new DrawLib::Path(*path.get()));

                local_path->ApplyTransform(pars.final_transformation);

                return local_path.release();
        }

        return NULL;
}


/////////////////////////////////////////////////////////////////////////////
// Implementation class 'ArrowHeadsPart':

void ArrowHeadsPart::_arrow_head::CheckSanity() const
{
        if(type != msolineNoEnd &&
           type != msolineArrowEnd &&
           type != msolineArrowStealthEnd &&
           type != msolineArrowDiamondEnd &&
           type != msolineArrowOvalEnd &&
           type != msolineArrowOpenEnd)
        {
                std::ostringstream str;
                str << "ArrowHeads::_arrow_head::CheckSanity: Unrecognized type 0x";
                str << std::hex << type;
                throw std::runtime_error(str.str());
        }

        if(width != msolineNarrowArrow &&
           width != msolineMediumWidthArrow &&
           width != msolineWideArrow)
        {
                std::ostringstream str;
                str << "ArrowHeads::_arrow_head::CheckSanity: Unrecognized width 0x";
                str << std::hex << width;
                throw std::runtime_error(str.str());
        }

        if(length != msolineShortArrow &&
           length != msolineMediumLenArrow &&
           length != msolineLongArrow)
        {
                std::ostringstream str;
                str << "ArrowHeads::_arrow_head::CheckSanity: Unrecognized length 0x";
                str << std::hex << length;
                throw std::runtime_error(str.str());
        }
}

DrawLib::FPBoundingBox ArrowHeadsPart::_arrow_head::ApplyToCanvas(
        DrawLib::XForm2D const& transform,
        float x, float y, float _relative_rotation,
        float line_width)
{
        start = DrawLib::FPPoint(  x,   y) * transform;

        relative_rotation = _relative_rotation;
        return InternalApplyToCanvas(line_width);
}

DrawLib::FPBoundingBox ArrowHeadsPart::_arrow_head::ApplyToCanvas(
        DrawLib::XForm2D const& transform,
        float x, float y, float d_x, float d_y,
        float line_width)
{
        // These coordinates need directly to get stored in pixel units:
        start                      = DrawLib::FPPoint(  x,   y) * transform;
        DrawLib::FPPoint direction = DrawLib::FPPoint(d_x, d_y) * transform;

        // Calculate the rotation:
        relative_rotation = Escher::GetDirectionTo(start, direction);

        return InternalApplyToCanvas(line_width);
}

DrawLib::FPBoundingBox ArrowHeadsPart::_arrow_head::InternalApplyToCanvas(
        float line_width)
{
        // Find the width in pixels:
        // (With hardcoded visual approximations)
        float p_width = 0.0;
        switch(width)
        {
        case msolineNarrowArrow:
                p_width =  3.5+0.75*(line_width-1.0);
                break;
        case msolineMediumWidthArrow:
                p_width =  5.5+1.1*(line_width-1.0);
                break;
        case msolineWideArrow:
                p_width =  7.5+2.2*(line_width-1.0);
                break;
        default:
                throw std::runtime_error("Escher: ArrowHead unknown arrow width type");
        }

        // Find the length in pixels:
        // (With hardcoded visual approximations)
        float p_length = 0.0;
        switch(length)
        {
        case msolineShortArrow:
                p_length =  7 + 1.5*(line_width-1.0);
                break;
        case msolineMediumLenArrow:
                p_length = 11 + 2.2*(line_width-1.0);
                break;
        case msolineLongArrow:
                p_length = 15 + 4.4*(line_width-1.0);
                break;
        default:
                throw std::runtime_error("Escher: ArrowHead unknown arrow length type");
        }

        // To prevent floating point instruction errors:
        for(int i=0; i<4; ++i)
                corner[i] = DrawLib::FPPoint(0,0);

        int number_of_used_corners = 0;
        bool do_rotate = true;
        cut_off_length = 0;

        // Calculate the type specific cornerpoints:
        switch(type)
        {
        case msolineArrowEnd:
                corner[0] = start + DrawLib::FPPoint(-p_width, -p_length);
                corner[1] = start + DrawLib::FPPoint( p_width, -p_length);
                corner[2] = start + DrawLib::FPPoint( 0      , -p_length);
                line_width = 0.0;
                number_of_used_corners = 3;
                cut_off_length = p_length;
                break;

        case msolineArrowStealthEnd:
                corner[0] = start + DrawLib::FPPoint(-p_width, -p_length);
                corner[1] = start + DrawLib::FPPoint( p_width, -p_length);
                corner[2] = start + DrawLib::FPPoint( 0      , -(2.0*p_length) / 3.0);
                line_width = 0.0;
                number_of_used_corners = 3;
                cut_off_length = (2.0*p_length) / 3.0;
                break;

        case msolineArrowDiamondEnd:
                p_length /= 2;

                corner[0] = start + DrawLib::FPPoint(-p_width,   0);
                corner[1] = start + DrawLib::FPPoint( 0,  p_length);
                corner[2] = start + DrawLib::FPPoint( p_width,   0);
                corner[3] = start + DrawLib::FPPoint( 0, -p_length);
                line_width = 0.0;
                number_of_used_corners = 4;
                break;

        case msolineArrowOvalEnd:
                p_length /= 2;

                corner[0] = start + DrawLib::FPPoint(-p_length, 0);
                corner[1] = start + DrawLib::FPPoint( 0,  p_width);
                corner[2] = start + DrawLib::FPPoint( p_length, 0);
                corner[3] = start + DrawLib::FPPoint( 0, -p_width);
                number_of_used_corners = 4;
                line_width = 0.0;
                do_rotate = false;
                break;

        case msolineArrowOpenEnd:
                corner[0] = start + DrawLib::FPPoint(-p_width, -p_length);
                corner[1] = start + DrawLib::FPPoint( p_width, -p_length);
                corner[2] = start + DrawLib::FPPoint( 0, -floor(line_width/2));
                number_of_used_corners = 3;
                cut_off_length = floor(line_width/2);
                break;

        case msolineNoEnd:
                break;

        default:
                throw std::runtime_error("Escher: ArrowHead unknown arrow ending type");
        }

        // Optionally do the rotation and
        // always add all points to the outer bounding box:
        DrawLib::FPBoundingBox fullbox (start - DrawLib::FPPoint(line_width/2, line_width/2)
                                       ,start + DrawLib::FPPoint(line_width/2, line_width/2));
        for(int i=0; i<number_of_used_corners; i++)
        {
                if(do_rotate)
                    RotateAroundRad(start, &corner[i], relative_rotation);
                fullbox.ExtendTo(corner[i] - DrawLib::FPPoint(line_width/2, line_width/2));
                fullbox.ExtendTo(corner[i] + DrawLib::FPPoint(line_width/2, line_width/2));
        }
        return fullbox;
}

void ArrowHeadsPart::_arrow_head::ApplyTransform(DrawLib::XForm2D transformation)
{
        start *= transformation;
        for(int i=0; i<4; ++i)
                corner[i] *= transformation;
}

DrawLib::FPPoint ArrowHeadsPart::_arrow_head::GetConnectionPoint() const
{
        switch(type)
        {
        case (MSOLINEEND)msolineNoEnd:
        case (MSOLINEEND)msolineArrowDiamondEnd:
        case (MSOLINEEND)msolineArrowOvalEnd:
                break; //ADDME?

        case (MSOLINEEND)msolineArrowOpenEnd:
        case (MSOLINEEND)msolineArrowEnd:
        case (MSOLINEEND)msolineArrowStealthEnd:
                return corner[2];
        }

        return start;
}

void ArrowHeadsPart::_arrow_head::Draw(
        DrawLib::XForm2D const& transformation, DrawLib::DrawObject & drawobject) const
{
        drawobject.SetOutlineEndcapMode(DrawLib::OutlineEndcapModes::Rounded );
        drawobject.SetOutlineJoinMode  (DrawLib::OutlineJoinModes::Rounded);

        DrawLib::FPPoint d_start = start * transformation;
        DrawLib::FPPoint d_corner[4];
        for(int i=0; i<4; i++)
            d_corner[i] = corner[i] * transformation;

        switch(type)
        {
        case (MSOLINEEND)msolineNoEnd:
                break;

        case (MSOLINEEND)msolineArrowEnd:
                {
                DrawLib::Polygon polygon;
                polygon.points.push_back(d_start);
                polygon.points.push_back(d_corner[0]);
                polygon.points.push_back(d_corner[1]);
                drawobject.DrawPolygon(polygon);
                }
                break;


        case (MSOLINEEND)msolineArrowStealthEnd:
                {
                DrawLib::Polygon polygon;
                polygon.points.push_back(d_start);
                polygon.points.push_back(d_corner[0]);
                polygon.points.push_back(d_corner[2]);
                polygon.points.push_back(d_corner[1]);
                drawobject.DrawPolygon(polygon);
                }
                break;


        case (MSOLINEEND)msolineArrowDiamondEnd:
                {
                DrawLib::Polygon polygon;
                polygon.points.push_back(d_corner[0]);
                polygon.points.push_back(d_corner[1]);
                polygon.points.push_back(d_corner[2]);
                polygon.points.push_back(d_corner[3]);
                drawobject.DrawPolygon(polygon);
                }
                break;


        case (MSOLINEEND)msolineArrowOvalEnd:
                drawobject.DrawEllipse(
                        d_start,
                        DrawLib::FPSize(
                                d_start.x - d_corner[0].x,
                                d_corner[1].y - d_start.y));
                break;


        case (MSOLINEEND)msolineArrowOpenEnd:
                drawobject.ResetOutlineDashing();
                DrawLib::Path path;

                path.MoveTo(d_corner[0]);
                path.LineTo(d_start);
                path.LineTo(d_corner[1]);
                drawobject.StrokePath(path);
                break;

        }
}


ArrowHeadsPart::ArrowHeadsPart(Properties const &properties)
{
        // Start:
        arrow_head[0].type   = (MSOLINEEND      )properties.Get(Properties::lineStartArrowhead);
        arrow_head[0].width  = (MSOLINEENDWIDTH )properties.Get(Properties::lineStartArrowWidth);
        arrow_head[0].length = (MSOLINEENDLENGTH)properties.Get(Properties::lineStartArrowLength);
        arrow_head[0].CheckSanity();
        // End:
        arrow_head[1].type   = (MSOLINEEND      )properties.Get(Properties::lineEndArrowhead);
        arrow_head[1].width  = (MSOLINEENDWIDTH )properties.Get(Properties::lineEndArrowWidth);
        arrow_head[1].length = (MSOLINEENDLENGTH)properties.Get(Properties::lineEndArrowLength);
        arrow_head[1].CheckSanity();
}

DrawLib::FPBoundingBox ArrowHeadsPart::ApplyToCanvas(
        DrawLib::XForm2D const& transform,
        float start_x  , float start_y  ,
        float start_d_x, float start_d_y,
        float end_x    , float end_y    ,
        float end_d_x  , float end_d_y  ,
        float line_width)
{
        // Start:
        DrawLib::FPBoundingBox outerbox;
        outerbox = arrow_head[0].ApplyToCanvas(transform, start_x, start_y, start_d_x, start_d_y, line_width);

        // End:
        outerbox.ExtendTo(arrow_head[1].ApplyToCanvas(transform, end_x, end_y, end_d_x, end_d_y, line_width));
        return outerbox;
}

DrawLib::FPBoundingBox ArrowHeadsPart::ApplyToCanvas(
        DrawLib::XForm2D const& transform,
        float start_x  , float start_y  ,
        float relative_start_angle,
        float end_x    , float end_y    ,
        float relative_end_angle,
        float line_width)
{
        // Start:
        DrawLib::FPBoundingBox outerbox;
        outerbox = arrow_head[0].ApplyToCanvas(transform, start_x, start_y, relative_start_angle, line_width);

        // End:
        outerbox.ExtendTo(arrow_head[1].ApplyToCanvas(transform, end_x, end_y, relative_end_angle, line_width));
        return outerbox;
}

void ArrowHeadsPart::ApplyTransform(DrawLib::XForm2D transformation)
{
        arrow_head[0].ApplyTransform(transformation);
        arrow_head[1].ApplyTransform(transformation);
}

DrawLib::FPPoint ArrowHeadsPart::GetConnectionPoint(arrowhead_index ai) const
{
        return arrow_head[ai].GetConnectionPoint();
}

void ArrowHeadsPart::Draw(
        DrawLib::XForm2D const& transformation, DrawLib::DrawObject & drawobj) const
{
        arrow_head[0].Draw(transformation, drawobj);
        arrow_head[1].Draw(transformation, drawobj);
}



/////////////////////////////////////////////////////////////////////////////
// Implementation class 'BlipRenderPart':

BlipRenderPart::BlipRenderPart(Properties const &properties)
{
        render_properties.reset(new BlipRenderProperties());

        // Read all necessary properties:
        render_properties->cropFromTop       = properties.GetAsFloatFrom16_16(Properties::cropFromTop, 0.0f);
        render_properties->cropFromBottom    = properties.GetAsFloatFrom16_16(Properties::cropFromBottom, 0.0f);
        render_properties->cropFromLeft      = properties.GetAsFloatFrom16_16(Properties::cropFromLeft, 0.0f);
        render_properties->cropFromRight     = properties.GetAsFloatFrom16_16(Properties::cropFromRight, 0.0f);
        render_properties->pictureConstrast  = 0;     // not used anyway..
        render_properties->pictureBrightness = 0;     // not used anyway..
        render_properties->pictureGray       = properties.GetAsBoolean(Properties::pictureGray);
}

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers
