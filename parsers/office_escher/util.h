#ifndef blex_parsers_office_escher_util
#define blex_parsers_office_escher_util

#include <blex/blexlib.h>
#include <drawlib/drawlibv2/drawobject.h>
#include <cmath>

#include "properties.h"

namespace Parsers {
namespace Office {
namespace Escher {

class ShapeContainer;
struct BlipRenderProperties;
struct ShapeDrawParameters;
struct TransformationState;

/**
 * Converts a floatingpoint point to an integer point.
 */
inline DrawLib::IPoint ToIPoint(DrawLib::FPPoint const &p)
{
        return DrawLib::IPoint(p.x, p.y);
}

/**
 * Rotates a point around a given center. This function expects the sinus and
 * cosinus of the rotation as a optimization.
 * @param center The center point to rotate around.
 * @param point The point getting rotated.
 * @param cos The cosinus of the amount to rotate.
 * @param sin The sinus of the amount to rotate.
 */
void RotateAroundInternal(DrawLib::FPPoint const &center, DrawLib::FPPoint *point,
        float cos, float sin);

/**
 * Rotates a point around a given center; angle given in radials.
 * @param center The center point to rotate around.
 * @param point The point getting rotated.
 * @param radials The amount to rotate in radials. This may
 * be negative.
 */
void RotateAroundRad(DrawLib::FPPoint const &center, DrawLib::FPPoint *point,
        float radials);

/**
 * Returns the direction in radials from a point to another.
 * @param base The base point.
 * @param direction The direction point.
 * @return The direction, in radials.
 */
extern float GetDirectionTo(DrawLib::FPPoint const &base,
        DrawLib::FPPoint const &direction);

inline float Distance(DrawLib::FPPoint const &p1,DrawLib::FPPoint const &p2)
{
        return sqrt( (p1.x-p2.x)*(p1.x-p2.x) + (p1.y-p2.y)*(p1.y-p2.y) );
}

float GetAspectRatio(DrawLib::XForm2D const &stored_transformation);

inline DrawLib::FPPoint GetBBoxCenter(DrawLib::FPBoundingBox const &bbox)
{
        return bbox.upper_left + DrawLib::FPPoint(bbox.GetWidth()/2, bbox.GetHeight()/2);
}

/**
 * Calculates an unrotated outer bounding box of a given bounding
 * box on which a given transformation is applied.
 *
 * @param bounding_box The untransformed bounding box.
 * @param transformation The transformation.
 *
 * @return The unrotated outer bounding box.
 */
DrawLib::FPBoundingBox GetOuterBoundingBoxOfTransformedBoundingBox(
        DrawLib::FPBoundingBox const& bounding_box,
        DrawLib::XForm2D const& transformation);


using Escher::ShapeDrawParameters;
using Escher::TransformationState;

// Class, used to read all properties from, defined in escher.h
class Properties;



/**
 * Class used by shape implementing classes, which use fill
 * properties and functionality.
 */
class TextPart
{
        /** The host defined text identifier. */
        uint32_t text_id;
        /** The shapeid. */
        int32_t text_shape_id;
        /** The inner left margin of the text. */
        int text_left_margin;
        /** The inner top margin of the text. */
        int text_top_margin;
        /** The inner right margin of the text. */
        int text_right_margin;
        /** The inner bottom margin of the text. */
        int text_bottom_margin;

        /** Text: Use host margin calculations. */
        bool text_auto_text_margin;
        /** Text: Rotate text with shape. */
        bool text_rotate_text;
        /** Text: Size shape to fit text size. */
        bool text_shape_to_text;
        /** Text: Size text to fit shape size. */
        bool text_text_to_shape;

        /** The text direction. Property 'txflTextFlow' (136). */
        MSOTXFL text_direction;


        /** The line width used for the shape, this text box is owned by. */
        float line_width;

        /** Properties */
        Properties const &properties;

        /**
         * The bounding box for the text, in the coordinate space
         * [-1,-1,  1,1]. The user of a TextPart should call the
         * member function 'SetupTextBox' at least once to set this box.
         */
        DrawLib::FPBoundingBox bounding_box;

        /**
         * The bounding box for the text, in pixels. The user of a TextPart
         * should call the member function 'ApplyTextBoxToCanvas' at least
         * once (after a call to 'SetupTextBox') to set this box, which get
         * calculated from 'bounding_box'.
         */
        DrawLib::FPBoundingBox pixel_bounding_box;


public:
        TextPart(Properties const &properties, int32_t shapeid);

        /**
         * Prepares for a (next) canvas setting the text-bounding-box.
         *
         * @param pars The common canvas parameters.
         * @param text_m_left The (unresized/unrotated) left of the textbox, relative
         * to the shape bounding-box, expected to be in [-1.0 - 1.0].
         * @param text_m_top The (unresized/unrotated) top of the textbox, raletive
         * to the shape bounding-box, expected to be in [-1.0 - 1.0].
         * @param text_m_right The (unresized/unrotated) right of the textbox, raletive
         * to the shape bounding-box, expected to be in [-1.0 - 1.0].
         * @param text_m_bottom The (unresized/unrotated) bottom of the textbox, raletive
         * to the shape bounding-box, expected to be in [-1.0 - 1.0].
         */
        void SetupTextBox(
                float text_m_left , float text_m_top   ,
                float text_m_right, float text_m_bottom);

        /**
         * Sets the line width.
         * @param _line_width The line width.
         */
        void SetLineWidth(float _line_width)
        {
                line_width = _line_width;
        }

        /**
         * Applies the given transformation to the box, given in
         * member function 'SetupTextBox'.
         * @param transform The transformation to get applied.
         */
        void ApplyTransform(DrawLib::XForm2D const& transform)
        {
                bounding_box *= transform;
        }

        /**
         * @return If any text is defined, by the properties.
         */
        bool DoWeNeedToDrawText() const
        {
                return (bool)text_id;
        }

        /**
         * Calculates the text box, created by vcalls to 'SetupTextBox',
         * 'SetLineWidth' and 'ApplyTransform', in pixel-units.
         *
         * @return The calculated / stored bounding box. Warning: The volumen
         * of the returned BB might be empty. In this case the width of height
         * is negative, this BB is not defined and should get ignored.
         */
        DrawLib::FPBoundingBox ApplyTextBoxToCanvas(
                TransformationState const& pars);

        void Draw(ShapeDrawParameters const &pars) const;
};


/**
 * Constant for the gammma correction. 2.2 seems to be the one
 * used by MS Escher. Also there can be found many information about
 * this correctionvalue on the internet.
 */
extern const float gamma_correction_constant;

/**
 * Class used by shape implementing classes, which use fill
 * properties and functionality.
 */
class FillPart
{
        /** Is this shape filled ? */
        bool fill_flag;
        /** The type of filling for this shape. */
        MSOFILLTYPE fill_type;

        /** Pattern defined for shape ? */
        bool fill_pattern_flag;
        /** Angle of a shade (gradient) fill, in degrees. */
        float fill_angle;
        /** Focus of a shade (gradient) fill, expected to be -50, 0, 50 or 100. */
        int32_t fill_focus;
        /** Fill to left property value. */
        float fill_to_left;
        /** Fill to top property value. */
        float fill_to_top;
        /** Fill to right property value. */
        float fill_to_right;
        /** Fill to bottom property value. */
        float fill_to_bottom;
        /**
         * The optional extra shade-fill-colors.
         * It is NULL if the (complex) property is not set for this shape.
         */
        std::unique_ptr<IMsoColorsArray> shade_colors;
        /** The fill shade type, for shaded (gradient) fills. */
        uint32_t fill_shade_type;
        /**
         * When filling with type 'shade shape':
         * TRUE: To (outer) outline of the shape.
         * FALSE: To outer bounding box of outline of the shape.
         */
        bool shade_shape_to_outline;

        /** Primary / foreground opacity. */
        float fill_opacity;
        /** Background opacity. */
        float fill_back_opacity;

public:
        FillPart(ShapeContainer const &shape_container,
                Properties const &properties, bool shade_shape_to_outline,
                bool fill_flag_default);

        bool DoWeNeedToFill() const
        {
                return fill_flag;
        }

        void ExtendBoundingBox(DrawLib::FPBoundingBox const &bbox);

        /**
         * Generates a fill texture for the shape, if necessary. This can be a
         * shaded fill texture, with the correct size or a resized picture.
         * @param custom_bounding_box When not null, this box defines the
         * bounding box of a given bitmap, instead of the bounding box of
         * this FillPart.
         * @return The fill texture bitmap or NULL if no shade fill is defined for the shape.
         */
        DrawLib::BitmapInterface const *GenerateFillTexture(ShapeDrawParameters const &drawparams,
                DrawLib::Path const& path,
                DrawLib::FPBoundingBox const* custom_bounding_box) const;

private:
        /**
         * Generates a fill texture, filling from the outline of the shape, to
         * the center of the bounding box.
         * @param texture_bitmap The texture bitmap to fill.
         * @param path The path defining the shape fill with a transformation
         * to in texture coordinates.
         * @param width  The width  of the texture.
         * @param height The height of the texture.
         *
         * @param corrected_fill_color The precalculated, cashed and corrected
         * fill color.
         * @param corrected_fill_back_color The precalculated, cashed and corrected
         * fill-back color.
         */
        void GetShapeFormedGradientFillTexture(
                DrawLib::BitmapInterface &texture_bitmap,
                DrawLib::Path const& path,
                uint32_t width, uint32_t height,ShapeDrawParameters const &pars,
                DrawLib::Pixel32 const& corrected_fill_color,
                DrawLib::Pixel32 const& corrected_fill_back_color) const;

        /**
         * Generates a shade color for the texture bitmap.
         * @param i Index in the shade, in [0.0, 1.0].
         *
         * @param corrected_fill_color The precalculated, cashed and corrected
         * fill color.
         * @param corrected_fill_back_color The precalculated, cashed and corrected
         * fill-back color.
         */
        DrawLib::Pixel32 GetShadeFillTextureColor(float i,
                DrawLib::Pixel32 const& corrected_fill_color,
                DrawLib::Pixel32 const& corrected_fill_back_color) const;

public:
        /**
         * Writes as many fill properties to drawlib as possible. It uses
         * a fill texture if necessary.
         * @param drawinfo The used drawinfo object.
         * @param use_pattern Wether to prepare to use a pattern or just
         * the foreground color.
         * @param texture_bitmap The returnvalue of function 'GenerateTexture'
         * unchanged. (This might be even NULL.)
         * @param fill_color_factor If parameter 'use_pattern' is false, the
         * factor to 'multiply' the foreground color with, in <0.0 - 2.0>.
         * @param custom_bounding_box When not null, this box defines the
         * bounding box of a given bitmap, instead of the bounding box of
         * this FillPart.
         */
        bool EffectProperties(DrawLib::DrawObject *drawinfo,
                bool use_pattern,
                DrawLib::BitmapInterface const *texture_bitmap,
                float fill_color_factor,
                DrawLib::FPBoundingBox const* custom_bounding_box,
                ShapeDrawParameters const &drawparams) const;

        /**
         * Resets all resources, given to DrawLib in the member function
         * 'EffectProperties', which is still used, so that these resources
         * can get freeed / released.
         * Such a resource iss for example a fill bitmap.
         */
        void ResetNecessaryProperties(DrawLib::DrawObject *drawinfo) const;

        /**
          * Return the fill color of this FillPart, used by the text formatter */
        DrawLib::Pixel32 GetFillColor(ShapeDrawParameters const &drawparams);

private:
        // From here all canvas depending fields:

        /**
         * The bounding box for the fill texture for this shape.
         * It has original-canvas-pixels as units and is canvas dependant.
         */
        DrawLib::FPBoundingBox fill_texture_bounding_box;

        //Propertie associated with the shape
        Properties const &properties;

        void GetFillTextureBitmap(std::unique_ptr<DrawLib::BitmapInterface> *textureptr) const;

        msoBlip const *filltextureblip;
};


/**
 * Class used by shape implementing classes, which use line
 * properties and functionality.
 *
 * About outline bitmaps: One should get generated and then owned after a call to
 * 'GenerateLineFillTexture'. After that it can get used once or more with
 * 'EffectPrioperties'. After a call to 'ResetNecessaryProperties', it can
 * freely get deleted.
 */
class LinePart
{
        /** Wether this shape has an outline or not. */
        bool line_flag;
        /** The type of line fill. */
        MSOLINETYPE line_type;
        /** The line width in pixels. */
        float line_width;
        /** The line dashing mode. (property 462) */
        MSOLINEDASHING line_dashing_mode;

        /** The miter limit to use when drawing in miter mode. */
        float miter_limit;

        /** The way to join polygon lines. */
        MSOLINEJOIN line_join_style;
        /** The way to end (polygon) lines. */
        MSOLINECAP line_end_cap_style;

        //Propertie associated with the shape
        Properties const &properties;

        msoBlip const *filltextureblip;

public:
        LinePart(ShapeContainer const &shape_container,
                Properties const &properties);

        bool IsSet() const
        {
                return line_flag;
        }

        float GetLineWidth() const
        {
                return line_width;
        }

        float GetMiterLimit() const
        {
                return (6/10.0)*line_width*miter_limit;
        }

        /**
         * Generates a outline-bitmap, if necessary. From a call to this function,
         * the user of a LinePart has the ownership of the bitmap. Use the function
         * 'ResetNecessaryProperties' to make DrawLib not use this bitmap any more.
         *
         * @return A pointer to the bitmap or NULL if no bitmap is defined.
         */
        DrawLib::BitmapInterface const* GenerateLineFillTexture(ShapeDrawParameters const &drawparams) const;

        /**
         * Writes as many line properties to drawlib as possible.
         * @param drawinfo The draw context.
         * @param miter_mode The miter mode to use.
         * @param use_linefill_as_fill Wether also to set the fill color and
         * texture with the line color and fill texture, next to the ouline
         * color and texture.
         * @param outline_bitmap The literal return value, of the member
         * function 'GetLineFillTexture'.
         *
         * @return Wether there is an outline to draw at all.
         */
        bool EffectProperties(DrawLib::DrawObject *drawinfo,
                DrawLib::OutlineEndcapModes::Type outline_endcap_mode,
                DrawLib::OutlineJoinModes::Type  outline_join_mode,
                bool use_linefill_as_fill, DrawLib::BitmapInterface const* outline_bitmap,
                ShapeDrawParameters const &drawparams) const;

        /**
         * Convenience function to stroke a path. This function will allways
         * use the correct line-dashing, even the big circal-line-dashing exception.
         *
         * @param drawobject The context to draw in.
         * @param path The path to get stroken.
         * @param drawparams The current drawparameters object.
         */
        void StrokePath(DrawLib::DrawObject & drawobject,
                DrawLib::Path const& path,
                ShapeDrawParameters const &drawparams) const;

        /**
         * Resets all resources, given to DrawLib in the member function
         * 'EffectProperties', which is still used, so that these resources
         * can get freeed / released.
         * Such a resource iss for example a fill bitmap.
         *
         * @param use_linefill_as_fill Wether also the fill color and
         * texture with the line color and fill texture where set, next to the ouline
         * color and texture. If so, these get also reset.
         */
        void ResetNecessaryProperties(DrawLib::DrawObject *drawinfo,
                bool use_linefill_as_fill) const;

private:
        /** Calculates the scale factor for the line width. */
        float GetLinewidthScaleFactor(
                ShapeDrawParameters const &drawparams) const;
};


/**
 * Refills a 2-color bitmap, with two colors.
 * @param texture The 2-color bitmap.
 * @param color1 The color for pixels, being non-black.
 * @param color2 The color for pixels, being black.
 */
void FillPatternBitmapWithColors(DrawLib::BitmapInterface *texture,
        DrawLib::Pixel32 const &color1, DrawLib::Pixel32 const &color2);



/**
 * Class used by shape implementing classes, which use arrowhead
 * properties and draw arrowheads.
 */
class ArrowHeadsPart
{
        /** Contains all data of one arrowhead. */
        struct _arrow_head
        {
                /** The type of start arrowhead. */
                MSOLINEEND type;
                /** The type of start arrowhead. */
                MSOLINEENDWIDTH width;
                /** The type of end arrowhead. */
                MSOLINEENDLENGTH length;

                /**
                 * The starting point (point of arrowhead).
                 * (Canvas dependant.)
                 */
                DrawLib::FPPoint start;
                /**
                 * The rotation. (Canvas dependant.)
                 */
                float relative_rotation;

                /**
                 * The two corner points of an arrowhead
                 * (only first 2 used) or the four of an diamond.
                 * (Canvas dependant.)
                 */
                DrawLib::FPPoint corner[4];

                float cut_off_length;

                /**
                 * Throws an exception if one of the
                 * properties cannot be valid.
                 */
                void CheckSanity() const;

                /**
                 * Calculates the positions of the point and corner points,
                 * if necessary. And if so, it makes the outer bounding
                 * box fit around those corner points.
                 *
                 * @param pars The common apply to canvas parameters.
                 * @param x The shape-relative position, on the X-axis,
                 * of the startpoint of the arrow.
                 * @param y The shape-relative position, on the Y-axis,
                 * of the startpoint of the arrow.
                 *
                 * @param d_x The shape-relative position on the X-axis, of the
                 * directionpoint of the arrow.
                 * @param d_y The shape-relative position on the Y-axis, of the
                 * directionpoint of the arrow.
                 *
                 * @param line_width The line width.
                 *
                 * @param only_scale When true, only the transform of the stored
                 * transformation is used. Otherwise the entire transformation
                 * gets used.
                 */
                DrawLib::FPBoundingBox ApplyToCanvas(
                        DrawLib::XForm2D const& transform,
                        float x, float y, float d_x, float d_y,
                        float line_width);

                DrawLib::FPBoundingBox ApplyToCanvas(
                        DrawLib::XForm2D const& transform,
                        float x, float y, float relative_rotation,
                        float line_width);

                void ApplyTransform(DrawLib::XForm2D transformation);

        private:
                DrawLib::FPBoundingBox InternalApplyToCanvas(
                        float line_width);

        public:
                /**
                 * Returns the point of this arrowhead to where the connected
                 * line should get drawn.
                 * @return The connection point.
                 */
                DrawLib::FPPoint GetConnectionPoint() const;


                /**
                 * Draws this arrowhead.
                 * @param drawobject The draw context.
                 * @param transformation The amount to transform.
                 */
                void Draw(
                        DrawLib::XForm2D const& transformation, DrawLib::DrawObject & drawobject) const;
        };
        /** Data of the start and end arrowhead. */
        struct _arrow_head arrow_head[2];

public:
        /**
         * Constructor, reading the necessary properties.
         */
        ArrowHeadsPart(Properties const &properties);

        /**
         * Applies the arrowheads to a canvas.
         * @param pars The common parameters for applying to a canvas.
         *
         * @param start_x The shape-relative position on the X-axis, of the
         * startpoint of the start arrow.
         * @param start_y The shape-relative position on the Y-axis, of the
         * startpoint of the start arrow.
         * @param start_d_x The shape-relative position on the X-axis, of the
         * directionpoint of the start arrow.
         * @param start_d_y The shape-relative position on the Y-axis, of the
         * directionpoint of the start arrow.
         *
         * @param end_x The shape-relative position on the X-axis, of the
         * startpoint of the end arrow.
         * @param end_y The shape-relative position on the Y-axis, of the
         * startpoint of the end arrow.
         * @param end_d_x The shape-relative position on the X-axis, of the
         * directionpoint of the end arrow.
         * @param end_d_y The shape-relative position on the Y-axis, of the
         * directionpoint of the end arrow.
         * @param line_width The line width of the shape (Property 459).
         *
         * @param only_scale When true, only the scaling of the stored
         * transformation is used. Otherwise the entire transformation
         * gets used.
         */
        DrawLib::FPBoundingBox ApplyToCanvas(DrawLib::XForm2D const& transform,
                float start_x  , float start_y  ,
                float start_d_x, float start_d_y,
                float end_x    , float end_y    ,
                float end_d_x  , float end_d_y  ,
                float line_width);

        DrawLib::FPBoundingBox ApplyToCanvas(DrawLib::XForm2D const& transform,
                float start_x  , float start_y  ,
                float relative_start_angle,
                float end_x    , float end_y    ,
                float relative_end_angle,
                float line_width);

        void ApplyTransform(DrawLib::XForm2D transformation);

        /** Constants for the start and end index. */
        typedef enum
        {
                START = 0,
                END = 1
        } arrowhead_index;

        float GetCutOffLength() const
        {
                return arrow_head[START].cut_off_length +arrow_head[END].cut_off_length;
        }


        /**
         * Returns the point of an arrowhead to where the connected
         * line should get drawn.
         * @param ai The arrowhead index.
         * @return The connection point.
         */
        DrawLib::FPPoint GetConnectionPoint(arrowhead_index ai) const;


        /**
         * Draws the arrowheads.
         * @param drawobject The draw context.
         * @param transformation The amount to transform.
         */
        void Draw(
                DrawLib::XForm2D const& transformation, DrawLib::DrawObject & drawobject) const;
};



/**
 * Class used by shape implementing classes, which use ajust-value
 * properties.
 */
class GeometryPart
{
        /**
         * A pointer to the class containing the properties to read from.
         * The instance is not owned by this class.
         */
        Properties const &properties;

        /** The geo box left side, from property 320. */
        uint32_t geo_left;
        /** The geo box top side, from property 321. */
        uint32_t geo_top;
        /** The geo box right side, from property 322. */
        uint32_t geo_right;
        /** The geo box bottom side, from property 323. */
        uint32_t geo_bottom;

        /**
         * When not NULL, this contains the array of vertices, for
         * a freeform path to draw, from property 'pVertices' (325).
         */
        std::unique_ptr<IMsoVerticesArray> vertices;

        /**
         * When not NULL, this contains the array of vertices, for
         * a freeform path to draw, from property 'pVertices' (325).
         */
        std::unique_ptr<IMsoArray> segment_info;

        /** Contains the last path mapped / applied to the last canvas. */
        std::unique_ptr<DrawLib::Path> path;

        /** See function 'IsPathOpenWithArrowheads'. It gets set in 'ApplyToCanvas'. */
        bool path_open_with_arrowheads;


public:
        GeometryPart(Properties const &properties);

        /**
         * Returns a horizontal adjust value relative to the geo box, where the geo box
         * fits between -1.0 and 1.0.
         * @param index The index in the list of ajust-value properties.
         * @param default_value The value returned, when no adjust value was found
         * in the shape properties itself.
         */
        float GetAdjustX_Value(uint16_t index, float default_value) const;
        float GetAdjustX_ValueMinMax(uint16_t index, float default_value, float min, float max) const;
        /**
         * Returns a horizontal adjust value relative to the geo box, where the geo box
         * fits between -1.0 and 1.0. The returnvalue must fall in [min, max], otherwise
         * an exception is thrown.
         * @param index The index in the list of ajust-value properties.
         * @param default_value The value returned, when no adjust value was found
         * in the shape properties itself.
         */
        float GetScaledAdjustX_Value(uint16_t index, float defaultvalue, float aspect_ratio)const;

        /**
         * Returns a vertical adjust value relative to the geo box, where the geo box
         * fits between -1.0 and 1.0.
         * @param index The index in the list of ajust-value properties.
         * @param default_value The value returned, when no adjust value was found
         * in the shape properties itself.
         */
        float GetAdjustY_Value(uint16_t index, float default_value) const;
        float GetAdjustY_ValueMinMax(uint16_t index, float default_value, float min, float max) const;
        /**
         * Returns a vertical adjust value relative to the geo box, where the geo box
         * fits between -1.0 and 1.0. The returnvalue must fall in [min, max], otherwise
         * an exception is thrown.
         * @param index The index in the list of ajust-value properties.
         * @param default_value The value returned, when no adjust value was found
         * in the shape properties itself.
         * @param min The minimal value the return value must have.
         * @param max The maximum value the return value must have.
         */
        float GetScaledAdjustY_Value(uint16_t index, float defaultvalue, float aspect_ratio) const;

        /**
         * Returns a adjust value, interpeted as a 16:16 floatingpoint value.
         * The returnvalue must fall in [min, max], otherwise an exception is thrown.
         * @param index The index in the list of ajust-value properties.
         * @param default_value The value returned, when no adjust value was found
         * in the shape properties itself.
         * @param min The minimal value the return value must have.
         * @param max The maximum value the return value must have.
         */
        float GetAdjust16_16_Value(uint16_t index, float default_value, float min, float max) const;

        /**
         * Applies all freeform drawings to a canvas.
         * @param arrowheads_part A ArrowHeadsPart object, which will get applied
         * to the same canvas, by this function!
         * @param fill_part If not NULL it gets the bounding box of the path
         * and makes this given fill part object fot around it.
         * @param line_width The line width, used for the use of the arrowheads object.
         */
        DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars,
                ArrowHeadsPart *arrowheads_part, FillPart *fill_part, float line_width);

        /**
         * Puts all freeform drawing in a new path, once or more, after being
         * applied to a canvas by the function 'ApplyToCanvas'.
         * @return A new path. From a call to this function, the user owns it.
         */
        DrawLib::Path* CreatePathToDraw(
                ShapeDrawParameters const &pars) const;

        /**
         * @return Wether (true) the path is open and arrowheads could
         * get drawn for it OR (false) the path is closed andthe drawing of
         * any arrowheads (wehter sated in the properties or not) should
         * get omitted.
         */
        bool IsPathOpenWithArrowheads() const
        {
                return path_open_with_arrowheads;
        }

        /** @return The (internal) resize factor on the X-axis. */
        float GetXResizement() const
        {
                return (geo_right - geo_left) / 21600.0;
        }

        /** @return The (internal) resize factor on the Y-axis. */
        float GetYResizement() const
        {
                return (geo_bottom - geo_top) / 21600.0;
        }
};


/**
 * Class used by shape implementing classes, which use the
 * BLIP render properties.
 */
class BlipRenderPart
{
        std::unique_ptr<BlipRenderProperties> render_properties;

public:
        BlipRenderPart(Properties const &properties);

        BlipRenderProperties const & GetRenderProps() const
        {
                return *render_properties;
        }
};

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers


#endif

