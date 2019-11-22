#ifndef blex_webhare_hare_escher_shapes
#define blex_webhare_hare_escher_shapes

#include <drawlib/drawlibv2/drawlib_v2_types.h>
#include "util.h"
#include "internal.h"

#define MIRROR_X_TRANSFORMATION  DrawLib::XForm2D(-1, 0, 0,  1, DrawLib::FPPoint(0, 0))
#define MIRROR_Y_TRANSFORMATION  DrawLib::XForm2D( 1, 0, 0, -1, DrawLib::FPPoint(0, 0))
#define MIRROR_XY_TRANSFORMATION DrawLib::XForm2D( 0, 1, 1,  0, DrawLib::FPPoint(0, 0))

namespace Parsers {
namespace Office {
namespace Escher {

// Defined in echer.h
class ShapeContainer;
class msoBlip;

// Defined in escher.h
struct BlipRenderProperties;

/**
 * Convenience function to draw a typical Escher curve,
 * simply by giving the corner and end points. The center
 * point or the curve / arc does not need to get supplied.
 *
 * @param corner_point The outer corner point.
 * @param relative_point The end point.
 */
void PathCornerArcTo(
        DrawLib::Path *path,
        DrawLib::FPPoint corner_point,
        DrawLib::FPPoint relative_point);

/**
 * This is the superclass of all shape implementing classes.
 */
class EscherShape
{
public:
        /**
         * Constructs a new EscherShape, looking at the given shape type.
         * @param shape_container The shape record from the escher tree, containing
         * data like the typenumber of the shape to construct.
         */
        static EscherShape *ShapeFactory(ShapeContainer const &shape_container);

protected:
        /**
         * Constructs the shape, reading all properties it needs
         */
        EscherShape();

public:
        /**
         * Prepares this EscherShape for a (next) canvas.
         */
        virtual DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars)=0;
        /**
         * Draws the shape, after preparation to a canvas, by function
         * 'ApplyToCanvas'.
         * @param pars A structure containing all common parameters.
         */
        virtual void Draw(ShapeDrawParameters const &pars) const = 0;

public:
        virtual ~EscherShape() {}
};


/**
 * Baseclass for all shape implementing classes, implementing a shape which
 * is made up of multiple paths: A main path and some extra / additional
 * paths.
 */
class MultiPathShape : public EscherShape
{
        /** The endcap style mode used for all outline drawing. */
        DrawLib::OutlineEndcapModes::Type outline_endcap_mode;
        /** The join style mode used for all outline drawing. */
        DrawLib::OutlineJoinModes::Type   outline_join_mode;

        /**
         * Represents a path of which there may be many ion this shape,
         * inckluding the extra necessary information.
         */
        struct InternalPath {
                DrawLib::Path path;              /**< The path itself. */
                float         fill_color_factor; /**< The background fill color factor. 1.0 for the conventional background bitmap. */
                bool          need_to_stroke;    /**< If this path needt to get stroken. */
                bool          need_to_fill;      /**< If this path needt to get filled. */

                bool          fill_own_bitmap;   /**< If this path has its own background image, with the size of this path.
                                                   * (This is a rare case. Used by 'CloudCallout for the standalone 'dots'.)
                                                   */
                /**
                 * For when 'fill_own_bitmap' is true, this is the BB of the newly
                 * to create background image / bitmap.
                 */
                DrawLib::FPBoundingBox own_bitmap_bounding_box;
        };
        /** Contains all paths in this shape. Filled in 'SetupPaths', using 'CreatePath'. */
        std::vector<InternalPath> paths;

        /** The transformation applied to all paths, after 'SetupPaths'. */
        DrawLib::XForm2D localtransformation;

protected:
        TextPart text_part;
        FillPart fill_part;
        LinePart line_part;

public:
        /**
         * Constructor.
         * @param shade_shape_to_outline Passed unchanged to 'EscherShape'.
         * @param miter_mode The miter mode used for all outline drawing.
         */
        MultiPathShape(ShapeContainer const &shape_container,
                bool shade_shape_to_outline,
                DrawLib::OutlineEndcapModes::Type outline_endcap_mode,
                DrawLib::OutlineJoinModes::Type   outline_join_mode);

        virtual DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars);

protected:
        /**
         * In this function a subclass must setup the necessary paths.
         * - It must use 'CreatePath' to create a new/next path.
         * - It should also setup the text box here.
         * - It can transform the textbox and all paths in 'ApplyTransform'.
         */
        virtual void SetupPaths(float aspect_ratio) = 0;

        /**
         * Applies the given transformation to this entire shape,
         * including the text box! This function could very eazily get
         * used to put the entire shape upside-down for example.
         * @param trans The transformation.
         */
        void ApplyTransform(DrawLib::XForm2D const &trans);

        /**
         * Creates a new path and add it to the liat, contained in this shape.
         * @param fill_color_factor The background color gradient. 1.0 for the conventional
         * background image.
         * @param stroke If this path needt to get stroked.
         * @param fill If this path needt to get filled.
         * @param own_bitmap If this path has its own background image, with the size of this path.
         * (This is a rare case. Used by 'CloudCallout for the standalone 'dots'.)
         */
        DrawLib::Path * CreatePath(float fill_color_factor, bool stroke, bool fill, bool own_bitmap);

public:
        void Draw(ShapeDrawParameters const &pars) const;
};


/**
 * Simple common callout shape, used for the following shape types:
 * 178 till 181  (so called 90 degrees callouts)
 * 41 till 52 (other callouts)
 */
class SimpleCalloutShape : public MultiPathShape
{
        GeometryPart geometry_part;

        /** The one to four adjust points, making up the callout line. */
        DrawLib::FPPoint adjust_point1;
        DrawLib::FPPoint adjust_point2;
        DrawLib::FPPoint adjust_point3;
        DrawLib::FPPoint adjust_point4;

        /** If this callout has an 'accent'. */
        bool has_accent;
        /** If this callout has a border. */
        bool has_border;

public:
        /**
         * The number of adjust points making up the callout line.
         * 'ANGLE_90' for when this line is allways strict
         * horizontal or vertical.
         */
        enum NumberOfPoints
        {
                ANGLE_90, TWO_POINTS, THREE_POINTS, FOUR_POINTS
        } number_of_points;

        /**
         * @param number_of_points The number of adjust points making up
         * the callout line. 'ANGLE_90' for when this line is allways
         * strict horizontal or vertical.
         * @param has_border If this callout has a border.
         * @param has_accent If this callout has an 'accent'.
         */
        SimpleCalloutShape(NumberOfPoints number_of_points,
                bool has_border, bool has_accent,
                ShapeContainer const &shape_container);

        virtual void SetupPaths(float aspect_ratio);
};

/**
 * Baseclass of all shape implementing classes, which are a callout
 * with one single extention point.
 * Currently used by the shapes:
 * 61: WedgeRectCalloutShape
 * 62: WedgeRRectCalloutShape
 * 63: WedgeEllipseCalloutShape
 */
class SinglePointCalloutShape : public MultiPathShape
{
        GeometryPart geometry_part;

protected:
        DrawLib::FPPoint adjust_point;

public:
        SinglePointCalloutShape(ShapeContainer const &shape_container);

        virtual void SetupPaths(float aspect_ratio) = 0;
};


/**
 * Common abstract shape, baseclass of all shapes which are
 * a compiosition of two braces. A subclass must setup the
 * brach paths in the virtual member funtions 'SetupLeft'
 * and 'SetupRight'. The setting up of those braces should
 * be suitable to get set up in the same path: For the fill
 * path, both functions get called in sequence.
 */
class AbstractDoubleBraceShape : public MultiPathShape
{
        GeometryPart geometry_part;

        DrawLib::FPPoint adjust;

public:
        AbstractDoubleBraceShape(
                ShapeContainer const &shape_container,
                bool shade_shape_to_outline,
                float default_adjust);

        virtual void SetupPaths(float aspect_ratio);

        /**
         * In this function, a subclass can setup the text box in the
         * coordinate-space [-1,-1, 0,0].
         * @param p_adjust_x The to use adjust value on the X-axis.
         * @param p_adjust_y The to use adjust value on the Y-axis.
         */
        virtual void SetupTextBox(float p_adjust_x, float p_adjust_y) = 0;

        /**
         * In this function, a subclass must setup the left brace, clockwise
         * 'around the fill', in the coordinate-space [-1,-1, 0,0].
         * @param p_adjust_x The to use adjust value on the X-axis.
         * @param p_adjust_y The to use adjust value on the Y-axis.
         * @param addto If true, there should get started with a 'MoveTo' on the path.
         */
        virtual void SetupLeft (float p_adjust_x, float p_adjust_y, DrawLib::Path *path, bool addto) = 0;
        /**
         * In this function, a subclass must setup the right brace, clockwise
         * 'around the fill', in the coordinate-space [-1,-1, 0,0].
         * @param p_adjust_x The to use adjust value on the X-axis.
         * @param p_adjust_y The to use adjust value on the Y-axis.
         * @param addto If true, there should get started with a 'MoveTo' on the path.
         */
        virtual void SetupRight(float p_adjust_x, float p_adjust_y, DrawLib::Path *path, bool addto) = 0;
};


class AbstractLineShape : public EscherShape
{
protected:
        ArrowHeadsPart arrowheads_part;
        GeometryPart geometry_part;
        FillPart fill_part;
        LinePart line_part;
        TextPart text_part;

        /** The path, containing the fill, after 'SetupLineAndFill'. */
        DrawLib::Path fill_path;
        /** The path, containing the outline, after 'SetupLineAndFill'. */
        DrawLib::Path outline_path;

public:
        AbstractLineShape(ShapeContainer const &shape_container, bool shade_shape_to_outline);
        virtual DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars);

protected:
        /**
         * In this function a subclass should setup the 'fill_path' and 'outline_path'.
         * The given transformation should be applied to those paths OR all points
         * added to those paths.
         *
         * @param transform The transformation which only scales down! The rotation and
         * translation of the paths is done after the call to this function.
         */
        virtual DrawLib::FPBoundingBox SetupLineAndFill(DrawLib::XForm2D const& transform) = 0;

public:
        void Draw(ShapeDrawParameters const &pars) const;
};


/** For the shape types 58, 59, 60 and 92. */
class SealShape : public MultiPathShape
{
        GeometryPart geometry_part;

        float adjust_x;
        /** The number of inner / outer point in this seal. */
        int num_points;

public:
        /**
         * @param num_points The number of inner / outer point in this seal.
         */
        SealShape(
                ShapeContainer const &shape_container,
                int num_points);

        virtual void SetupPaths(float aspect_ratio);
};


/**
 * The common arrow shape. Used for the shapes of type:
 * 13 (Right arrow)
 * 66 (Left arrow)
 * 67 (Down arrow)
 * 68 (Up arrow)
 */
class ArrowShape : public MultiPathShape
{
public:
        /** Indicator for the direction the arrow will point to. */
        enum Direction { LEFT, RIGHT, UP, DOWN };

private:
        GeometryPart geometry_part;
        DrawLib::FPPoint adjust;

        /** Indicator for the direction the arrow will point to. */
        Direction direction;

public:
        /**
         * @param direction Indicator for the direction the arrow will point to.
         */
        ArrowShape(ShapeContainer const &shape_container, Direction direction);
        void SetupPaths(float aspect_ratio);
};


/**
 * This is the shape class for all connector arrorw/lines
 * (from PowewrPoint) and the common Line shape, which is the
 * same as a straight connector.
 *
 * Summary of all implemented shape types:
 * 20: LineShape;
 * 32: StraightConnector1;
 * 33: BentConnector2;
 * 34: BentConnector3;
 * 35: BentConnector4;
 * 36: BentConnector5;
 * 37: CurvedConnector2;
 * 38: CurvedConnector3;
 * 39: CurvedConnector4;
 * 40: CurvedConnector5;
 */
class ConnectorShape : public EscherShape
{
public:
        /** Indicator for the number of line-segments / arcs a connector is made up of. */
        enum LineCount { ONE, TWO, THREE, FOUR, FIVE };

private:
        DrawLib::Path path;
        GeometryPart   geometry_part;
        LinePart       line_part;
        ArrowHeadsPart arrowheads_part;
        TextPart       text_part;


        /** Indicator for the number of line-segments / arcs this connector is made up of. */
        LineCount line_count;
        /**
         * From the MS-Escher documentation:
         *  msocxstyleStraight = 0
         *  msocxstyleBent     = 1
         *  msocxstyleCurved   = 2
         *  msocxstyleNone     = 3
         */
        int connector_type;

        float adjust1, adjust2, adjust3;

public:
        /**
         * @param line_count Indicator for the number of line-segments / arcs this connector is made up of.
         */
        ConnectorShape(ShapeContainer const &shape_container, LineCount line_count);
        virtual DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars);
        void Draw(ShapeDrawParameters const &pars) const;

private:
        /** @return The average of the two given numbers. */
        float MiddleOf(float f1, float f2)
        {       return (f1 + f2) / 2;           }
};


/**
 * Class for the implementation of the BevelShape (type == 84)
 * AND the PowerPoint specific action-button shapes
 * (type >= 189 && type <= 200).
 */
class BevelOrActionbuttonShape : public MultiPathShape
{
public:
        /** Indicator for the type of action-buttion this shape is. 'NO_BUTTON' for the bevel shape. */
        enum ButtonType { NO_BUTTON,
                 BLANK, HOME, HELP, INFO, NEXT, PREVIOUS, END, BEGIN, RETURN, DOC, SOUND, MOVIE };

private:
        GeometryPart geometry_part;

        /** Indicator for the type of action-buttion this shape is. 'NO_BUTTON' for the bevel shape. */
        ButtonType button_type;

public:
        /**
         * @param button_type Indicator for the type of action-buttion this shape is.
         * 'NO_BUTTON' for the bevel shape.
         */
        BevelOrActionbuttonShape(ShapeContainer const &shape_container, ButtonType button_type);
        virtual void SetupPaths(float aspect_ratio);

        /**
         * Scales a path down to udo a given aspect ratio. So a given path wchich is a
         * square as part of a shape with the given aspect ratio, stays square.
         * @param aspect_ratio The aspect ratio (portrait when > 1).
         */
        void TransformUndoAspectRatio(DrawLib::Path *curpath, float aspect_ratio) const;
};


/*  0*/
class FreeFormShape : public EscherShape
{
        ArrowHeadsPart arrowheads_part;
        GeometryPart geometry_part;
        FillPart fill_part;
        LinePart line_part;

public:
        FreeFormShape(ShapeContainer const &shape_container);
        virtual DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars);
        void Draw(ShapeDrawParameters const &pars) const;
};


/*  1*/
class RectangleShape : public MultiPathShape
{
public:
        RectangleShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*  2*/
class RoundRectangleShape : public MultiPathShape
{
        GeometryPart geometry_part;

public:
        RoundRectangleShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*  3*/
class EllipseShape : public MultiPathShape
{
public:
        EllipseShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*  4*/
class DiamondShape : public MultiPathShape
{
public:
        DiamondShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*  5*/
class IsocelesTriangleShape : public MultiPathShape
{
public:
        IsocelesTriangleShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*  6*/
class RightTriangleShape : public MultiPathShape
{
public:
        RightTriangleShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*  7*/
class ParallelogramShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        ParallelogramShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*  8*/
class TrapezoidShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        TrapezoidShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*  9*/
class HexagonShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        HexagonShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 10*/
class OctagonShape : public MultiPathShape
{
        GeometryPart geometry_part;

public:
        OctagonShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 11*/
class PlusShape : public MultiPathShape
{
        GeometryPart geometry_part;

public:
        PlusShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 12*/
class StarShape : public MultiPathShape
{
public:
        StarShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 15*/
class HomePlateShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        HomePlateShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 16*/
class CubeShape : public MultiPathShape
{
        GeometryPart geometry_part;

public:
        CubeShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 19*/
class ArcShape : public AbstractLineShape
{
        /** The two angles.*/
        float adjust_angle1, adjust_angle2;

        /** The center of the ellipse. */
        DrawLib::FPPoint adjust_center;

        /** The size of the ellipse. */
        DrawLib::FPSize ell_size;

        // The 2 corner positions:
        DrawLib::FPPoint corner1, corner2;

public:
        ArcShape(ShapeContainer const &shape_container);
protected:
        virtual DrawLib::FPBoundingBox SetupLineAndFill(DrawLib::XForm2D const& transform);
};


/* 21*/
class PlaqueShape : public MultiPathShape
{
        GeometryPart geometry_part;

public:
        PlaqueShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 22*/
class CanShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        CanShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 23*/
class DonutShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        DonutShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 53*/
/* 54*/
class RibbonShape : public MultiPathShape
{
        GeometryPart geometry_part;
        DrawLib::FPPoint adjust;

        /** If this ribbon upside down. (Shape type == 54) */
        bool is_upside_down;

public:
        RibbonShape(ShapeContainer const &shape_container, bool is_upside_down);
        void SetupPaths(float aspect_ratio);
};


/* 55*/
class ChevronShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        ChevronShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 56*/
class PentagonShape : public MultiPathShape
{
public:
        PentagonShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 57*/
class NoSmokingShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        NoSmokingShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};



/* 61*/
class WedgeRectCalloutShape : public SinglePointCalloutShape
{
public:
        WedgeRectCalloutShape(ShapeContainer const &shape_container)
        : SinglePointCalloutShape(shape_container) {}
        virtual void SetupPaths(float aspect_ratio);
};


/* 62*/
class WedgeRRectCalloutShape : public SinglePointCalloutShape
{
public:
        WedgeRRectCalloutShape(ShapeContainer const &shape_container)
        : SinglePointCalloutShape(shape_container) {}
        virtual void SetupPaths(float aspect_ratio);
};


/* 63*/
class WedgeEllipseCalloutShape : public SinglePointCalloutShape
{
public:
        WedgeEllipseCalloutShape(ShapeContainer const &shape_container)
        : SinglePointCalloutShape(shape_container) {}
        virtual void SetupPaths(float aspect_ratio);
};


/* 64*/
class WaveShape : public MultiPathShape
{
        GeometryPart geometry_part;
        DrawLib::FPPoint adjust;

public:
        WaveShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/* 65*/
class FoldedCornerShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        FoldedCornerShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/* 66*/
class LeftArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;

public:
        LeftArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 67*/
class DownArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;

public:
        DownArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 68*/
class UpArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;

public:
        UpArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/**
 * For the shapes:
 * LeftRightArrowShape (69)
 * UpDownArrowShape    (70)
 */
class DoubleArrowShape : public MultiPathShape
{
public:
        enum Direction { LEFTRIGHT, UPDOWN };

private:
        Direction direction;
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;

public:
        DoubleArrowShape(ShapeContainer const &shape_container, Direction direction);
        void SetupPaths(float aspect_ratio);
};


/* 70*/
class UpDownArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;

public:
        UpDownArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 71*/
class IrregularSeal1Shape : public MultiPathShape
{
public:
        IrregularSeal1Shape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 72*/
class IrregularSeal2Shape : public MultiPathShape
{
public:
        IrregularSeal2Shape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 73*/
class LightningBoltShape : public MultiPathShape
{
public:
        LightningBoltShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 74*/
class HeartShape : public MultiPathShape
{
public:
        HeartShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 75*/
class PictureFrameShape : public EscherShape
{
        Properties const &shapeprops;
        BlipRenderPart blip_render_part;
        FillPart fill_part;

public:
        PictureFrameShape(ShapeContainer const &shape_container);
        DrawLib::FPBoundingBox ApplyToCanvas(TransformationState const &pars);
        void Draw(ShapeDrawParameters const &pars) const;
};


/* 76*/
class QuadArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;
        float adjust_x2;

public:
        QuadArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};

/**
 * For the shapes:
 * LeftArrowCalloutShape   (77)
 * RightArrowCalloutShape  (78)
 * UpArrowCalloutShape     (79)
 * DownArrowCalloutShape   (80)
 */
class ArrowCalloutShape : public MultiPathShape
{
public:
        enum Direction { LEFT, RIGHT, UP, DOWN };

private:
        Direction direction;
        GeometryPart geometry_part;
        float adjust1;
        float adjust2;
        float adjust3;
        float adjust4;

public:
        ArrowCalloutShape(ShapeContainer const &shape_container, Direction direction);
        void SetupPaths(float aspect_ratio);
};


/**
 * For the shapes:
 * LeftRightArrowCalloutShape (81)
 * UpDownArrowCalloutShape    (82)
 */
class DoubleArrowCalloutShape : public MultiPathShape
{
public:
        enum Direction { LEFTRIGHT, UPDOWN };

private:
        Direction direction;
        GeometryPart geometry_part;
        float adjust1;
        float adjust2;
        float adjust3;
        float adjust4;

public:
        DoubleArrowCalloutShape(ShapeContainer const &shape_container, Direction direction);
        void SetupPaths(float aspect_ratio);
};


/* 83*/
class QuadArrowCalloutShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust1;
        float adjust2;
        float adjust3;
        float adjust4;

public:
        QuadArrowCalloutShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 85 and 86*/
class BracketShape : public AbstractLineShape
{
        bool is_right_bracket;
        float adjust_y;

public:
        BracketShape(ShapeContainer const &shape_container, bool is_right_bracket);
protected:
        virtual DrawLib::FPBoundingBox SetupLineAndFill(DrawLib::XForm2D const& transform);
};


/* 87 and 88*/
class BraceShape : public AbstractLineShape
{
        bool is_right_brace;
        float adjust_y1, adjust_y2;

public:
        BraceShape(ShapeContainer const &shape_container, bool is_right_brace);
protected:
        virtual DrawLib::FPBoundingBox SetupLineAndFill(DrawLib::XForm2D const& transform);
};


/* 89*/
class LeftUpArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;
        float adjust_x2;

public:
        LeftUpArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 90*/
class BentUpArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;
        float adjust_x2;

public:
        BentUpArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 91*/
class BentArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x, adjust_y;

public:
        BentArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 93*/
class StripedRightArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x, adjust_y;

public:
        StripedRightArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 94*/
class NotchedRightArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x, adjust_y;

public:
        NotchedRightArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 95*/
class BlockArcShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float angle, adjust_x;

public:
        BlockArcShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 96*/
class SmileyFaceShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        SmileyFaceShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 97*/
class VerticalScrollShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x, adjust_y;

public:
        VerticalScrollShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 98*/
class HorizontalScrollShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x, adjust_y;

public:
        HorizontalScrollShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/* 99*/
class CircularArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float angle1, angle2, adjust_x;

public:
        CircularArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*101*/
class UturnArrowShape : public MultiPathShape
{
public:
        UturnArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*102, 103, 104 and 105*/
class CurvedArrowShape : public MultiPathShape
{
public:
        enum Direction { LEFT, RIGHT, UP, DOWN };

private:
        Direction direction;
        GeometryPart geometry_part;
        float adjust_y;
        float adjust_y2;
        float adjust_x;

public:
        CurvedArrowShape(ShapeContainer const &shape_container, Direction direction);
        void SetupPaths(float aspect_ratio);
};


/*106*/
class CloudCalloutShape : public MultiPathShape
{
        GeometryPart geometry_part;
        DrawLib::FPPoint adjust_point;

        struct EllipsAndArc
        {
                float p_x, p_y;   // Position
                float ax_x, ax_y; // Size of ellipse
                float an1, an2;   // Two angles in degrees
        } static const ellipses_and_arcs[];

public:
        CloudCalloutShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*107*/
/*108 (upside down)*/
class EllipseRibbonShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x, adjust_y1, adjust_y2;

        /** If this ellipse-ribbon shape is upside down. (type == 108) */
        bool is_upside_down;

public:
        /**
         * @param is_upside_down If this ellipse-ribbon shape is upside down. (type == 108)
         */
        EllipseRibbonShape(ShapeContainer const &shape_container, bool is_upside_down);
        void SetupPaths(float aspect_ratio);

private:
        float f(float center_y, float ax_x, float ax_y, float x) const;
};


/*110*/
class FlowChartDecisionShape : public MultiPathShape
{
public:
        FlowChartDecisionShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*111*/
class FlowChartInputOutputShape : public MultiPathShape
{
public:
        FlowChartInputOutputShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*112*/
class FlowChartPredefinedProcessShape : public MultiPathShape
{
public:
        FlowChartPredefinedProcessShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*113*/
class FlowChartInternalStorageShape : public MultiPathShape
{
public:
        FlowChartInternalStorageShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*114*/
class FlowChartDocumentShape : public MultiPathShape
{
public:
        FlowChartDocumentShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*115*/
class FlowChartMultidocumentShape : public MultiPathShape
{
public:
        FlowChartMultidocumentShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*116*/
class FlowChartTerminatorShape : public MultiPathShape
{
public:
        FlowChartTerminatorShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*117*/
class FlowChartPreparationShape : public MultiPathShape
{
public:
        FlowChartPreparationShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*118*/
class FlowChartManualInputShape : public MultiPathShape
{
public:
        FlowChartManualInputShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*119*/
class FlowChartManualOperationShape : public MultiPathShape
{
public:
        FlowChartManualOperationShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*121*/
class FlowChartPunchedCardShape : public MultiPathShape
{
public:
        FlowChartPunchedCardShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*122*/
class FlowChartPunchedTapeShape : public MultiPathShape
{
public:
        FlowChartPunchedTapeShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*123*/
class FlowChartSummingJunctionShape : public MultiPathShape
{
public:
        FlowChartSummingJunctionShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*124*/
class FlowChartOrShape : public MultiPathShape
{
public:
        FlowChartOrShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*125*/
class FlowChartCollateShape : public MultiPathShape
{
public:
        FlowChartCollateShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*126*/
class FlowChartSortShape : public MultiPathShape
{
public:
        FlowChartSortShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*127*/
class FlowChartExtractShape : public MultiPathShape
{
public:
        FlowChartExtractShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*128*/
class FlowChartMergeShape : public MultiPathShape
{
public:
        FlowChartMergeShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*130*/
class FlowChartOnlineStorageShape : public MultiPathShape
{
public:
        FlowChartOnlineStorageShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*131*/
class FlowChartMagneticTapeShape : public MultiPathShape
{
public:
        FlowChartMagneticTapeShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*132*/
class FlowChartMagneticDiskShape : public MultiPathShape
{
public:
        FlowChartMagneticDiskShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};


/*134*/
class FlowChartDisplayShape : public MultiPathShape
{
public:
        FlowChartDisplayShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*135*/
class FlowChartDelayShape : public MultiPathShape
{
public:
        FlowChartDelayShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*133*/
class FlowChartMagneticDrumShape : public MultiPathShape
{
public:
        FlowChartMagneticDrumShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*176*/
class FlowChartAlternateProcessShape : public MultiPathShape
{
public:
        FlowChartAlternateProcessShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*177*/
class FlowChartOffpageConnectorShape : public MultiPathShape
{
public:
        FlowChartOffpageConnectorShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*182*/
class LeftRightUpArrowShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust_x;
        float adjust_y;
        float adjust_x2;

public:
        LeftRightUpArrowShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
        float f(float y) const;
};


/*183*/
class SunShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        SunShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*184*/
class MoonShape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        MoonShape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*185*/
class BracketPairShape : public AbstractDoubleBraceShape
{
public:
        BracketPairShape(ShapeContainer const &shape_container);
        virtual void SetupTextBox(float p_adjust_x, float p_adjust_y);
        virtual void SetupLeft   (float p_adjust_x, float p_adjust_y, DrawLib::Path *path, bool addto);
        virtual void SetupRight  (float p_adjust_x, float p_adjust_y, DrawLib::Path *path, bool addto);
};


/*186*/
class BracePairShape : public AbstractDoubleBraceShape
{
public:
        BracePairShape(ShapeContainer const &shape_container);
        virtual void SetupTextBox(float p_adjust_x, float p_adjust_y);
        virtual void SetupLeft   (float p_adjust_x, float p_adjust_y, DrawLib::Path *path, bool addto);
        virtual void SetupRight  (float p_adjust_x, float p_adjust_y, DrawLib::Path *path, bool addto);
};


/*187*/
class Seal4Shape : public MultiPathShape
{
        GeometryPart geometry_part;
        float adjust;

public:
        Seal4Shape(ShapeContainer const &shape_container);
        void SetupPaths(float aspect_ratio);
};


/*188*/
class DoubleWaveShape : public MultiPathShape
{
        GeometryPart geometry_part;
        DrawLib::FPPoint adjust;

public:
        DoubleWaveShape(ShapeContainer const &shape_container);
        virtual void SetupPaths(float aspect_ratio);
};

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers


#endif
