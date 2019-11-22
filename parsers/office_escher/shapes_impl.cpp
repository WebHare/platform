#include <ap/libwebhare/allincludes.h>


/* This file contains the rendering code of the individual shapes: none of
   the 'major' code. In other words: none of the shapes here has an
   ApplyToCanvas. Another way of looking at it: most of these shapes only
   contain a function SetupPaths or something similair, and can, if found
   useful in the future and if it would be possible to eliminate dependencies
   on stored_transformation, be replaced with a SetupPaths(MultiShape*) function */

#include "shapes.h"
#include "escher.h"

namespace Parsers {
namespace Office {
namespace Escher {

//////////////////////////////////////////////////
////// SimpleCalloutShape

SimpleCalloutShape::SimpleCalloutShape(NumberOfPoints _number_of_points,
        bool _has_border, bool _has_accent,
        ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false,
        DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
, has_accent(_has_accent)
, has_border(_has_border)
, number_of_points(_number_of_points)
{
        switch(number_of_points)
        {
        case ANGLE_90:
                adjust_point1 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(0,-1.15),
                        geometry_part.GetAdjustY_Value(1, 1.13));
                adjust_point2 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(2,-1.15),
                        geometry_part.GetAdjustY_Value(3,-0.75));
                break;

        case TWO_POINTS:
                adjust_point1 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(0,-1.75),
                        geometry_part.GetAdjustY_Value(1, 1.25));
                adjust_point2 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(2,-1.15),
                        geometry_part.GetAdjustY_Value(3,-0.65));
                break;

        case THREE_POINTS:
                adjust_point1 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(0,-1.90),
                        geometry_part.GetAdjustY_Value(1, 1.25));
                adjust_point2 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(2,-1.35),
                        geometry_part.GetAdjustY_Value(3,-0.65));
                adjust_point3 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(4,-1.15),
                        geometry_part.GetAdjustY_Value(5,-0.65));
                break;

        case FOUR_POINTS:
                adjust_point1 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(0, 1.175),
                        geometry_part.GetAdjustY_Value(1, 1.255));
                adjust_point2 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(2, 1.36),
                        geometry_part.GetAdjustY_Value(3, 1.00));
                adjust_point3 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(4, 1.36),
                        geometry_part.GetAdjustY_Value(5,-0.65));
                adjust_point4 = DrawLib::FPPoint(
                        geometry_part.GetAdjustX_Value(6, 1.175),
                        geometry_part.GetAdjustY_Value(7,-0.65));
                break;

        }
}

void SimpleCalloutShape::SetupPaths(float)
{
        text_part.SetupTextBox(1,1, 1,1);

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/has_border, /*fill=*/true, /*own_bitmap=*/false);

        // Define the box as main path:
        curpath->MoveTo(DrawLib::FPPoint(-1,-1));
        curpath->LineTo(DrawLib::FPPoint( 1,-1));
        curpath->LineTo(DrawLib::FPPoint( 1, 1));
        curpath->LineTo(DrawLib::FPPoint(-1, 1));
        curpath->ClosePath();

        // Define the line via the extend points:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(adjust_point1);
        curpath->LineTo(adjust_point2); // Also for ANGLE_90

        if(number_of_points == THREE_POINTS || number_of_points == FOUR_POINTS)
                curpath->LineTo(adjust_point3);

        if(number_of_points == FOUR_POINTS)
                curpath->LineTo(adjust_point4);

        if(has_accent && number_of_points != ANGLE_90)
        {
                float accent_x;
                switch(number_of_points)
                {
                case FOUR_POINTS:
                        accent_x = adjust_point4.x;
                        break;
                case THREE_POINTS:
                        accent_x = adjust_point3.x;
                        break;
                default:
                        accent_x = adjust_point2.x;
                        break;
                }

                // Define the 'accent' line:
                curpath = CreatePath(1.0, true, false, false);
                curpath->MoveTo(DrawLib::FPPoint(accent_x,-1.0));
                curpath->LineTo(DrawLib::FPPoint(accent_x, 1.0));
        }

}


SinglePointCalloutShape::SinglePointCalloutShape(
        ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false,
        DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_point = DrawLib::FPPoint(
                geometry_part.GetAdjustX_Value(0,-0.85),
                geometry_part.GetAdjustY_Value(1, 1.40));
}
// End implementation SinglePointCalloutShape





// *** The ArrowShape. ***

ArrowShape::ArrowShape(ShapeContainer const &shape_container, Direction _direction)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
, direction(_direction)
{
        float f = (direction == RIGHT || direction == DOWN)?1:-1;

        adjust.x = f*geometry_part.GetAdjustX_Value(0, f*0.5);
        adjust.y = - geometry_part.GetAdjustY_ValueMinMax(1, - 0.5,    -1.0,0.0);
}

void ArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float text_in_top = 1.0 - ((1.0 - adjust.x)*adjust.y);

        text_part.SetupTextBox(text_in_top,adjust.y,    1,adjust.y);

        switch(direction)
        {
        case LEFT:
                break;
        case RIGHT:
                ApplyTransform(MIRROR_X_TRANSFORMATION);
                break;
        case UP:
                ApplyTransform(MIRROR_XY_TRANSFORMATION);
                break;
        case DOWN:
                ApplyTransform(MIRROR_X_TRANSFORMATION);
                ApplyTransform(MIRROR_XY_TRANSFORMATION);
                break;
        }

        // Define the path:
        curpath->MoveTo(DrawLib::FPPoint(-1       , 0       )); // Top point
        curpath->LineTo(DrawLib::FPPoint(-adjust.x,-1       ));
        curpath->LineTo(DrawLib::FPPoint(-adjust.x,-adjust.y));
        curpath->LineTo(DrawLib::FPPoint( 1       ,-adjust.y));
        curpath->LineTo(DrawLib::FPPoint( 1       , adjust.y));
        curpath->LineTo(DrawLib::FPPoint(-adjust.x, adjust.y));
        curpath->LineTo(DrawLib::FPPoint(-adjust.x, 1       ));
        curpath->ClosePath();
}
// End implementation ArrowShape



// *** Implementation BevelOrActionbuttonShape ***
// (For Bevel shape (st84) and PowerPoint action-button shapes (st189 - st200)

BevelOrActionbuttonShape::BevelOrActionbuttonShape(ShapeContainer const &shape_container, ButtonType _button_type)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
, button_type(_button_type)
{
}

void BevelOrActionbuttonShape::SetupPaths(float aspect_ratio)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float default_value = (button_type==NO_BUTTON) ? -0.75 : -0.875;

        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,default_value,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,default_value,aspect_ratio);

        text_part.SetupTextBox(
                adj_x,adj_y, adj_x,adj_y);

        // Inner main polygon:
        curpath->MoveTo(DrawLib::FPPoint(-1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         , 1         ));
        curpath->LineTo(DrawLib::FPPoint(-1         , 1         ));
        curpath->ClosePath();

        // Top polygon:
        curpath = CreatePath(1.15, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint(-1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x,-adj_y));
        curpath->ClosePath();

        // Right polygon:
        curpath = CreatePath(0.60, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint( 1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint( adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint( 1         , 1         ));
        curpath->ClosePath();

        // Bottom polygon:
        curpath = CreatePath(0.80, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint( adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint(-1         , 1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         , 1         ));
        curpath->ClosePath();

        // Left polygon:
        curpath = CreatePath(1.40, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint(-1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint(-adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint(-1         , 1         ));
        curpath->ClosePath();

        // Define the inner lines:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint( 1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x,-adj_y));

        curpath->MoveTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint( adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint( 1         , 1         ));

        curpath->MoveTo(DrawLib::FPPoint( adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x, adj_y));
        curpath->LineTo(DrawLib::FPPoint(-1         , 1         ));

        curpath->MoveTo(DrawLib::FPPoint(-1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint(-adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x, adj_y));

        float i = 0.62;

        switch(button_type)
        {
        case HOME: {
                // The fill of the chimney (clockwise):
                curpath = CreatePath(0.80, false, true, false);
                curpath->MoveTo(DrawLib::FPPoint( 0.23,-0.39)); // Left bottom
                curpath->LineTo(DrawLib::FPPoint( 0.23,-0.55));
                curpath->LineTo(DrawLib::FPPoint( 0.39,-0.55));
                curpath->LineTo(DrawLib::FPPoint( 0.39,-0.24));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                // The outline of the chimney (clockwise):
                curpath = CreatePath(0.80, true, false, false);
                curpath->MoveTo(DrawLib::FPPoint( 0.23,-0.39)); // Left bottom
                curpath->LineTo(DrawLib::FPPoint( 0.23,-0.55));
                curpath->LineTo(DrawLib::FPPoint( 0.39,-0.55));
                curpath->LineTo(DrawLib::FPPoint( 0.39,-0.24));
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // The fill of the house body (clockwise):
                curpath = CreatePath(0.80, false, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.47, 0.002)); // Left top
                curpath->LineTo(DrawLib::FPPoint(-0.47, 0.62));
                curpath->LineTo(DrawLib::FPPoint( 0.47, 0.62));
                curpath->LineTo(DrawLib::FPPoint( 0.47, 0.00));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                // The outline of the house body (clockwise):
                curpath = CreatePath(0.80, true, false, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.47, 0.002)); // Left top
                curpath->LineTo(DrawLib::FPPoint(-0.47, 0.62));
                curpath->LineTo(DrawLib::FPPoint( 0.47, 0.62));
                curpath->LineTo(DrawLib::FPPoint( 0.47, 0.00));
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // The fill of the door (clockwise):
                curpath = CreatePath(0.60, false, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.08, 0.62)); // Left bottom
                curpath->LineTo(DrawLib::FPPoint(-0.08, 0.31));
                curpath->LineTo(DrawLib::FPPoint( 0.08, 0.31));
                curpath->LineTo(DrawLib::FPPoint( 0.08, 0.62));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                // The outline of the door (clockwise):
                curpath = CreatePath(0.60, true, false, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.08, 0.62)); // Left bottom
                curpath->LineTo(DrawLib::FPPoint(-0.08, 0.31));
                curpath->LineTo(DrawLib::FPPoint( 0.08, 0.31));
                curpath->LineTo(DrawLib::FPPoint( 0.08, 0.62));
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // The roof (clockwise):
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.62, 0.00)); // Left
                curpath->LineTo(DrawLib::FPPoint( 0.00,-0.62));
                curpath->LineTo(DrawLib::FPPoint( 0.62, 0.00));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case HELP: {
                // The body of the '?':
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.09, 0.30)); // Left bottom
                curpath->LineTo(DrawLib::FPPoint(-0.09, 0.10));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint(-0.09,-0.13),
                                DrawLib::FPPoint( 0.08,-0.13));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.18,-0.13),
                                DrawLib::FPPoint( 0.18,-0.26));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.18,-0.43),
                                DrawLib::FPPoint( 0.00,-0.43));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint(-0.18,-0.43),
                                DrawLib::FPPoint(-0.18,-0.26));
                curpath->LineTo(DrawLib::FPPoint(-0.36,-0.26)); // Left middle
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint(-0.36,-0.60),
                                DrawLib::FPPoint( 0.00,-0.60));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.36,-0.60),
                                DrawLib::FPPoint( 0.36,-0.26));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.36, 0.00),
                                DrawLib::FPPoint( 0.16, 0.00));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.09, 0.00),
                                DrawLib::FPPoint( 0.09, 0.10));
                curpath->LineTo(DrawLib::FPPoint( 0.09, 0.30));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // The dot of the '?':
                curpath = CreatePath(0.60, true, true, false);
                curpath->Ellipse(
                        DrawLib::FPPoint( 0.00, 0.48),
                        DrawLib::FPSize( 0.14, 0.14));
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case INFO: {
                // The background ellipse:
                curpath = CreatePath(0.60, true, true, false);
                curpath->Ellipse(
                        DrawLib::FPPoint(0,0),
                        DrawLib::FPSize(i,i));
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // The body of the 'i' (clockwise):
                curpath = CreatePath(1.40, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.23,-0.21)); // Left top
                curpath->LineTo(DrawLib::FPPoint( 0.12,-0.21));
                curpath->LineTo(DrawLib::FPPoint( 0.12, 0.39));
                curpath->LineTo(DrawLib::FPPoint( 0.23, 0.39));
                curpath->LineTo(DrawLib::FPPoint( 0.23, 0.46));
                curpath->LineTo(DrawLib::FPPoint(-0.23, 0.46));
                curpath->LineTo(DrawLib::FPPoint(-0.23, 0.39));
                curpath->LineTo(DrawLib::FPPoint(-0.12, 0.39));
                curpath->LineTo(DrawLib::FPPoint(-0.12,-0.14));
                curpath->LineTo(DrawLib::FPPoint(-0.23,-0.14));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);

                curpath = CreatePath(1.40, true, true, false);
                curpath->Ellipse(DrawLib::FPPoint( 0.00,-0.40),
                                 DrawLib::FPSize( 0.15, 0.14));
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case NEXT: {
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-i   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint( i   , 0   ));
                curpath->LineTo(DrawLib::FPPoint(-i   , i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case PREVIOUS: {
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint( i   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint(-i   , 0   ));
                curpath->LineTo(DrawLib::FPPoint( i   , i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case END: {
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-i   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint( 0.27, 0   ));
                curpath->LineTo(DrawLib::FPPoint(-i   , i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);

                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint( i   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint(i-0.16,-i  ));
                curpath->LineTo(DrawLib::FPPoint(i-0.16, i  ));
                curpath->LineTo(DrawLib::FPPoint( i   , i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case BEGIN: {
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint( i   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint(-0.27, 0   ));
                curpath->LineTo(DrawLib::FPPoint( i   , i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);

                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-i   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint(-i+0.16,-i  ));
                curpath->LineTo(DrawLib::FPPoint(-i+0.16, i  ));
                curpath->LineTo(DrawLib::FPPoint(-i   , i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case RETURN: {
                // (clockwise):
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.62,-0.32)); // Left top
                curpath->LineTo(DrawLib::FPPoint(-0.62, 0.20));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint(-0.62, 0.62),
                                DrawLib::FPPoint(-0.19, 0.62));
                curpath->LineTo(DrawLib::FPPoint( 0.03, 0.62));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.47, 0.62),
                                DrawLib::FPPoint( 0.47, 0.17));
                curpath->LineTo(DrawLib::FPPoint( 0.47,-0.32));

                curpath->LineTo(DrawLib::FPPoint( 0.62,-0.32));
                curpath->LineTo(DrawLib::FPPoint( 0.31,-0.63)); // Top point at the right
                curpath->LineTo(DrawLib::FPPoint( 0.00,-0.32));
                curpath->LineTo(DrawLib::FPPoint( 0.15,-0.32));

                curpath->LineTo(DrawLib::FPPoint( 0.15, 0.17));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint( 0.15, 0.31),
                                DrawLib::FPPoint( 0.03, 0.31));
                curpath->LineTo(DrawLib::FPPoint(-0.18, 0.31));
                PathCornerArcTo(curpath,
                                DrawLib::FPPoint(-0.31, 0.31),
                                DrawLib::FPPoint(-0.31, 0.17));
                curpath->LineTo(DrawLib::FPPoint(-0.31,-0.32));

                curpath->ClosePath();

                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case DOC: {
                float i2 = 0.45;
                float d = 0.3;

                // The document:
                curpath = CreatePath(0.80, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-i2   ,-i   ));
                curpath->LineTo(DrawLib::FPPoint(-i2   , i   ));
                curpath->LineTo(DrawLib::FPPoint( i2   , i   ));
                curpath->LineTo(DrawLib::FPPoint( i2   ,-i+d ));
                curpath->LineTo(DrawLib::FPPoint( i2-d ,-i+d ));
                curpath->LineTo(DrawLib::FPPoint( i2-d ,-i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // Fill of folded corner
                curpath = CreatePath(0.60, false, true, false);
                curpath->MoveTo(DrawLib::FPPoint( i2   ,-i+d ));
                curpath->LineTo(DrawLib::FPPoint( i2-d ,-i+d ));
                curpath->LineTo(DrawLib::FPPoint( i2-d ,-i   ));
                curpath->ClosePath();
                TransformUndoAspectRatio(curpath, aspect_ratio);

                // Outline of folded corner
                curpath = CreatePath(0.60, true, false, false);
                curpath->MoveTo(DrawLib::FPPoint( i2   ,-i+d ));
                curpath->LineTo(DrawLib::FPPoint( i2-d ,-i   ));
                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case SOUND: {
                // The loud-speaker (clockwise):
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint( 0.15,-0.62)); // Top
                curpath->LineTo(DrawLib::FPPoint( 0.15, 0.62));
                curpath->LineTo(DrawLib::FPPoint(-0.22, 0.23));
                curpath->LineTo(DrawLib::FPPoint(-0.60, 0.23));
                curpath->LineTo(DrawLib::FPPoint(-0.60,-0.23));
                curpath->LineTo(DrawLib::FPPoint(-0.22,-0.23));
                curpath->ClosePath();

                // The three lines:
                curpath->MoveTo(DrawLib::FPPoint( 0.30,-0.23));
                curpath->LineTo(DrawLib::FPPoint( 0.60,-0.47));

                curpath->MoveTo(DrawLib::FPPoint( 0.30, 0.00));
                curpath->LineTo(DrawLib::FPPoint( 0.60, 0.00));

                curpath->MoveTo(DrawLib::FPPoint( 0.30, 0.23));
                curpath->LineTo(DrawLib::FPPoint( 0.60, 0.47));

                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;
        case MOVIE: {
                // Clockwise:
                curpath = CreatePath(0.60, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(-0.62,-0.32)); // Left top
                curpath->LineTo(DrawLib::FPPoint(-0.54,-0.32));
                curpath->LineTo(DrawLib::FPPoint(-0.52,-0.29));

                curpath->LineTo(DrawLib::FPPoint( 0.31,-0.29));
                curpath->LineTo(DrawLib::FPPoint( 0.36,-0.24));
                curpath->LineTo(DrawLib::FPPoint( 0.36,-0.19));
                curpath->LineTo(DrawLib::FPPoint( 0.51,-0.19));
                curpath->LineTo(DrawLib::FPPoint( 0.56,-0.24));
                curpath->LineTo(DrawLib::FPPoint( 0.62,-0.24));

                curpath->LineTo(DrawLib::FPPoint( 0.62, 0.21));
                curpath->LineTo(DrawLib::FPPoint( 0.56, 0.21));
                curpath->LineTo(DrawLib::FPPoint( 0.51, 0.14));
                curpath->LineTo(DrawLib::FPPoint( 0.36, 0.14));
                curpath->LineTo(DrawLib::FPPoint( 0.36, 0.27));

                curpath->LineTo(DrawLib::FPPoint(-0.51, 0.27));

                curpath->LineTo(DrawLib::FPPoint(-0.51,-0.10));
                curpath->LineTo(DrawLib::FPPoint(-0.52,-0.10));
                curpath->LineTo(DrawLib::FPPoint(-0.55,-0.07));
                curpath->LineTo(DrawLib::FPPoint(-0.62,-0.07));
                curpath->ClosePath();

                TransformUndoAspectRatio(curpath, aspect_ratio);
                } break;

        case NO_BUTTON:
        case BLANK:
                break;
        }
}

void BevelOrActionbuttonShape::TransformUndoAspectRatio(
        DrawLib::Path* curpath, float aspect_ratio) const
{
        if(aspect_ratio > 1)
                curpath->ApplyTransform(DrawLib::XForm2D(0.0,
                        DrawLib::FPPoint(1/aspect_ratio,1),
                        DrawLib::FPPoint(0,0)));
        else
                curpath->ApplyTransform(DrawLib::XForm2D(0.0,
                        DrawLib::FPPoint(1, aspect_ratio),
                        DrawLib::FPPoint(0,0)));
}
// *** End implementation BevelOrActionbuttonShape ***


// *** Rectangle shape (st1). ***

RectangleShape::RectangleShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void RectangleShape::SetupPaths(float)
{
        text_part.SetupTextBox(1,1, 1,1);

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        curpath->MoveTo(DrawLib::FPPoint(-1, -1));
        curpath->LineTo(DrawLib::FPPoint( 1, -1));
        curpath->LineTo(DrawLib::FPPoint( 1,  1));
        curpath->LineTo(DrawLib::FPPoint(-1,  1));
        curpath->ClosePath();
}


// *** RoundRectangle shape (st2). ***

RoundRectangleShape::RoundRectangleShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
}

void RoundRectangleShape::SetupPaths(float aspect_ratio)
{
        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.6,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.6,aspect_ratio);

        float text_size_x;
        float text_size_y;

        if(aspect_ratio > 1.0) // Portrait:
        {
                text_size_x = 0.7 + 0.3*adj_x;
                text_size_y = 1.0 - (1.0 - text_size_x) * aspect_ratio;
        }
        else // Landscape:
        {
                text_size_y = 0.7 + 0.3*adj_y;
                text_size_x = 1.0 - (1.0 - text_size_y) / aspect_ratio;
        }

        text_part.SetupTextBox(
                 text_size_x,text_size_y,  text_size_x,text_size_y);

        // Define the path clockwise:

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        DrawLib::FPSize corner_radius(1 - adj_x,  1 - adj_y);

        curpath->MoveTo(DrawLib::FPPoint(-1 ,-adj_y)); // Upper left left

        curpath->ArcTo(DrawLib::FPPoint(-adj_x, -adj_y), corner_radius, DrawLib::FPPoint(-adj_x, -1));

        curpath->LineTo(DrawLib::FPPoint(adj_x, -1));

        curpath->ArcTo(DrawLib::FPPoint(adj_x, -adj_y), corner_radius, DrawLib::FPPoint(1, -adj_y));

        curpath->LineTo(DrawLib::FPPoint(1, adj_y));

        curpath->ArcTo(DrawLib::FPPoint(adj_x, adj_y), corner_radius, DrawLib::FPPoint(adj_x, 1));

        curpath->LineTo(DrawLib::FPPoint(-adj_x, 1));

        curpath->ArcTo(DrawLib::FPPoint(-adj_x, adj_y), corner_radius, DrawLib::FPPoint(-1,  adj_y));

        curpath->ClosePath();
}


// *** Ellipse shape (st3). ***

EllipseShape::EllipseShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
{
}

void EllipseShape::SetupPaths(float)
{
        text_part.SetupTextBox(
                0.7,0.7,  0.7,0.7);

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->Ellipse(DrawLib::FPPoint(0,0),  DrawLib::FPSize(1,1));
}


// *** Diamond shape (st4). ***

DiamondShape::DiamondShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter) {}

void DiamondShape::SetupPaths(float)
{
        text_part.SetupTextBox(
                0.5,0.5,  0.5,0.5);

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint( 0, -1));
        curpath->LineTo(DrawLib::FPPoint( 1,  0));
        curpath->LineTo(DrawLib::FPPoint( 0,  1));
        curpath->LineTo(DrawLib::FPPoint(-1,  0));
        curpath->ClosePath();
}


// *** IsocelesTriangle shape (st5). ***

IsocelesTriangleShape::IsocelesTriangleShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter) {}

void IsocelesTriangleShape::SetupPaths(float)
{
        text_part.SetupTextBox(
                0.5,0,  0.5,0.75);

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint( 0, -1));
        curpath->LineTo(DrawLib::FPPoint( 1,  1));
        curpath->LineTo(DrawLib::FPPoint(-1,  1));
        curpath->ClosePath();
}


// *** RightTriangle shape (st6). ***

RightTriangleShape::RightTriangleShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter) {}

void RightTriangleShape::SetupPaths(float)
{
        text_part.SetupTextBox(
                 0.85,-0.15,  0.15,0.85);

        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint(-1, -1));
        curpath->LineTo(DrawLib::FPPoint( 1,  1));
        curpath->LineTo(DrawLib::FPPoint(-1,  1));
        curpath->ClosePath();
}


// *** Parallelogram shape (st7). ***

ParallelogramShape::ParallelogramShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_Value(0, -0.5);
}

void ParallelogramShape::SetupPaths(float)
{
        float text_size;
        if(adjust < 0.0)
                text_size = 0.20 + 0.6*-adjust;
        else
                text_size = 0.20 - 0.2*adjust;

        text_part.SetupTextBox(
                 text_size,text_size,  text_size,text_size);

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint( adjust, -1)); // Left  top
        curpath->LineTo(DrawLib::FPPoint( 1, -1));      // Right top
        curpath->LineTo(DrawLib::FPPoint(-adjust, 1));  // Right bottom
        curpath->LineTo(DrawLib::FPPoint(-1,  1));      // Left  bottom
        curpath->ClosePath();
}


// *** Trapezoid shape (st8). ***

TrapezoidShape::TrapezoidShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, -0.5,    -1.0,0.0);
}

void TrapezoidShape::SetupPaths(float)
{
        float text_size = 0.2 + 0.8*-adjust;

        text_part.SetupTextBox(
                 text_size,text_size,  text_size,text_size);

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint(-1     ,-1)); // Left  top
        curpath->LineTo(DrawLib::FPPoint( 1     ,-1)); // Right top
        curpath->LineTo(DrawLib::FPPoint(-adjust, 1)); // Right bottom
        curpath->LineTo(DrawLib::FPPoint( adjust, 1)); // Left  bottom
        curpath->ClosePath();
}


// *** Hexagon shape (st9). ***

HexagonShape::HexagonShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, -0.5,    -1.0,0.0);
}

void HexagonShape::SetupPaths(float)
{
        float text_size = 0.4 + 0.4*-adjust;

        text_part.SetupTextBox(
                 text_size,text_size,  text_size,text_size);

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint( adjust, -1)); // Left  top
        curpath->LineTo(DrawLib::FPPoint(-adjust, -1)); // Right top
        curpath->LineTo(DrawLib::FPPoint(      1,  0)); // Right
        curpath->LineTo(DrawLib::FPPoint(-adjust,  1)); // Right bottom
        curpath->LineTo(DrawLib::FPPoint( adjust,  1)); // Left  bottom
        curpath->LineTo(DrawLib::FPPoint(     -1,  0)); // Left
        curpath->ClosePath();
}


// *** Octagon shape (st10). ***

OctagonShape::OctagonShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
}

void OctagonShape::SetupPaths(float aspect_ratio)
{
        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.4,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.4,aspect_ratio);

        float text_size_x;
        float text_size_y;

        if(aspect_ratio > 1.0) // Landscape:
        {
              text_size_y = 0.45 + 0.55*adj_y;
              text_size_x = 1.0 - (1.0 - text_size_y) / aspect_ratio;
        }
        else
        {
              text_size_x = 0.45 + 0.55*adj_x;
              text_size_y = 1.0 - (1.0 - text_size_x) * aspect_ratio;
        }

        text_part.SetupTextBox(
                 text_size_x,text_size_y,  text_size_x,text_size_y);

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint(-adj_x,          -1)); // Upper  left  top
        curpath->LineTo(DrawLib::FPPoint( adj_x,          -1)); // Upper  right top
        curpath->LineTo(DrawLib::FPPoint(          1, -adj_y)); // Right  right top
        curpath->LineTo(DrawLib::FPPoint(          1,  adj_y)); // Right  right bottom
        curpath->LineTo(DrawLib::FPPoint( adj_x,           1)); // Bottom right bottom
        curpath->LineTo(DrawLib::FPPoint(-adj_x,           1)); // Bottom left  bottom
        curpath->LineTo(DrawLib::FPPoint(         -1,  adj_y)); // Left   right top
        curpath->LineTo(DrawLib::FPPoint(         -1, -adj_y)); // Left   right bottom
        curpath->ClosePath();
}


// *** Plus shape (st11). ***

PlusShape::PlusShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
}

void PlusShape::SetupPaths(float aspect_ratio)
{
        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.5,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.5,aspect_ratio);

        // First calculate the textbox:
        if(aspect_ratio > 1.0) // Landscape:
        {
                float text_right = adj_x;

                //ADDME: This functionally acts like this,
                // but this is just an approximation.
                if(adj_y < 0.5)
                        text_right = -adj_x + 2*adj_y*aspect_ratio;

                text_part.SetupTextBox(
                        adj_x,adj_y,
                        text_right,adj_y);
        }
        else // Portrait:
        {
                float text_bottom = adj_y;

                //ADDME: This functionally acts like this,
                // but this is kjust an approximation.
                if(adj_x < 0.5)
                        text_bottom = -adj_y + 2*adj_x*aspect_ratio;

                text_part.SetupTextBox(
                        adj_x,adj_y,
                        adj_x,text_bottom);
        }

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint(         -1, -adj_y)); // Upper left

        curpath->LineTo(DrawLib::FPPoint(-adj_x, -adj_y));
        curpath->LineTo(DrawLib::FPPoint(-adj_x,          -1));

        curpath->LineTo(DrawLib::FPPoint( adj_x,          -1)); // Upper right
        curpath->LineTo(DrawLib::FPPoint( adj_x, -adj_y));
        curpath->LineTo(DrawLib::FPPoint(          1, -adj_y));

        curpath->LineTo(DrawLib::FPPoint(          1,  adj_y)); // Lower right
        curpath->LineTo(DrawLib::FPPoint( adj_x,  adj_y));
        curpath->LineTo(DrawLib::FPPoint( adj_x,           1));

        curpath->LineTo(DrawLib::FPPoint(-adj_x,           1)); // Lower left
        curpath->LineTo(DrawLib::FPPoint(-adj_x,  adj_y));
        curpath->LineTo(DrawLib::FPPoint(         -1,  adj_y));

        curpath->ClosePath();
}


// *** Star shape (st12). ***

StarShape::StarShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void StarShape::SetupPaths(float)
{
        text_part.SetupTextBox(
                 0.35,0.25,  0.35,0.45);

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint( 0   ,-1   )); // Top
        curpath->LineTo(DrawLib::FPPoint( 0.23,-0.24)); // .. and inner

        curpath->LineTo(DrawLib::FPPoint( 1   ,-0.24)); // Right
        curpath->LineTo(DrawLib::FPPoint( 0.38, 0.24)); // .. and inner

        curpath->LineTo(DrawLib::FPPoint( 0.61, 1   )); // Right bottom
        curpath->LineTo(DrawLib::FPPoint( 0   , 0.53)); // .. and inner

        curpath->LineTo(DrawLib::FPPoint(-0.61, 1   )); // Left bottom
        curpath->LineTo(DrawLib::FPPoint(-0.38, 0.24)); // .. and inner

        curpath->LineTo(DrawLib::FPPoint(-1   ,-0.24)); // Left
        curpath->LineTo(DrawLib::FPPoint(-0.23,-0.24)); // .. and inner

        curpath->ClosePath();
}


// *** HomePlate shape (st15). ***

HomePlateShape::HomePlateShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_Value(0, 0.5);
}

void HomePlateShape::SetupPaths(float)
{
        text_part.SetupTextBox(
                 1,1, 1.0 - (1.0 - adjust)/2.0, 1);

        // Define the path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint(-1     , -1)); // Left  top
        curpath->LineTo(DrawLib::FPPoint( adjust, -1));
        curpath->LineTo(DrawLib::FPPoint( 1     ,  0));
        curpath->LineTo(DrawLib::FPPoint( adjust,  1));
        curpath->LineTo(DrawLib::FPPoint(-1     ,  1));
        curpath->ClosePath();
}


// *** Cube shape (st16). ***

CubeShape::CubeShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
}

void CubeShape::SetupPaths(float aspect_ratio)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.5,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.5,aspect_ratio);

        text_part.SetupTextBox(
                 1,adj_y,  adj_x,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1         ,-adj_y)); // Upper left
        curpath->LineTo(DrawLib::FPPoint(-adj_x,-1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         , adj_y));
        curpath->LineTo(DrawLib::FPPoint( adj_x, 1         ));
        curpath->LineTo(DrawLib::FPPoint(-1         , 1         ));
        curpath->ClosePath();

        // Define the top fill-path clockwise:
        curpath = CreatePath(1.2, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint(-1         ,-adj_y)); // Upper left left
        curpath->LineTo(DrawLib::FPPoint(-adj_x,-1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         ,-1         ));
        curpath->LineTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->ClosePath();

        // Define the top fill-path clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint( 1         ,-1         )); // Upper right
        curpath->LineTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint( adj_x, 1         ));
        curpath->LineTo(DrawLib::FPPoint( 1         , adj_y));
        curpath->ClosePath();

        // Define the internal lines:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-1         ,-adj_y)); // Upper left left
        curpath->LineTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint( 1         , -1        ));

        curpath->MoveTo(DrawLib::FPPoint( adj_x,-adj_y));
        curpath->LineTo(DrawLib::FPPoint( adj_x, 1         ));
}


// *** Arc shape (st19). ***

ArcShape::ArcShape(ShapeContainer const &shape_container)
: AbstractLineShape (shape_container, true)
{
        adjust_angle1 = geometry_part.GetAdjust16_16_Value(0,-90.0,   -180.1,180.1);
        adjust_angle2 = geometry_part.GetAdjust16_16_Value(1,  0.0,   -180.1,180.1);

        adjust_center.x     = geometry_part.GetAdjustX_Value(2, -1.0);
        adjust_center.y     = geometry_part.GetAdjustY_Value(3,  -1 + 2/geometry_part.GetYResizement());

        // Convert degrees to radials:
        adjust_angle1 = (adjust_angle1/180)*M_PI;
        adjust_angle2 = (adjust_angle2/180)*M_PI;

        // Calculate the size of the ellipse:
        ell_size.width  = 2/geometry_part.GetXResizement();
        ell_size.height = 2/geometry_part.GetYResizement();

        // Calculate the 2 corner positions:
        corner1.x = adjust_center.x + (cos(adjust_angle1) * ell_size.width);
        corner1.y = adjust_center.y + (sin(adjust_angle1) * ell_size.height);
        corner2.x = adjust_center.x + (cos(adjust_angle2) * ell_size.width);
        corner2.y = adjust_center.y + (sin(adjust_angle2) * ell_size.height);
}

DrawLib::FPBoundingBox ArcShape::SetupLineAndFill(DrawLib::XForm2D const& transform)
{
        DrawLib::FPBoundingBox outerbox;
        outerbox = arrowheads_part.ApplyToCanvas(transform,
                                corner1.x,corner1.y,adjust_angle1+M_PI,
                                corner2.x,corner2.y,adjust_angle2,
                                line_part.GetLineWidth());

        text_part.SetupTextBox(
                 1,1,  1,1);

        DrawLib::FPPoint scaled_center  = DrawLib::FPPoint(adjust_center.x,adjust_center.y) * transform;
        DrawLib::FPPoint scaled_corner1 = DrawLib::FPPoint(corner1      .x,corner1      .y) * transform;
        DrawLib::FPPoint scaled_corner2 = DrawLib::FPPoint(corner2      .x,corner2      .y) * transform;

        // Setup the outline path:
        float cul = arrowheads_part.GetCutOffLength();
        float dx = scaled_corner2.x - scaled_corner1.x;
        float dy = scaled_corner2.y - scaled_corner1.y;

        float da = adjust_angle1 - adjust_angle2;
        if(da < -M_PI) da += 2*M_PI;
        if(da > 0 || cul*cul < dx*dx + dy*dy)
        {
                outline_path.MoveTo(arrowheads_part.GetConnectionPoint(ArrowHeadsPart::END));
                outline_path.ArcToR(scaled_center,
                                 ell_size * transform,
                                 arrowheads_part.GetConnectionPoint(ArrowHeadsPart::START));
        }

        // Setup the fill path:
        fill_path.MoveTo(scaled_corner2);
        fill_path.ArcToR(scaled_center,
                         ell_size * transform,
                         scaled_corner1);
        fill_path.LineTo(scaled_center);
        fill_path.ClosePath();

        return outerbox;
}

// *** Plaque shape (st21). ***

PlaqueShape::PlaqueShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
}

void PlaqueShape::SetupPaths(float aspect_ratio)
{
        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.65,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.65,aspect_ratio);

        float text_size_x;
        float text_size_y;

        if(aspect_ratio > 1.0) // Portrait:
        {
                text_size_x = 0.45 + 0.55*adj_y;
                text_size_y = 0.3  + 0.7 *adj_y;
        }
        else // Landscape:
        {
                text_size_x = 0.3  + 0.7 *adj_x;
                text_size_y = 0.45 + 0.55*adj_x;
        }

        text_part.SetupTextBox(
                 text_size_x,text_size_y,  text_size_x,text_size_y);

        // Define the main path clockwise:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(
                DrawLib::FPPoint(-1         ,-adj_y)); // Left top left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x,-adj_y),
                DrawLib::FPPoint(-adj_x,-1         ));
        curpath->LineTo(
                DrawLib::FPPoint( adj_x,-1         ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_x,-adj_y),
                DrawLib::FPPoint( 1         ,-adj_y));
        curpath->LineTo(
                DrawLib::FPPoint( 1         , adj_y));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_x, adj_y),
                DrawLib::FPPoint( adj_x, 1         ));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_x, 1         ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x, adj_y),
                DrawLib::FPPoint(-1         , adj_y));
        curpath->ClosePath();
}


// *** Can shape (st22). ***

CanShape::CanShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustY_ValueMinMax(0, -0.5,    -1.0,0.0);
}

void CanShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adjust2 = -(1.0 - ((1.0+adjust)/2.0));

        text_part.SetupTextBox(
                 1,-adjust, 1,-adjust2);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, adjust2)); // Left top left

        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-1),
                DrawLib::FPPoint( 0,-1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1),
                DrawLib::FPPoint( 1, adjust2));

        curpath->LineTo(
                DrawLib::FPPoint( 1,-adjust2));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,1),
                DrawLib::FPPoint( 0,1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,1),
                DrawLib::FPPoint(-1,-adjust2));

        curpath->ClosePath();


        // Define the upper path:
        curpath = CreatePath(1.2, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint(-1, adjust2)); // Left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1, adjust ),
                DrawLib::FPPoint( 0, adjust ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, adjust ),
                DrawLib::FPPoint( 1, adjust2));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1      ),
                DrawLib::FPPoint( 0,-1      ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-1      ),
                DrawLib::FPPoint(-1, adjust2));

        curpath->ClosePath();

        // Define the inner line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-1, adjust2)); // Left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1, adjust),
                DrawLib::FPPoint( 0, adjust));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, adjust ),
                DrawLib::FPPoint( 1, adjust2));
}


// *** Donut shape (st23). ***

DonutShape::DonutShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, -0.5,    -1.0,0.0);
}

void DonutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.7,0.7,  0.7,0.7);

        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(1,1));
        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(-adjust,-adjust));
}


// *** Ribbon  shape (st53). ***
// *** Ribbon2 shape (st54) (upside-down). ***

RibbonShape::RibbonShape(ShapeContainer const &shape_container, bool _is_upside_down)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
, is_upside_down(_is_upside_down)
{
        adjust.x = geometry_part.GetAdjustX_ValueMinMax(0,-0.50,   -1.0, 0.0);

        if(is_upside_down)
                adjust.y = -geometry_part.GetAdjustY_ValueMinMax(1,  0.75,     0.0, 1.0);
        else
                adjust.y =  geometry_part.GetAdjustY_ValueMinMax(1, -0.75,    -1.0, 0.0);
}

void RibbonShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(-adjust.x,-adjust.y,    -adjust.x,1);

        if(is_upside_down)
                ApplyTransform(MIRROR_Y_TRANSFORMATION);

        float adjust_x2 = adjust.x + 0.25;
        float d_y       = (1 - -adjust.y)/4;
        float adjust_y2 = -(1 - 2*d_y);
        float adjust_yc = -1 + (2 - (1 - -adjust.y))/2;

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1             ,-1             )); // Left top
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x2-0.07,-1             ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust_x2     ,-1             ),
                DrawLib::FPPoint( adjust_x2     ,-1        +d_y ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x2     , adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x2     , adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x2     ,-1        +d_y ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust_x2     ,-1),
                DrawLib::FPPoint(-adjust_x2+0.07,-1             ));
        curpath->LineTo(
                DrawLib::FPPoint( 1             ,-1             ));
        curpath->LineTo(
                DrawLib::FPPoint( 0.75          , adjust_yc     ));
        curpath->LineTo(
                DrawLib::FPPoint( 1             ,-adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust.x      ,-adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust.x      , 1        -d_y ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust.x      , 1),
                DrawLib::FPPoint(-adjust.x -0.07, 1             ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust.x +0.07, 1             ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust.x      , 1             ),
                DrawLib::FPPoint( adjust.x      , 1        -d_y ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust.x      ,-adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-1             ,-adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-0.75          , adjust_yc     ));
        curpath->ClosePath();

        // Define the two lines through the center:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint( adjust.x      ,-adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust.x      , adjust.y -d_y ));
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adjust.x      ,-adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust.x      , adjust.y -d_y ));


        // Define the left extra fill clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint( adjust_x2     , adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust.x +0.07, adjust.y      ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust.x      , adjust.y),
                DrawLib::FPPoint( adjust.x      , adjust.y -d_y ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust.x      , adjust_y2),
                DrawLib::FPPoint( adjust.x +0.07, adjust_y2     ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x2-0.07, adjust_y2     ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust_x2     , adjust_y2),
                DrawLib::FPPoint( adjust_x2     , adjust_y2-d_y ));
        curpath->ClosePath();

        // ... and its left extra outline clockwise:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint( adjust_x2     , adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust.x +0.07, adjust.y      ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust.x      , adjust.y),
                DrawLib::FPPoint( adjust.x      , adjust.y -d_y ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust.x      , adjust_y2),
                DrawLib::FPPoint( adjust.x +0.07, adjust_y2     ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x2-0.07, adjust_y2     ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust_x2     , adjust_y2),
                DrawLib::FPPoint( adjust_x2     , adjust_y2-d_y ));


        // Define the right extra fill anti-clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adjust_x2     , adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust.x -0.07, adjust.y      ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust.x      , adjust.y),
                DrawLib::FPPoint(-adjust.x      , adjust.y -d_y ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust.x      , adjust_y2),
                DrawLib::FPPoint(-adjust.x -0.07, adjust_y2     ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x2+0.07, adjust_y2     ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust_x2     , adjust_y2     ),
                DrawLib::FPPoint(-adjust_x2     , adjust_y2-d_y ));
        curpath->ClosePath();

        // ... and its right extra outline anti-clockwise:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adjust_x2     , adjust.y      ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust.x -0.07, adjust.y      ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust.x      , adjust.y),
                DrawLib::FPPoint(-adjust.x      , adjust.y -d_y ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust.x      , adjust_y2),
                DrawLib::FPPoint(-adjust.x -0.07, adjust_y2     ));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x2+0.07, adjust_y2     ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adjust_x2     , adjust_y2),
                DrawLib::FPPoint(-adjust_x2     , adjust_y2-d_y ));
}


// *** Chevron shape (st55). ***

ChevronShape::ChevronShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_Value(0, 0.5);
}

void ChevronShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float text_right = (adjust+1.0)/2.0;

        text_part.SetupTextBox(
                 1,1, text_right,1);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1     , -1)); // Left top
        curpath->LineTo(DrawLib::FPPoint( adjust, -1));
        curpath->LineTo(DrawLib::FPPoint( 1     ,  0)); // Right point
        curpath->LineTo(DrawLib::FPPoint( adjust,  1));
        curpath->LineTo(DrawLib::FPPoint(-1     ,  1)); // Left bottom

        curpath->LineTo(DrawLib::FPPoint(-adjust,  0)); // Inner top
        curpath->ClosePath();
}


// *** Pentagon shape (st56). ***

PentagonShape::PentagonShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void PentagonShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.6,0.5,  0.6,1);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0, -1)); // Top
        curpath->LineTo(DrawLib::FPPoint( 1, -0.236073)); // Right
        curpath->LineTo(DrawLib::FPPoint( 0.56658, 1)); // Right bottom
        curpath->LineTo(DrawLib::FPPoint(-0.56658, 1)); // Left bottom
        curpath->LineTo(DrawLib::FPPoint(-1, -0.236073)); // Left
        curpath->ClosePath();
}


// *** NoSmoking shape (st57). ***

NoSmokingShape::NoSmokingShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = -geometry_part.GetAdjustX_ValueMinMax(0, -0.75,     -1.0,-0.32);
}

void NoSmokingShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.7,0.7,  0.7,0.7);

        // Define the main ellipse:
        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(1,1));

        if(adjust <= 0.333334)
        {
                curpath = CreatePath(1.0, true, false, false);
                curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(adjust, adjust));
                return;
        }

        // Rotation of 45 degrees:
        DrawLib::XForm2D xform(-M_PI_4, DrawLib::FPPoint(1,1), DrawLib::FPPoint(0,0));

        DrawLib::FPPoint x = DrawLib::FPPoint(0.5*(1.0-adjust), adjust * cos(asin(0.5*(1.0-adjust)/adjust)));
        DrawLib::FPPoint inner_corner1 = x * xform;
        x.y = -x.y;
        DrawLib::FPPoint inner_corner2 = x * xform;

        x.x = -x.x;
        DrawLib::FPPoint inner_corner3 = x * xform;
        x.y = -x.y;
        DrawLib::FPPoint inner_corner4 = x * xform;

        // Define the second inner half circle, to cut out of the main ellipse:
        curpath->MoveTo(DrawLib::FPPoint( inner_corner3.x, inner_corner3.y));
        curpath->ArcToR(DrawLib::FPPoint(0,0),
                        DrawLib::FPSize(adjust, adjust),
                        inner_corner4);
        curpath->ClosePath();

        // Define the first inner half circle, to cut out of the main ellipse:
        curpath->MoveTo(DrawLib::FPPoint( inner_corner1.x, inner_corner1.y));
        curpath->ArcToR(DrawLib::FPPoint(0,0),
                        DrawLib::FPSize(adjust, adjust),
                        inner_corner2);
        curpath->ClosePath();

}


// *** WedgeRectCallout shape (st61). ***

void WedgeRectCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                1,1, 1,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1,-1)); // Left top

        // Adjust point 'above' the shape?
        if(adjust_point.y < -1.0 && std::fabs(adjust_point.x) < std::fabs(adjust_point.y))
        {
                // (Left above or right above)?
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x < 0.0 ? -2/3.0 : 0.20, -1));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x < 0.0 ? -0.20 : 2/3.0, -1));
        }

        curpath->LineTo(DrawLib::FPPoint( 1,-1)); // Right top

        // Adjust point 'right of' the shape?
        if(adjust_point.x >  1.0 && std::fabs(adjust_point.x) > std::fabs(adjust_point.y))
        {
                // (Above left or below left)?
                curpath->LineTo(DrawLib::FPPoint( 1, adjust_point.y < 0.0 ? -2/3.0 : 0.20));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                curpath->LineTo(DrawLib::FPPoint( 1, adjust_point.y < 0.0 ? -0.20 : 2/3.0));
        }

        curpath->LineTo(DrawLib::FPPoint( 1,1)); // Right bottom

        // Adjust point 'below' the shape?
        if(adjust_point.y >  1.0 && std::fabs(adjust_point.x) < std::fabs(adjust_point.y))
        {
                // (Left below or righ below)?
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x < 0.0 ? -0.20 : 2/3.0,  1));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x < 0.0 ? -2/3.0 : 0.20,  1));
        }

        curpath->LineTo(DrawLib::FPPoint(-1, 1)); // Left bottom

        // Adjust point 'left of' the shape?
        if(adjust_point.x < -1.0 && std::fabs(adjust_point.x) > std::fabs(adjust_point.y))
        {
                // (Above right or below right)?
                curpath->LineTo(DrawLib::FPPoint(-1, adjust_point.y < 0.0 ? -0.20 : 2/3.0));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                curpath->LineTo(DrawLib::FPPoint(-1, adjust_point.y < 0.0 ? -2/3.0 : 0.20));
        }

        curpath->ClosePath();
}


// *** WedgeRRectCallout shape (st62). ***

void WedgeRRectCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                0.92, 0.92,    0.92, 0.92);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1,-2/3.0)); // Left top
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-1),
                DrawLib::FPPoint(-2/3.0,-1));

        // Adjust point 'above' the shape?
        if(adjust_point.y < -1.0 && std::fabs(adjust_point.x) < std::fabs(adjust_point.y))
        {
                // Right above?
                if(adjust_point.x >= 0.0) curpath->LineTo(DrawLib::FPPoint( 0.1666, -1));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                if(adjust_point.x <  0.0) curpath->LineTo(DrawLib::FPPoint(-0.1666, -1));
        }

        curpath->LineTo(DrawLib::FPPoint( 2/3.0,-1)); // Right top
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1),
                DrawLib::FPPoint( 1,-2/3.0));

        // Adjust point 'right of' the shape?
        if(adjust_point.x >  1.0 && std::fabs(adjust_point.x) > std::fabs(adjust_point.y))
        {
                // Below right?
                if(adjust_point.y >= 0.0) curpath->LineTo(DrawLib::FPPoint( 1, 0.1666));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                if(adjust_point.y <  0.0) curpath->LineTo(DrawLib::FPPoint( 1,-0.1666));
        }

        curpath->LineTo(DrawLib::FPPoint( 1, 2/3.0)); // Right bottom
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, 1),
                DrawLib::FPPoint( 2/3.0, 1));

        // Adjust point 'below' the shape?
        if(adjust_point.y >  1.0 && std::fabs(adjust_point.x) < std::fabs(adjust_point.y))
        {
                // Right below?
                if(adjust_point.x <  0.0) curpath->LineTo(DrawLib::FPPoint(-0.1666,  1));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                if(adjust_point.x >= 0.0) curpath->LineTo(DrawLib::FPPoint( 0.1666,  1));
        }

        curpath->LineTo(DrawLib::FPPoint(-2/3.0, 1)); // Left bottom
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1, 1),
                DrawLib::FPPoint(-1,2/3.0));

        // Adjust point 'left of' the shape?
        if(adjust_point.x < -1.0 && std::fabs(adjust_point.x) > std::fabs(adjust_point.y))
        {
                // Left below?
                if(adjust_point.y <  0.0) curpath->LineTo(DrawLib::FPPoint(-1,-0.1666));
                curpath->LineTo(DrawLib::FPPoint(adjust_point.x, adjust_point.y));
                if(adjust_point.y >= 0.0) curpath->LineTo(DrawLib::FPPoint(-1, 0.1666));
        }

        curpath->ClosePath();
}


// *** WedgeEllipseCallout shape (st63). ***

void WedgeEllipseCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                0.7,0.7,  0.7,0.7);

        // Is the adjust point outside the ellipse?
        if(adjust_point.x*adjust_point.x  +
           adjust_point.y*adjust_point.y  > 1.0)
        {
                float adjust_angle = Escher::GetDirectionTo(
                        DrawLib::FPPoint( 0,  0), adjust_point);

                curpath->MoveTo(
                        DrawLib::FPPoint( sin(adjust_angle+0.18),
                                         -cos(adjust_angle+0.18)));
                curpath->ArcTo(
                        DrawLib::FPPoint( 0,  0),
                        DrawLib::FPSize( 1,  1),
                        DrawLib::FPPoint( sin(adjust_angle-0.18),
                                         -cos(adjust_angle-0.18)));
                curpath->LineTo(adjust_point);
                curpath->ClosePath();
        }
        // If not, it is just an ellipse:
        else
        {
                curpath->Ellipse(DrawLib::FPPoint( 0,  0), DrawLib::FPSize( 1,  1));
        }
}


// *** Wave shape (st64). ***

WaveShape::WaveShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
        adjust.x = geometry_part.GetAdjustY_ValueMinMax(1, 0.000,    -0.5, 0.5);
        adjust.y = geometry_part.GetAdjustX_ValueMinMax(0,-0.725,    -1.0,-0.5);
}

void WaveShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adjust_y2 = -(1 - 2*(1 - -adjust.y));

        float dx1_1 = 0, dx1_2 = 0, dx2_1 = 0, dx2_2 = 0;
        float text_x = 1;
        if(adjust.x > 0)
        {
                dx1_1 =  adjust.x;
                dx2_2 = -adjust.x;
                text_x -= 2* adjust.x;
        }
        else
        {
                dx1_2 =  adjust.x;
                dx2_1 = -adjust.x;
                text_x -= 2*-adjust.x;
        }


        text_part.SetupTextBox(
                text_x,-adjust_y2,    text_x,-adjust_y2);


        // Define the main polygon clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1.00 + 2.0*dx1_1 + 0.0*dx1_2, -adjust.y )); // Left bottom
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-0.80 + 1.5*dx1_1 + 0.5*dx1_2, -adjust_y2),
                DrawLib::FPPoint(-0.55 + 1.5*dx1_1 + 0.5*dx1_2, -adjust_y2));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.20 + 1.0*dx1_1 + 1.0*dx1_2, -adjust_y2),
                DrawLib::FPPoint( 0.20 + 0.5*dx1_1 + 1.5*dx1_2,  1        ),
                DrawLib::FPPoint( 0.55 + 0.5*dx1_1 + 1.5*dx1_2,  1        ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.80 + 0.0*dx1_1 + 2.0*dx1_2,  1        ),
                DrawLib::FPPoint( 1.00 + 0.0*dx1_1 + 2.0*dx1_2, -adjust.y ));


        curpath->LineTo(DrawLib::FPPoint  (                                             1.00 + 0.0*dx2_1 + 2.0*dx2_2,  adjust.y )); // Right top
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.80 + 0.5*dx2_1 + 1.5*dx2_2,  adjust_y2),
                DrawLib::FPPoint( 0.55 + 0.5*dx2_1 + 1.5*dx2_2,  adjust_y2));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.20 + 1.0*dx2_1 + 1.0*dx2_2,  adjust_y2),
                DrawLib::FPPoint(-0.20 + 1.5*dx2_1 + 0.5*dx2_2, -1        ),
                DrawLib::FPPoint(-0.55 + 1.5*dx2_1 + 0.5*dx2_2, -1        ));
        PathCornerArcTo  (curpath,
                DrawLib::FPPoint(-0.80 + 2.0*dx2_1 + 0.0*dx2_2, -1        ),
                DrawLib::FPPoint(-1.00 + 2.0*dx2_1 + 0.0*dx2_2,  adjust.y ));

        curpath->ClosePath();
}


// *** FoldedCorner shape (st65). ***

FoldedCornerShape::FoldedCornerShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, 0.75,    0.0,1.0);
}

void FoldedCornerShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                1,1, 1,0.75*adjust + 0.25);

        // Define the main polygon:
        curpath->MoveTo(DrawLib::FPPoint(-1,-1)); // Left top
        curpath->LineTo(DrawLib::FPPoint( 1,-1)); // Right top
        curpath->LineTo(DrawLib::FPPoint( 1,adjust)); // Fold right
        curpath->LineTo(DrawLib::FPPoint(adjust, 1)); // Fold bottom
        curpath->LineTo(DrawLib::FPPoint(-1, 1)); // Left bottom
        curpath->ClosePath();

        DrawLib::FPPoint folded_corner(1 - ((1.0 - adjust)*0.74), 1-((1.0 - adjust)*0.97));
        DrawLib::FPPoint arc_corner   (1 - ((1.0 - adjust)*0.59), adjust + 0.3*(1.0 - adjust));

        // Define the dark folder right-bottom polygon:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(folded_corner); // Folded tip
        PathCornerArcTo(curpath,
                arc_corner,
                DrawLib::FPPoint(1, adjust)); // Fold right
        curpath->LineTo(DrawLib::FPPoint(adjust, 1)); // Fold bottom
        curpath->ClosePath();


        // Define the inner line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(adjust, 1)); // Fold bottom
        curpath->LineTo(folded_corner); // Folded tip
        PathCornerArcTo(curpath,
                arc_corner,
                DrawLib::FPPoint(1, adjust)); // Fold right
        /*curpath->BezierTo(
                DrawLib::FPPoint(1 - ((1.0 - adjust)*0.60), adjust + 0.2*(1.0 - adjust)),
                DrawLib::FPPoint(1 - ((1.0 - adjust)*0.20), adjust + 0.2*(1.0 - adjust)),
                DrawLib::FPPoint(1, adjust)); // Fold right*/
}


// *** LeftRightArrow shape (st69). ***
// *** UpDownArrow    shape (st70). ***

DoubleArrowShape::DoubleArrowShape(ShapeContainer const &shape_container, Direction _direction)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, direction(_direction)
, geometry_part(shape_container.GetProperties())
{
        if(direction == UPDOWN)
        {
                adjust_y = geometry_part.GetAdjustX_Value(0, -0.5);
                adjust_x = geometry_part.GetAdjustY_Value(1, -0.6);
        }
        else
        {
                adjust_x = geometry_part.GetAdjustX_Value(0, -0.6);
                adjust_y = geometry_part.GetAdjustY_Value(1, -0.5);
        }
}

void DoubleArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float text_adjust = 1.0 - ((adjust_x + 1.0)*-adjust_y);
        text_part.SetupTextBox(text_adjust,-adjust_y,  text_adjust,-adjust_y);

        if(direction == UPDOWN)
                ApplyTransform(MIRROR_XY_TRANSFORMATION);

        // Define the path:
        curpath->MoveTo(DrawLib::FPPoint(-1,  0)); // First arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust_x,-1       ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, adjust_y));

        curpath->LineTo(DrawLib::FPPoint(-adjust_x, adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-adjust_x,-1       ));
        curpath->LineTo(DrawLib::FPPoint( 1       , 0       )); // Second arrowhead top
        curpath->LineTo(DrawLib::FPPoint(-adjust_x, 1       ));
        curpath->LineTo(DrawLib::FPPoint(-adjust_x,-adjust_y));

        curpath->LineTo(DrawLib::FPPoint( adjust_x,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, 1       ));
        curpath->ClosePath();
}


// *** IrregularSeal1 shape (st71). ***

IrregularSeal1Shape::IrregularSeal1Shape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void IrregularSeal1Shape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.58,0.4,  0.52,0.3);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0.34,-1.00)); // The point hitting the top
        curpath->LineTo(DrawLib::FPPoint( 0.31,-0.51));

        curpath->LineTo(DrawLib::FPPoint( 0.69,-0.59));
        curpath->LineTo(DrawLib::FPPoint( 0.54,-0.33));

        curpath->LineTo(DrawLib::FPPoint( 0.95,-0.25));
        curpath->LineTo(DrawLib::FPPoint( 0.63,-0.03));

        curpath->LineTo(DrawLib::FPPoint( 1.00, 0.23));
        curpath->LineTo(DrawLib::FPPoint( 0.55, 0.19));

        curpath->LineTo(DrawLib::FPPoint( 0.67, 0.67));
        curpath->LineTo(DrawLib::FPPoint( 0.29, 0.34));

        curpath->LineTo(DrawLib::FPPoint( 0.23, 0.82));
        curpath->LineTo(DrawLib::FPPoint(-0.02, 0.38));

        curpath->LineTo(DrawLib::FPPoint(-0.22, 1.00));
        curpath->LineTo(DrawLib::FPPoint(-0.29, 0.44));

        curpath->LineTo(DrawLib::FPPoint(-0.56, 0.62));
        curpath->LineTo(DrawLib::FPPoint(-0.48, 0.28));

        curpath->LineTo(DrawLib::FPPoint(-0.99, 0.34));
        curpath->LineTo(DrawLib::FPPoint(-0.66, 0.09));

        curpath->LineTo(DrawLib::FPPoint(-1.00,-0.20));
        curpath->LineTo(DrawLib::FPPoint(-0.58,-0.29));

        curpath->LineTo(DrawLib::FPPoint(-0.97,-0.78));
        curpath->LineTo(DrawLib::FPPoint(-0.32,-0.42));

        curpath->LineTo(DrawLib::FPPoint(-0.23,-0.79));
        curpath->LineTo(DrawLib::FPPoint(-0.01,-0.47));

        curpath->ClosePath();
}


// *** IrregularSeal2 shape (st72). ***

IrregularSeal2Shape::IrregularSeal2Shape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void IrregularSeal2Shape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.5,0.4,  0.35,0.5);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0.36,-1.00)); // The point hitting the top
        curpath->LineTo(DrawLib::FPPoint( 0.35,-0.45));

        curpath->LineTo(DrawLib::FPPoint( 0.65,-0.70));
        curpath->LineTo(DrawLib::FPPoint( 0.50,-0.40));

        curpath->LineTo(DrawLib::FPPoint( 1.00,-0.40));
        curpath->LineTo(DrawLib::FPPoint( 0.55,-0.15));

        curpath->LineTo(DrawLib::FPPoint( 0.70, 0.05));
        curpath->LineTo(DrawLib::FPPoint( 0.50, 0.15));

        curpath->LineTo(DrawLib::FPPoint( 0.75, 0.45));
        curpath->LineTo(DrawLib::FPPoint( 0.35, 0.35));

        curpath->LineTo(DrawLib::FPPoint( 0.40, 0.60));
        curpath->LineTo(DrawLib::FPPoint( 0.10, 0.45));

        curpath->LineTo(DrawLib::FPPoint( 0.05, 0.70));
        curpath->LineTo(DrawLib::FPPoint(-0.10, 0.60));

        curpath->LineTo(DrawLib::FPPoint(-0.20, 0.80));
        curpath->LineTo(DrawLib::FPPoint(-0.30, 0.70));

        curpath->LineTo(DrawLib::FPPoint(-0.55, 1.00));
        curpath->LineTo(DrawLib::FPPoint(-0.55, 0.70));

        curpath->LineTo(DrawLib::FPPoint(-0.90, 0.65));
        curpath->LineTo(DrawLib::FPPoint(-0.70, 0.40));

        curpath->LineTo(DrawLib::FPPoint(-1.00, 0.20));
        curpath->LineTo(DrawLib::FPPoint(-0.60, 0.05));

        curpath->LineTo(DrawLib::FPPoint(-0.90,-0.25));
        curpath->LineTo(DrawLib::FPPoint(-0.50,-0.30));

        curpath->LineTo(DrawLib::FPPoint(-0.60,-0.65));
        curpath->LineTo(DrawLib::FPPoint(-0.20,-0.40));

        curpath->LineTo(DrawLib::FPPoint(-0.10,-0.80));
        curpath->LineTo(DrawLib::FPPoint( 0.05,-0.60));

        curpath->ClosePath();
}


// *** LightningBolt shape (st73). ***

LightningBoltShape::LightningBoltShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void LightningBoltShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.2,0.3,  0.28,0.325);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-0.212,-1.000)); // The point hitting the top
        curpath->LineTo(DrawLib::FPPoint( 0.196,-0.434));
        curpath->LineTo(DrawLib::FPPoint( 0.022,-0.366));
        curpath->LineTo(DrawLib::FPPoint( 0.536, 0.116));
        curpath->LineTo(DrawLib::FPPoint( 0.368, 0.196));
        curpath->LineTo(DrawLib::FPPoint( 1.000, 1.000));
        curpath->LineTo(DrawLib::FPPoint(-0.070, 0.384));
        curpath->LineTo(DrawLib::FPPoint( 0.134, 0.292));
        curpath->LineTo(DrawLib::FPPoint(-0.536,-0.098));
        curpath->LineTo(DrawLib::FPPoint(-0.294,-0.222));
        curpath->LineTo(DrawLib::FPPoint(-1.000,-0.636));

        curpath->ClosePath();
}


// *** Heart shape (st74). ***

HeartShape::HeartShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void HeartShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.53,0.78,  0.53,0.26);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0, 1)); // The bottom point
        curpath->LineTo(DrawLib::FPPoint(-0.95,-0.30));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1.10,-0.70),
                DrawLib::FPPoint(-0.80,-0.90));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-0.30,-1.20),
                DrawLib::FPPoint( 0   ,-0.8));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.30,-1.20),
                DrawLib::FPPoint( 0.80,-0.9 ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1.10,-0.70),
                DrawLib::FPPoint( 0.95,-0.30));

        curpath->ClosePath();
}


// *** QuadArrow shape (st76). ***

QuadArrowShape::QuadArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x2 = geometry_part.GetAdjustX_Value(0, -0.4);
        adjust_x  = geometry_part.GetAdjustX_ValueMinMax(1, -0.2,      -1.0,0.0);
        adjust_y  = geometry_part.GetAdjustY_Value(2, -0.6);
}

void QuadArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float text_x;
        if(adjust_x2 < 0)
                text_x = 1 - (1 - -adjust_y) * (adjust_x/adjust_x2);
        else
                text_x = 0;

        text_part.SetupTextBox(
                 text_x,-adjust_x,  text_x,-adjust_x);


        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( adjust_x , adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x2, adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( 0,-1)); // Top
        curpath->LineTo(DrawLib::FPPoint(-adjust_x2, adjust_y ));
        curpath->LineTo(DrawLib::FPPoint(-adjust_x , adjust_y ));

        curpath->LineTo(DrawLib::FPPoint(-adjust_x , adjust_x )); // Inner corner

        curpath->LineTo(DrawLib::FPPoint(-adjust_y , adjust_x ));
        curpath->LineTo(DrawLib::FPPoint(-adjust_y , adjust_x2));
        curpath->LineTo(DrawLib::FPPoint( 1, 0)); // Right
        curpath->LineTo(DrawLib::FPPoint(-adjust_y ,-adjust_x2));
        curpath->LineTo(DrawLib::FPPoint(-adjust_y ,-adjust_x ));

        curpath->LineTo(DrawLib::FPPoint(-adjust_x ,-adjust_x )); // Inner corner

        curpath->LineTo(DrawLib::FPPoint(-adjust_x ,-adjust_y ));
        curpath->LineTo(DrawLib::FPPoint(-adjust_x2,-adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( 0, 1)); // Bottom
        curpath->LineTo(DrawLib::FPPoint( adjust_x2,-adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x ,-adjust_y ));

        curpath->LineTo(DrawLib::FPPoint( adjust_x ,-adjust_x )); // Inner corner

        curpath->LineTo(DrawLib::FPPoint( adjust_y ,-adjust_x ));
        curpath->LineTo(DrawLib::FPPoint( adjust_y ,-adjust_x2));
        curpath->LineTo(DrawLib::FPPoint(-1, 0)); // Left
        curpath->LineTo(DrawLib::FPPoint( adjust_y , adjust_x2));
        curpath->LineTo(DrawLib::FPPoint( adjust_y , adjust_x ));

        curpath->LineTo(DrawLib::FPPoint( adjust_x , adjust_x )); // Inner corner

        curpath->ClosePath();
}


// *** LeftArrowCallout  shape (st77). ***
// *** RightArrowCallout shape (st78). ***
// *** UpArrowCallout    shape (st79). ***
// *** DownArrowCallout  shape (st80). ***

ArrowCalloutShape::ArrowCalloutShape(ShapeContainer const &shape_container, Direction _direction)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, direction(_direction)
, geometry_part(shape_container.GetProperties())
{
        float f = (direction == RIGHT || direction == DOWN)?-1:1;

        adjust1 = f*geometry_part.GetAdjustX_Value(0, -f*0.33);
        adjust2 =   geometry_part.GetAdjustX_ValueMinMax(1, -  0.50,   -1.0,0.0);
        adjust3 = f*geometry_part.GetAdjustY_Value(2, -f*0.67);
        adjust4 =   geometry_part.GetAdjustY_ValueMinMax(3, -  0.25,   -1.0,0.0);
}

void ArrowCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(-adjust1,1,    1,1);

        switch(direction)
        {
        case LEFT:
                break;
        case RIGHT:
                ApplyTransform(MIRROR_X_TRANSFORMATION);
                break;
        case UP:
                ApplyTransform(MIRROR_XY_TRANSFORMATION);
                break;
        case DOWN:
                ApplyTransform(MIRROR_X_TRANSFORMATION);
                ApplyTransform(MIRROR_XY_TRANSFORMATION);
                break;
        }

        // Define the path:
        curpath->MoveTo(DrawLib::FPPoint( 1      ,-1      )); // Back corner
        curpath->LineTo(DrawLib::FPPoint( adjust1,-1      ));
        curpath->LineTo(DrawLib::FPPoint( adjust1, adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust3, adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust3, adjust2));
        curpath->LineTo(DrawLib::FPPoint(-1      , 0      )); // Arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust3,-adjust2));
        curpath->LineTo(DrawLib::FPPoint( adjust3,-adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust1,-adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust1, 1      ));
        curpath->LineTo(DrawLib::FPPoint( 1      , 1      )); // Other back corner
        curpath->ClosePath();
}


// *** LeftRightArrowCallout shape (st81). ***
// *** UpDownArrowCallout    shape (st82). ***

DoubleArrowCalloutShape::DoubleArrowCalloutShape(ShapeContainer const &shape_container, Direction _direction)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, direction(_direction)
, geometry_part(shape_container.GetProperties())
{
        adjust1 = geometry_part.GetAdjustX_ValueMinMax(0, -0.50,     -1.0,0.0);
        adjust2 = geometry_part.GetAdjustX_ValueMinMax(1, -0.50,     -1.0,0.0);
        adjust3 = geometry_part.GetAdjustY_ValueMinMax(2, -0.75,     -1.0,0.0);
        adjust4 = geometry_part.GetAdjustY_ValueMinMax(3, -0.25,     -1.0,0.0);
}

void DoubleArrowCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(-adjust1,1,    -adjust1,1);

        if(direction == UPDOWN)
                ApplyTransform(MIRROR_XY_TRANSFORMATION);

        // Define the path anti-clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-adjust1, 1      )); // Right top
        curpath->LineTo(DrawLib::FPPoint(-adjust1,-adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust3,-adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust3,-adjust2));
        curpath->LineTo(DrawLib::FPPoint( 1      , 0      )); // Right arrowhead top
        curpath->LineTo(DrawLib::FPPoint(-adjust3, adjust2));
        curpath->LineTo(DrawLib::FPPoint(-adjust3, adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust1, adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust1,-1      ));

        curpath->LineTo(DrawLib::FPPoint( adjust1,-1      ));
        curpath->LineTo(DrawLib::FPPoint( adjust1, adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust3, adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust3, adjust2));
        curpath->LineTo(DrawLib::FPPoint(-1      , 0      )); // Left arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust3,-adjust2));
        curpath->LineTo(DrawLib::FPPoint( adjust3,-adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust1,-adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust1, 1      ));

        curpath->ClosePath();
}


// *** QuadArrowCallout shape (st83). ***

QuadArrowCalloutShape::QuadArrowCalloutShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust1 = geometry_part.GetAdjustX_ValueMinMax(0, -0.50,     -1.0,0.0);
        adjust2 = geometry_part.GetAdjustX_ValueMinMax(1, -0.25,     -1.0,0.0);
        adjust3 = geometry_part.GetAdjustY_ValueMinMax(2, -0.75,     -1.0,0.0);
        adjust4 = geometry_part.GetAdjustY_ValueMinMax(3, -0.12,     -1.0,0.0);
}

void QuadArrowCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 -adjust1,-adjust1,    -adjust1,-adjust1);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( adjust1,-adjust1)); // Right top

        curpath->LineTo(DrawLib::FPPoint( adjust4,-adjust1));
        curpath->LineTo(DrawLib::FPPoint( adjust4,-adjust3));
        curpath->LineTo(DrawLib::FPPoint( adjust2,-adjust3));
        curpath->LineTo(DrawLib::FPPoint( 0      , 1      )); // Bottom arrowhead top
        curpath->LineTo(DrawLib::FPPoint(-adjust2,-adjust3));
        curpath->LineTo(DrawLib::FPPoint(-adjust4,-adjust3));
        curpath->LineTo(DrawLib::FPPoint(-adjust4,-adjust1));

        curpath->LineTo(DrawLib::FPPoint(-adjust1,-adjust1));

        curpath->LineTo(DrawLib::FPPoint(-adjust1,-adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust3,-adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust3,-adjust2));
        curpath->LineTo(DrawLib::FPPoint( 1      , 0      )); // Right arrowhead top
        curpath->LineTo(DrawLib::FPPoint(-adjust3, adjust2));
        curpath->LineTo(DrawLib::FPPoint(-adjust3, adjust4));
        curpath->LineTo(DrawLib::FPPoint(-adjust1, adjust4));

        curpath->LineTo(DrawLib::FPPoint(-adjust1, adjust1));

        curpath->LineTo(DrawLib::FPPoint(-adjust4, adjust1));
        curpath->LineTo(DrawLib::FPPoint(-adjust4, adjust3));
        curpath->LineTo(DrawLib::FPPoint(-adjust2, adjust3));
        curpath->LineTo(DrawLib::FPPoint( 0      ,-1      )); // Top arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust2, adjust3));
        curpath->LineTo(DrawLib::FPPoint( adjust4, adjust3));
        curpath->LineTo(DrawLib::FPPoint( adjust4, adjust1));

        curpath->LineTo(DrawLib::FPPoint( adjust1, adjust1));

        curpath->LineTo(DrawLib::FPPoint( adjust1, adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust3, adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust3, adjust2));
        curpath->LineTo(DrawLib::FPPoint(-1      , 0      )); // Left arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust3,-adjust2));
        curpath->LineTo(DrawLib::FPPoint( adjust3,-adjust4));
        curpath->LineTo(DrawLib::FPPoint( adjust1,-adjust4));

        curpath->ClosePath();
}


// *** LeftBracket  shape (st85). ***
// *** RightBracket shape (st86). ***

BracketShape::BracketShape(ShapeContainer const &shape_container, bool _is_right_bracket)
: AbstractLineShape (shape_container, true)
, is_right_bracket(_is_right_bracket)
{
        adjust_y = geometry_part.GetAdjustY_ValueMinMax(0, -0.8,     -1.0,0.0);
}

DrawLib::FPBoundingBox BracketShape::SetupLineAndFill(DrawLib::XForm2D const& transform)
{
        float edge_x = is_right_bracket ? -1 : 1;

        DrawLib::FPBoundingBox outerbox = arrowheads_part.ApplyToCanvas(transform,
                edge_x, -1, -edge_x, -1 + 0.5 * (1 + adjust_y),
                edge_x,  1, -edge_x,  1 - 0.5 * (1 + adjust_y),
                line_part.GetLineWidth());

        float text_y = 1 - (1 / 3.0) * (1 + adjust_y);

        if (is_right_bracket)
                text_part.SetupTextBox(1, text_y,    0.4, text_y);
        else
                text_part.SetupTextBox(0.4, text_y,    1, text_y);

        outline_path.MoveTo(arrowheads_part.GetConnectionPoint(ArrowHeadsPart::START));
        outline_path.ArcToR(
                DrawLib::FPPoint(edge_x * 1, adjust_y) * transform,
                DrawLib::FPSize(edge_x * 2, 1 + adjust_y) * transform,
                DrawLib::FPPoint(edge_x * -1, adjust_y) * transform);
        outline_path.LineTo(
                DrawLib::FPPoint(edge_x * -1, -adjust_y) * transform);
        outline_path.ArcToR(
                DrawLib::FPPoint(edge_x * 1, -adjust_y) * transform,
                DrawLib::FPSize(edge_x * 2, 1 + adjust_y) * transform,
                arrowheads_part.GetConnectionPoint(ArrowHeadsPart::END));

        fill_path = outline_path;
        fill_path.ClosePath();
        return outerbox;
}


// *** LeftBrace  shape (st87). ***
// *** RightBrace shape (st88). ***

BraceShape::BraceShape(ShapeContainer const &shape_container, bool _is_right_brace)
: AbstractLineShape (shape_container, false)
, is_right_brace(_is_right_brace)
{
        adjust_y1 = -geometry_part.GetAdjustY_ValueMinMax(0, -0.8,      -1.0,0.0);
        adjust_y2 =  geometry_part.GetAdjustY_Value(1,  0.0);
}

DrawLib::FPBoundingBox BraceShape::SetupLineAndFill(DrawLib::XForm2D const& transform)
{
        float edge_x = is_right_brace ? -1 : 1;

        DrawLib::FPBoundingBox outerbox = arrowheads_part.ApplyToCanvas(transform,
                edge_x, -1,      0, -1 + 0.3 * (1 - adjust_y1),
                edge_x,  1,      0,  1 - 0.3 * (1 - adjust_y1),
                line_part.GetLineWidth());

        float text_y = 1 - (1 / 3.0) * (1 - adjust_y1);

        float adjust_y1_2 = 1.0 - adjust_y1;

        if(is_right_brace)
                text_part.SetupTextBox(1, text_y,   -0.3,text_y);
        else
                text_part.SetupTextBox(-0.3, text_y,   1,text_y);

        outline_path.MoveTo(arrowheads_part.GetConnectionPoint(ArrowHeadsPart::START));
        outline_path.ArcToR(
                DrawLib::FPPoint(edge_x * 1, -adjust_y1) * transform,
                DrawLib::FPSize(edge_x * 1,  1 - adjust_y1) * transform,
                DrawLib::FPPoint(0, -adjust_y1) * transform);
        outline_path.LineTo(
                DrawLib::FPPoint(0, adjust_y2 - adjust_y1_2) * transform);
        outline_path.ArcTo(
                DrawLib::FPPoint(edge_x * -1, adjust_y2 - adjust_y1_2) * transform,
                DrawLib::FPSize(edge_x * 1, 1 -adjust_y1) * transform,
                DrawLib::FPPoint(edge_x * -1, adjust_y2) * transform);
        outline_path.ArcTo(
                DrawLib::FPPoint(edge_x * -1, adjust_y2 + adjust_y1_2) * transform,
                DrawLib::FPSize(edge_x * 1,   1 - adjust_y1) * transform,
                DrawLib::FPPoint(0,  adjust_y2 + adjust_y1_2) * transform);
        outline_path.LineTo(
                DrawLib::FPPoint(0, adjust_y1) * transform);
        outline_path.ArcToR(
                DrawLib::FPPoint(edge_x * 1, adjust_y1) * transform,
                DrawLib::FPSize(edge_x * 1,  1 - adjust_y1) * transform,
                arrowheads_part.GetConnectionPoint(ArrowHeadsPart::END));


        fill_path = outline_path;
        fill_path.ClosePath();

        return outerbox;
}


// *** LeftUpArrow shape (st89). ***

LeftUpArrowShape::LeftUpArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x2 =  geometry_part.GetAdjustX_Value(0,-0.15);
        adjust_x  =  geometry_part.GetAdjustX_Value(1, 0.70);
        adjust_y   = geometry_part.GetAdjustY_Value(2,-0.4);
}

void LeftUpArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adjust_x4 = adjust_x2 + (1 - adjust_x);
        float adjust_x3 = (adjust_x + adjust_x4) / 2;

        float text_left;
        if(adjust_x3 != adjust_x2)
                text_left = 1 - (1 - -adjust_y) * ((adjust_x3-adjust_x4) / (adjust_x3-adjust_x2));
        else
                text_left = 1;

        text_part.SetupTextBox(
                 text_left,-adjust_x4,   adjust_x,adjust_x);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( adjust_x , adjust_x )); // Right bottom
        curpath->LineTo(DrawLib::FPPoint( adjust_y , adjust_x ));
        curpath->LineTo(DrawLib::FPPoint( adjust_y , 1        ));
        curpath->LineTo(DrawLib::FPPoint(-1        , adjust_x3)); // Left arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust_y , adjust_x2));
        curpath->LineTo(DrawLib::FPPoint( adjust_y , adjust_x4));
        curpath->LineTo(DrawLib::FPPoint( adjust_x4, adjust_x4)); // Inner corner
        curpath->LineTo(DrawLib::FPPoint( adjust_x4, adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x2, adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x3,-1        )); // Top arrowhead top
        curpath->LineTo(DrawLib::FPPoint( 1        , adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x , adjust_y ));
        curpath->ClosePath();
}


// *** BentUp shape (st90). ***

BentUpArrowShape::BentUpArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x2 =  geometry_part.GetAdjustX_Value(0,-0.15);
        adjust_x  =  geometry_part.GetAdjustX_Value(1, 0.70);
        adjust_y   = geometry_part.GetAdjustY_ValueMinMax(2,-0.3 ,      -1.0,0.0);
}

void BentUpArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adjust_x4 = adjust_x2 + (1 - adjust_x);
        float adjust_x3 = (adjust_x + adjust_x4) / 2;

        float adjust_y2 = 1 - (1 - adjust_x2) * pow(1 - ((1 - adjust_x) / (1-adjust_x3)), 0.72);

        text_part.SetupTextBox(
                 1,-adjust_y2,   adjust_x,1);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( adjust_x , 1        )); // Right bottom
        curpath->LineTo(DrawLib::FPPoint(-1        , 1        ));
        curpath->LineTo(DrawLib::FPPoint(-1        , adjust_y2));
        curpath->LineTo(DrawLib::FPPoint( adjust_x4, adjust_y2)); // Inner corner
        curpath->LineTo(DrawLib::FPPoint( adjust_x4, adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x2, adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x3,-1        )); // Top arrowhead top
        curpath->LineTo(DrawLib::FPPoint( 1        , adjust_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x , adjust_y ));
        curpath->ClosePath();
}


// *** BentArrow shape (st91). ***

BentArrowShape::BentArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x = geometry_part.GetAdjustX_ValueMinMax(0, 0.4 ,       0.15, 1.0);
        adjust_y = geometry_part.GetAdjustY_ValueMinMax(1,-0.73,      -1.00,-0.4);
}

void BentArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adjust_y2 = -0.437 + ((-adjust_y)-0.437);
        float adjust_x2 = 0.15 - 1.15*(1 - ((-adjust_y)-0.437)/(1-0.437));

        float text_right = 1 - (1-adjust_x) * (((-adjust_y)-0.437) / (1-0.437));
        text_part.SetupTextBox(
                 -0.15,-adjust_y, text_right, adjust_y2);

        // Define the path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1        , 1        )); // Left bottom
        curpath->LineTo(
                DrawLib::FPPoint(-1        , 0.15     ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1        , adjust_y ),
                DrawLib::FPPoint( 0.15     , adjust_y ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x , adjust_y ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x , -1       ));
        curpath->LineTo(
                DrawLib::FPPoint( 1        ,-0.437    )); // Arrowhead top
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x , 0.12     ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x , adjust_y2));
        curpath->LineTo(
                DrawLib::FPPoint( 0.15     , adjust_y2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust_x2, adjust_y2),
                DrawLib::FPPoint( adjust_x2, 0.15     ));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x2, 1        ));
        curpath->ClosePath();
}


// *** StripedRightArrow shape (st93). ***

StripedRightArrowShape::StripedRightArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x = geometry_part.GetAdjustX_ValueMinMax(0, 0.5,        -0.6875,1.0);
        adjust_y = geometry_part.GetAdjustY_ValueMinMax(1,-0.5,        -1.0   ,0.0);
}

void StripedRightArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float a_x2 = 1.0 - (adjust_x - 1.0)*adjust_y;

        text_part.SetupTextBox(
                 0.6875,-adjust_y, a_x2,-adjust_y);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( adjust_x,-1       )); // Right top top
        curpath->LineTo(DrawLib::FPPoint( 1       , 0       ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, 1       ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.6875  ,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.6875  , adjust_y));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, adjust_y));
        curpath->ClosePath();

        // Define the first rectangle at the arrow end:
        curpath = CreatePath(1.0, true, true, false);
        curpath->MoveTo(DrawLib::FPPoint(-0.75    , adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.875   , adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.875   ,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.75    ,-adjust_y));
        curpath->ClosePath();

        // Define the second rectangle at the arrow end:
        curpath = CreatePath(1.0, true, true, false);
        curpath->MoveTo(DrawLib::FPPoint(-1       , adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.9375  , adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-0.9375  ,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-1       ,-adjust_y));
        curpath->ClosePath();
}


// *** NotchedRightArrow shape (st94). ***

NotchedRightArrowShape::NotchedRightArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x = geometry_part.GetAdjustX_Value(0, 0.5);
        adjust_y = geometry_part.GetAdjustY_ValueMinMax(1,-0.5,     -1.0,0.0);
}

void NotchedRightArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float a_x2 = 1.0 - (adjust_x - 1.0)*adjust_y;

        text_part.SetupTextBox(
                 a_x2,-adjust_y, a_x2,-adjust_y);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( adjust_x,-1       )); // Right top top
        curpath->LineTo(DrawLib::FPPoint( 1       , 0       ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, 1       ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-1       ,-adjust_y));
        curpath->LineTo(DrawLib::FPPoint(-a_x2    , 0       ));
        curpath->LineTo(DrawLib::FPPoint(-1       , adjust_y));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, adjust_y));
        curpath->ClosePath();
}


// *** BlockArc shape (st95). ***

BlockArcShape::BlockArcShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        angle    =   geometry_part.GetAdjust16_16_Value(0,  180,       -180.1, 180.1);
        adjust_x = 1+geometry_part.GetAdjustX_ValueMinMax    (1, -0.5,       -  1.0,   0.0);
}

void BlockArcShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        // Angle to radials:
        float angle_r = (angle/180)*M_PI;
        float l_sin = sin(angle_r);
        float l_cos = cos(angle_r);


        float text_left   = 1;
        float text_top    = 1;
        float text_right  = 1;
        float text_bottom = 1;

        if(angle < -90)// && angle > -180
        {
                text_left   = -l_cos;
                text_right  = -l_cos;
                text_bottom = l_sin*adjust_x;
        }
        else if(angle < 0 && angle > -90)
        {
                text_top    = -l_sin;
        }
        else if(angle > 90 && angle <= 180)
        {
                text_bottom =  l_sin;
        }
        else // angle > -90 && angle < 0
        {
                // Bug in MS Escher:No text in this case:
                text_left=0;text_right=0;text_top=0;text_bottom=0;
        }

        text_part.SetupTextBox(
                 text_left,text_top, text_right, text_bottom);

        curpath->MoveTo(DrawLib::FPPoint(l_cos, l_sin));
        // Outer arc (clockwise):
        curpath->ArcTo(
                DrawLib::FPPoint(0,0),
                DrawLib::FPSize(1,1),
                DrawLib::FPPoint(-l_cos,l_sin));

        curpath->LineTo(DrawLib::FPPoint(adjust_x*-l_cos,adjust_x*l_sin)); // To the inner arc

        // Inner arc (counter-clockwise):
        curpath->ArcToR(
                DrawLib::FPPoint(0,0),
                DrawLib::FPSize(adjust_x,adjust_x),
                DrawLib::FPPoint(adjust_x*l_cos,adjust_x*l_sin));

        curpath->ClosePath();
}


// *** SmileyFace shape (st96). ***

SmileyFaceShape::SmileyFaceShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, 0.625,     0.43,0.63);
}

void SmileyFaceShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        text_part.SetupTextBox(
                0.7,0.7,  0.7,0.7);

        // The face:
        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize( 1,1));

        // The mounth line/arc:
        curpath->MoveTo(
                DrawLib::FPPoint(-0.55, 0.53+    (0.53 - adjust)));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0   , 0.53-4.0*(0.53 - adjust)),
                DrawLib::FPPoint( 0.55, 0.53+    (0.53 - adjust)));

        // The eyes:
        curpath = CreatePath(0.8, true, true, false);
        curpath->Ellipse(DrawLib::FPPoint(-0.32,-0.30), DrawLib::FPSize(  0.11,0.1));
        curpath = CreatePath(0.8, true, true, false);
        curpath->Ellipse(DrawLib::FPPoint( 0.32,-0.30), DrawLib::FPSize(  0.11,0.1));
}


// *** VerticalScroll shape (st97). ***

VerticalScrollShape::VerticalScrollShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
}

void VerticalScrollShape::SetupPaths(float aspect_ratio)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.75,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.75,aspect_ratio);

        float dx_1 = (1 - adj_x);
        float dx_2 = (1 - adj_x)/2;
        float dx_4 = (1 - adj_x)/4;

        float dy_2 = (1 - adj_y)/2;
        float dy_4 = (1 - adj_y)/4;

        text_part.SetupTextBox(
                adj_x,adj_y, adj_x,adj_y + dy_2);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_x        ,-adj_y - dy_2)); // Left top left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x        ,-1                ),
                DrawLib::FPPoint(-adj_x + dx_2 ,-1                ));
        curpath->LineTo(
                DrawLib::FPPoint( 1          - dx_2 ,-1                ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                 ,-1                ),
                DrawLib::FPPoint( 1                 ,-1          + dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                 ,-adj_y       ),
                DrawLib::FPPoint( 1          - dx_2 ,-adj_y       ));
        curpath->LineTo(
                DrawLib::FPPoint( adj_x        ,-adj_y       ));
        curpath->LineTo(
                DrawLib::FPPoint( adj_x        , adj_y + dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_x        , 1                ),
                DrawLib::FPPoint( adj_x - dx_2 , 1                ));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_x - dx_2 , 1                ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x        , 1                ),
                DrawLib::FPPoint(-adj_x        , 1          - dy_2));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_x - dx_2 , 1          - dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x - dx_4 , 1          - dy_2),
                DrawLib::FPPoint(-adj_x - dx_4 , adj_y + dy_4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x - dx_4 , adj_y       ),
                DrawLib::FPPoint(-adj_x - dx_2 , adj_y       ));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_x        , adj_y       ));
        curpath->ClosePath();

        // ... with the inner line in the left bottom:
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_x        , 1          - dy_2));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_x        , adj_y       ));

        // ... and with the inner line in the right top:
        curpath->MoveTo(
                DrawLib::FPPoint( adj_x        ,-adj_y       ));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_x + dx_2 ,-adj_y       ));


        // Define the upper left inner path:
        curpath = CreatePath(0.8, true, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_x + dx_1 ,-adj_y - dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x + dx_1 ,-adj_y       ),
                DrawLib::FPPoint(-adj_x + dx_2 ,-adj_y       ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x + dx_4 ,-adj_y       ),
                DrawLib::FPPoint(-adj_x + dx_4 ,-adj_y - dy_4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x + dx_4 ,-adj_y - dy_2),
                DrawLib::FPPoint(-adj_x + dx_2 ,-adj_y - dy_2));
        curpath->ClosePath();

        // ... with the arc to the top:
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_x + dx_1 ,-adj_y - dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x + dx_1 ,-1                ),
                DrawLib::FPPoint(-adj_x + dx_2 ,-1                ));


        // Define the lower left inner path, to fill, anti-clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_x - dx_2 , 1          - dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x - dx_4 , 1          - dy_2),
                DrawLib::FPPoint(-adj_x - dx_4 , adj_y + dy_4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x - dx_4 , adj_y       ),
                DrawLib::FPPoint(-adj_x - dx_2 , adj_y       ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                 , adj_y       ),
                DrawLib::FPPoint(-1                 , adj_y + dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                 , 1                ),
                DrawLib::FPPoint(-1          + dx_2 , 1                ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_x        , 1                ),
                DrawLib::FPPoint(-adj_x        , 1          - dy_2));
        curpath->ClosePath();

        // .. and its outline:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_x - dx_2 , adj_y       ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                 , adj_y       ),
                DrawLib::FPPoint(-1                 , adj_y + dy_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                 , 1                ),
                DrawLib::FPPoint(-1          + dx_2 , 1                ));
}


// *** HorizontalScroll shape (st98). ***

HorizontalScrollShape::HorizontalScrollShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat,
        DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
}

void HorizontalScrollShape::SetupPaths(float aspect_ratio)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adj_x = -geometry_part.GetScaledAdjustX_Value(0,-0.75,aspect_ratio);
        float adj_y = -geometry_part.GetScaledAdjustY_Value(0,-0.75,aspect_ratio);

        float dx_1 = (1 - adj_x)  ;
        float dx_2 = (1 - adj_x)/2;
        float dx_4 = (1 - adj_x)/4;
        float dy_2 = (1 - adj_y)/2;
        float dy_4 = (1 - adj_y)/4;

        text_part.SetupTextBox(
                adj_y,adj_x,    adj_y + dy_2,adj_x);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_y - dy_2, -adj_x       )); // Left top left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                , -adj_x       ),
                DrawLib::FPPoint(-1                , -adj_x + dx_2));
        curpath->LineTo(
                DrawLib::FPPoint(-1                ,  1          - dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                ,  1                ),
                DrawLib::FPPoint(-1          + dy_2,  1                ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_y       ,  1                ),
                DrawLib::FPPoint(-adj_y       ,  1          - dx_2));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_y       ,  adj_x       ));
        curpath->LineTo(
                DrawLib::FPPoint( adj_y + dy_2,  adj_x       ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                ,  adj_x       ),
                DrawLib::FPPoint( 1                ,  adj_x - dx_2));
        curpath->LineTo(
                DrawLib::FPPoint( 1                , -adj_x - dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                , -adj_x       ),
                DrawLib::FPPoint( 1          - dy_2, -adj_x       ));
        curpath->LineTo(
                DrawLib::FPPoint( 1          - dy_2, -adj_x - dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1          - dy_2, -adj_x - dx_4),
                DrawLib::FPPoint( adj_y + dy_4, -adj_x - dx_4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_y       , -adj_x - dx_4),
                DrawLib::FPPoint( adj_y       , -adj_x - dx_2));
        curpath->LineTo(
                DrawLib::FPPoint( adj_y       , -adj_x       ));
        curpath->ClosePath();

        // ... with the inner line in the left bottom:
        curpath->MoveTo(
                DrawLib::FPPoint( 1          - dy_2, -adj_x       ));
        curpath->LineTo(
                DrawLib::FPPoint( adj_y       , -adj_x       ));

        // ... and with the inner line in the right top:
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_y       ,  adj_x       ));
        curpath->LineTo(
                DrawLib::FPPoint(-adj_y       , -adj_x + dx_2));


        // Define the upper left inner path:
        curpath = CreatePath(0.8, true, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_y - dy_2 ,-adj_x + dx_1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_y        ,-adj_x + dx_1),
                DrawLib::FPPoint(-adj_y        ,-adj_x + dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_y        ,-adj_x + dx_4),
                DrawLib::FPPoint(-adj_y - dy_4 ,-adj_x + dx_4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-adj_y - dy_2 ,-adj_x + dx_4),
                DrawLib::FPPoint(-adj_y - dy_2 ,-adj_x + dx_2));
        curpath->ClosePath();

        // ... with the arc to the top:
        curpath->MoveTo(
                DrawLib::FPPoint(-adj_y - dy_2 ,-adj_x + dx_1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1                 ,-adj_x + dx_1),
                DrawLib::FPPoint(-1                 ,-adj_x + dx_2));


        // Define the upper right inner path, to fill, anti-clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint( 1          - dy_2 ,-adj_x - dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1          - dy_2 ,-adj_x - dx_4),
                DrawLib::FPPoint( adj_y + dy_4 ,-adj_x - dx_4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_y        ,-adj_x - dx_4),
                DrawLib::FPPoint( adj_y        ,-adj_x - dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_y        ,-1                ),
                DrawLib::FPPoint( adj_y + dy_2 ,-1                ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                 ,-1                ),
                DrawLib::FPPoint( 1                 ,-1          + dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                 ,-adj_x       ),
                DrawLib::FPPoint( 1          - dy_2 ,-adj_x       ));
        curpath->ClosePath();

        // .. and its outline:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint( adj_y        ,-adj_x - dx_2));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adj_y        ,-1                ),
                DrawLib::FPPoint( adj_y + dy_2 ,-1                ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1                 ,-1                ),
                DrawLib::FPPoint( 1                 ,-1          + dx_2));
}


// *** CircularArrow shape (st99). ***

CircularArrowShape::CircularArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        angle1   =   geometry_part.GetAdjust16_16_Value(0, 180.0,      -180.1,180.1);
        angle2   =   geometry_part.GetAdjust16_16_Value(1,   0.0,      -180.1,180.1);
        adjust_x = 1+geometry_part.GetAdjustX_ValueMinMax    (2,  -0.5,      -  1.0,  0.0);
}

void CircularArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        // Angle to radials:
        float angle_r1 = (angle1/180)*M_PI;
        float l_sin1 = sin(angle_r1);
        float l_cos1 = cos(angle_r1);

        float angle_r2 = (angle2/180)*M_PI;
        float l_sin2 = sin(angle_r2);
        float l_cos2 = cos(angle_r2);

        text_part.SetupTextBox(
                 0.7,0.7,   0.7,0.7);

        // Calculate the 3 corners of the arrowhead:
        float c1_x =           1.25 *l_cos2;
        float c1_y =           1.25 *l_sin2;
        float c2_x = (adjust_x-0.25)*l_cos2;
        float c2_y = (adjust_x-0.25)*l_sin2;
        float top_x = (c2_x+c1_x)/2 + 0.5*(c2_y-c1_y);
        float top_y = (c2_y+c1_y)/2 - 0.5*(c2_x-c1_x);


        curpath->MoveTo(DrawLib::FPPoint(l_cos1, l_sin1));
        // Outer arc (clockwise):
        curpath->ArcTo(
                DrawLib::FPPoint(0,0),
                DrawLib::FPSize(1,1),
                DrawLib::FPPoint(l_cos2,l_sin2));

        curpath->LineTo(DrawLib::FPPoint(c1_x ,c1_y ));
        curpath->LineTo(DrawLib::FPPoint(top_x,top_y));
        curpath->LineTo(DrawLib::FPPoint(c2_x ,c2_y ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x      *l_cos2, adjust_x      *l_sin2));

        // Inner arc (counter-clockwise):
        curpath->ArcToR(
                DrawLib::FPPoint(0,0),
                DrawLib::FPSize(adjust_x,adjust_x),
                DrawLib::FPPoint(adjust_x*l_cos1,adjust_x*l_sin1));

        curpath->ClosePath();
}


// *** UturnArrow shape (st101). ***

UturnArrowShape::UturnArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{ }

void UturnArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                1,0.24,  -0.43,1);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, 1)); // Left bottom
        curpath->LineTo(DrawLib::FPPoint(-1,-0.24));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1   ,-1   ),
                DrawLib::FPPoint(-0.15,-1   ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.73,-1   ),
                DrawLib::FPPoint( 0.73,-0.24));

        curpath->LineTo(
                DrawLib::FPPoint( 1   ,-0.24));
        curpath->LineTo(
                DrawLib::FPPoint( 0.45, 0.30));
        curpath->LineTo(
                DrawLib::FPPoint(-0.1 ,-0.24));
        curpath->LineTo(
                DrawLib::FPPoint( 0.15,-0.24));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.15,-0.48),
                DrawLib::FPPoint(-0.15,-0.48));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-0.43,-0.48),
                DrawLib::FPPoint(-0.43,-0.24));

        curpath->LineTo(
                DrawLib::FPPoint(-0.43, 1   ));
        curpath->ClosePath();
}


// *** CurvedRightArrow shape (st102). ***
// *** CurvedLeftArrow  shape (st103). ***
// *** CurvedUpArrow    shape (st104). ***
// *** CurvedDownArrow  shape (st105). ***

CurvedArrowShape::CurvedArrowShape(ShapeContainer const &shape_container, Direction _direction)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, direction(_direction)
, geometry_part(shape_container.GetProperties())
{
        float f = (direction == UP || direction == LEFT)?-1:1;

        adjust_y  =   geometry_part.GetAdjustX_ValueMinMax(0,  0.20,      0.0,1.0);
        adjust_y2 =   geometry_part.GetAdjustX_ValueMinMax(1,  0.80,      0.0,1.0);
        adjust_x  = f*geometry_part.GetAdjustY_Value(2,f*0.35);
}

void CurvedArrowShape::SetupPaths(float)
{
        float adjust_hc = 1 - (1 - adjust_y)/2;
        float adjust_h3 = adjust_hc - (adjust_y2 - adjust_hc);
        float adjust_h4 = adjust_y + (1 - adjust_y2);
        float adjust_h5 = -1 + (adjust_y2 - adjust_h4);

        float center_h1 = (1+adjust_h3)/2 - 1;
        float center_h2 = center_h1 + (1+adjust_h5);

        text_part.SetupTextBox(
                0.725,1-0.5*(1 - -center_h1),
                0.725,adjust_y2 - 0.5*(1 - -center_h1));

        bool point_to_front = false;
        switch(direction)
        {
        case LEFT:
                ApplyTransform(MIRROR_X_TRANSFORMATION);
                break;
        case RIGHT:
                point_to_front = true;
                break;
        case UP:
                ApplyTransform(MIRROR_X_TRANSFORMATION);
                ApplyTransform(MIRROR_XY_TRANSFORMATION);
                break;
        case DOWN:
                point_to_front = true;
                ApplyTransform(MIRROR_XY_TRANSFORMATION);
                break;
        }


        float d_h = (1+center_h1) * (1-cos(asin(1 - (1+adjust_x)/2)));

        // Calculate the cross position of the two main arcs:
        float cross_h = (center_h1 + center_h2) / 2;
        float cross_w;
        if(center_h2 != adjust_h5)
                cross_w = 1 - 2*cos(asin(1- (cross_h - adjust_h5) / (center_h2 - adjust_h5)));
        else
                cross_w = -1;

        // Define the main path:
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);
        curpath->MoveTo(DrawLib::FPPoint( 1 , adjust_hc)); // Arrowhead top
        curpath->LineTo(DrawLib::FPPoint( adjust_x , adjust_y  - d_h));
        curpath->LineTo(DrawLib::FPPoint( adjust_x , adjust_h3 - d_h));
        if(point_to_front)
        {
                curpath->ArcTo(
                        DrawLib::FPPoint( 1,center_h1),
                        DrawLib::FPSize( 2,center_h1+1),
                        DrawLib::FPPoint(-1,center_h1));
                curpath->LineTo(DrawLib::FPPoint(-1, center_h2));
        }
        else
        {
                curpath->ArcTo(
                        DrawLib::FPPoint( 1,center_h1),
                        DrawLib::FPSize( 2,center_h1+1),
                        DrawLib::FPPoint(cross_w,cross_h));
        }
        curpath->ArcToR(
                DrawLib::FPPoint( 1,center_h2),
                DrawLib::FPSize( 2,center_h1+1),
                DrawLib::FPPoint(adjust_x, adjust_y2 - d_h));
        curpath->LineTo(DrawLib::FPPoint( adjust_x, 1 - d_h));
        curpath->ClosePath();


        // Define the extra path, the back to fill:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(DrawLib::FPPoint( 1 ,-1)); // Right top
        if(!point_to_front)
        {
                curpath->ArcToR(
                        DrawLib::FPPoint( 1,center_h1),
                        DrawLib::FPSize( 2,center_h1+1),
                        DrawLib::FPPoint(-1,center_h1));
                curpath->LineTo(DrawLib::FPPoint(-1,center_h2));
        }
        else
        {
                curpath->ArcToR(
                        DrawLib::FPPoint( 1,center_h1),
                        DrawLib::FPSize( 2,center_h1+1),
                        DrawLib::FPPoint(cross_w,cross_h));
        }
        curpath->ArcTo(
                DrawLib::FPPoint( 1,center_h2),
                DrawLib::FPSize( 2,center_h1+1),
                DrawLib::FPPoint( 1,adjust_h5));
        curpath->ClosePath();


        // ... and the same to stroke, anti-clockwise:
        curpath = CreatePath(0.8, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(cross_w,cross_h)); // Crossing point
        curpath->ArcTo(
                DrawLib::FPPoint( 1,center_h2),
                DrawLib::FPSize( 2,center_h1+1),
                DrawLib::FPPoint( 1,adjust_h5));
        curpath->LineTo(DrawLib::FPPoint( 1,-1));
        curpath->ArcToR(
                DrawLib::FPPoint( 1,center_h1),
                DrawLib::FPSize( 2,center_h1+1),
                DrawLib::FPPoint(-1,center_h1));
        if(!point_to_front)
                curpath->LineTo(DrawLib::FPPoint(-1,center_h2));
}


// *** CloudCallout shape (st106). ***

CloudCalloutShape::CloudCalloutShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat,
        DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_point = DrawLib::FPPoint(
                geometry_part.GetAdjustX_Value(0,-0.85),
                geometry_part.GetAdjustY_Value(1, 1.40));
}

CloudCalloutShape::EllipsAndArc const CloudCalloutShape::ellipses_and_arcs[] = {
        {-0.51,-0.37,     0.30, 0.43,       164, -45},
        {-0.14,-0.63,     0.24, 0.30,      -157, -46},
        { 0.23,-0.76,     0.22, 0.22,      -165, -43},
        { 0.54,-0.69,     0.22, 0.31,      -155,   0},
        { 0.71,-0.40,     0.22, 0.34,       -77,  53},
        { 0.67,-0.02,     0.32, 0.43,       -40,  80},
        { 0.45, 0.39,     0.28, 0.37,       -60, 125},
        { 0.00, 0.55,     0.31, 0.45,         9, 155},
        {-0.42, 0.38,     0.34, 0.49,        61, 151},
        {-0.77, 0.35,     0.19, 0.28,        58,-140},
        {-0.78,-0.06,     0.22, 0.28,        90, -95}
};

void CloudCalloutShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/false, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                0.72,0.70,  0.57,0.60);

        // First define a rectangular path, just to fill
        // the backgropund in between the ellipses:
        curpath->MoveTo(DrawLib::FPPoint(-0.72,-0.70));
        curpath->LineTo(DrawLib::FPPoint( 0.57,-0.70));
        curpath->LineTo(DrawLib::FPPoint( 0.57, 0.60));
        curpath->LineTo(DrawLib::FPPoint(-0.72, 0.60));
        curpath->ClosePath();

        // Fully add all ellipses here, to fill.
        // Together with the rectangle above, these fdefine the entire fill:
        EllipsAndArc const* eaa = ellipses_and_arcs;
        for(unsigned i=0; i < (sizeof(ellipses_and_arcs) / sizeof(ellipses_and_arcs[0])); ++i,++eaa)
        {
                curpath = CreatePath(1.0, false, true, false);
                curpath->Ellipse(DrawLib::FPPoint(eaa->p_x, eaa->p_y), DrawLib::FPSize( eaa->ax_x, eaa->ax_y));
        }

        // Now add all the arcs around those ellipses here,
        // to draw as outline of the 'cloud' itself:
        eaa = ellipses_and_arcs;
        for(unsigned i=0; i<(sizeof(ellipses_and_arcs) / sizeof(ellipses_and_arcs[0])); ++i,++eaa)
        {
                curpath = CreatePath(1.0, true, false, false);
                curpath->MoveTo(DrawLib::FPPoint(eaa->p_x + cos((eaa->an1/180)*M_PI) * eaa->ax_x,
                                                 eaa->p_y + sin((eaa->an1/180)*M_PI) * eaa->ax_y));
                curpath->ArcTo(
                        DrawLib::FPPoint(eaa->p_x , eaa->p_y ),
                        DrawLib::FPSize(eaa->ax_x, eaa->ax_y),
                        DrawLib::FPPoint(eaa->p_x + cos((eaa->an2/180)*M_PI) * eaa->ax_x,
                                         eaa->p_y + sin((eaa->an2/180)*M_PI) * eaa->ax_y));
        }


        // Now add the three 'external' ellipses:
        float adjust_dist = Escher::Distance(DrawLib::FPPoint(0,0), adjust_point);

        if(adjust_dist > 0)
        {
                curpath = CreatePath(1.0, true, true, true);
                curpath->Ellipse(DrawLib::FPPoint(
                                  (adjust_point.x / adjust_dist) * (1 + 0.3*(adjust_dist-1)),
                                  (adjust_point.y / adjust_dist) * (1 + 0.3*(adjust_dist-1))),
                                 DrawLib::FPSize(0.167,0.167));

                curpath = CreatePath(1.0, true, true, true);
                curpath->Ellipse(DrawLib::FPPoint(
                              (adjust_point.x / adjust_dist) * (1 + 0.7*(adjust_dist-1)),
                              (adjust_point.y / adjust_dist) * (1 + 0.7*(adjust_dist-1))),
                           DrawLib::FPSize(0.112,0.112));
        }

        curpath = CreatePath(1.0, true, true, true);
        curpath->Ellipse(DrawLib::FPPoint(adjust_point.x, adjust_point.y), DrawLib::FPSize( 0.06,0.06));
}


// *** EllipseRibbon shape (st107). ***

EllipseRibbonShape::EllipseRibbonShape(ShapeContainer const &shape_container, bool _is_upside_down)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
, is_upside_down(_is_upside_down)
{
        adjust_x  = geometry_part.GetAdjustX_ValueMinMax(0,-0.50,     -1.0,0.0);

        if(is_upside_down)
        {
                adjust_y1 = -geometry_part.GetAdjustY_ValueMinMax(1, 0.50,    -1.0, 1.0);
                adjust_y2 = -geometry_part.GetAdjustY_ValueMinMax(2,-0.75,    -1.0, 1.0);
        }
        else
        {
                adjust_y1 =  geometry_part.GetAdjustY_ValueMinMax(1,-0.50,    -1.0, 1.0);
                adjust_y2 =  geometry_part.GetAdjustY_ValueMinMax(2, 0.75,    -1.0, 1.0);
        }
}

void EllipseRibbonShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float center_y1 = M_PI_2/(1 - adjust_y2)+2;
        float center_y2 = center_y1+2-(1-adjust_y2);
        float ax_x      = 0.65+(center_y1-2)*0.605;
        float ax_y      = center_y1+1;
        float dy        = (1 - adjust_y1) - (1 - -adjust_y2);
        float dyc       = -(1 + adjust_y2)/2 + dy/2;

        center_y1 = -center_y1;
        center_y2 = -center_y2;

        text_part.SetupTextBox(
                 -adjust_x,-f(center_y2 - dy, ax_x, ax_y, 0       ),
                 -adjust_x, f(center_y1     , ax_x, ax_y, adjust_x));

        if(is_upside_down)
                ApplyTransform(MIRROR_Y_TRANSFORMATION);

        // Define the main path clockwise:
        // Top side:
        curpath->MoveTo(
                DrawLib::FPPoint(-1                   , adjust_y2 + dy                         ));
        curpath->ArcToR(
                DrawLib::FPPoint( 0                   , center_y1 + dy                         ),
                DrawLib::FPSize( ax_x                , ax_y                                   ),
                DrawLib::FPPoint( adjust_x            , f(center_y1 + dy, ax_x, ax_y, adjust_x)));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x            , f(center_y1     , ax_x, ax_y, adjust_x)));
        curpath->ArcToR(
                DrawLib::FPPoint( 0                   , center_y1                              ),
                DrawLib::FPSize( ax_x                , ax_y                                   ),
                DrawLib::FPPoint(-adjust_x            , f(center_y1     , ax_x, ax_y,-adjust_x)));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x            , f(center_y1 + dy, ax_x, ax_y,-adjust_x)));
        curpath->ArcToR(
                DrawLib::FPPoint( 0                   , center_y1 + dy                         ),
                DrawLib::FPSize( ax_x                , ax_y                                   ),
                DrawLib::FPPoint( 1                   , adjust_y2 + dy                         ));


        curpath->LineTo(
                DrawLib::FPPoint( 0.75                , f(center_y1+dyc , ax_x, ax_y, 0.75     )));


        // Bottom side:
        curpath->LineTo(
                DrawLib::FPPoint( 1                   ,-1                                      ));
        curpath->ArcTo(
                DrawLib::FPPoint( 0                   , center_y2),
                DrawLib::FPSize( ax_x                , ax_y),
                DrawLib::FPPoint(-adjust_x-0.25       , f(center_y2     , ax_x, ax_y,-adjust_x-0.25)));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x-0.25       , f(center_y2 - dy, ax_x, ax_y,-adjust_x-0.25)));
        curpath->ArcTo(
                DrawLib::FPPoint( 0                   , center_y2 - dy),
                DrawLib::FPSize( ax_x                , ax_y),
                DrawLib::FPPoint( adjust_x+0.25       , f(center_y2 - dy, ax_x, ax_y, adjust_x+0.25)));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x+0.25       , f(center_y2     , ax_x, ax_y, adjust_x+0.25)));
        curpath->ArcTo(
                DrawLib::FPPoint( 0                   , center_y2                              ),
                DrawLib::FPSize( ax_x                , ax_y                                   ),
                DrawLib::FPPoint(-1                   ,-1                                      ));


        curpath->LineTo(
                DrawLib::FPPoint(-0.75                , f(center_y1+dyc , ax_x, ax_y,-0.75    )));


        curpath->ClosePath();



        // Define the two vertical lines through the center:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint( adjust_x , f(center_y1+dy, ax_x, ax_y, adjust_x) ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x , f(center_y2-dy, ax_x, ax_y, adjust_x) ));
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-adjust_x , f(center_y1+dy, ax_x, ax_y,-adjust_x) ));
        curpath->LineTo(DrawLib::FPPoint(-adjust_x , f(center_y2-dy, ax_x, ax_y,-adjust_x) ));



        // Define the left fill path clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint( adjust_x+0.25       , f(center_y2     , ax_x, ax_y, adjust_x+0.25)));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x            , f(center_y2 - dy, ax_x, ax_y, adjust_x     )));
        curpath->ArcToR(
                DrawLib::FPPoint( 0                   , center_y2 - dy                              ),
                DrawLib::FPSize( ax_x                , ax_y                                        ),
                DrawLib::FPPoint( adjust_x+0.25       , f(center_y2 - dy, ax_x, ax_y, adjust_x+0.25)));
        curpath->ClosePath();

        // ... and the left outline path clockwise:
        curpath = CreatePath(0.8, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint( adjust_x+0.25       , f(center_y2     , ax_x, ax_y, adjust_x+0.25)));
        curpath->LineTo(
                DrawLib::FPPoint( adjust_x            , f(center_y2 - dy, ax_x, ax_y, adjust_x     )));
        curpath->ArcToR(
                DrawLib::FPPoint( 0                   , center_y2 - dy                              ),
                DrawLib::FPSize( ax_x                , ax_y                                        ),
                DrawLib::FPPoint( adjust_x+0.25       , f(center_y2 - dy, ax_x, ax_y, adjust_x+0.25)));


        // Define the right fill path anti-clockwise:
        curpath = CreatePath(0.8, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adjust_x-0.25       , f(center_y2     , ax_x, ax_y, adjust_x+0.25)));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x            , f(center_y2 - dy, ax_x, ax_y, adjust_x     )));
        curpath->ArcTo(
                DrawLib::FPPoint( 0                   , center_y2 - dy                              ),
                DrawLib::FPSize( ax_x                , ax_y                                        ),
                DrawLib::FPPoint(-adjust_x-0.25       , f(center_y2 - dy, ax_x, ax_y, adjust_x+0.25)));
        curpath->ClosePath    ();

        // ... and the right outline path anti-clockwise:
        curpath = CreatePath(0.8, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-adjust_x-0.25       , f(center_y2     , ax_x, ax_y,-adjust_x-0.25)));
        curpath->LineTo(
                DrawLib::FPPoint(-adjust_x            , f(center_y2 - dy, ax_x, ax_y,-adjust_x     )));
        curpath->ArcTo(
                DrawLib::FPPoint( 0                   , center_y2 - dy                              ),
                DrawLib::FPSize( ax_x                , ax_y                                        ),
                DrawLib::FPPoint(-adjust_x-0.25       , f(center_y2 - dy, ax_x, ax_y,-adjust_x-0.25)));
}

float EllipseRibbonShape::f(float center_y, float ax_x, float ax_y, float x) const
{
        float z = sin(acos(x / ax_x));
        return center_y + ax_y*z;
}


// *** FlowChartDecision shape (st110). ***

FlowChartDecisionShape::FlowChartDecisionShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartDecisionShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.5,0.5,  0.5,0.5);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0,-1)); // Top
        curpath->LineTo(DrawLib::FPPoint( 1, 0));
        curpath->LineTo(DrawLib::FPPoint( 0, 1));
        curpath->LineTo(DrawLib::FPPoint(-1, 0));
        curpath->ClosePath();
}


// *** FlowChartInputOutput shape (st111). ***

FlowChartInputOutputShape::FlowChartInputOutputShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartInputOutputShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.6,1,  0.6,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-0.6, -1)); // Left top top
        curpath->LineTo(DrawLib::FPPoint( 1  , -1));
        curpath->LineTo(DrawLib::FPPoint( 0.6,  1));
        curpath->LineTo(DrawLib::FPPoint(-1  ,  1));
        curpath->ClosePath();
}


// *** FlowChartPredefinedProcess shape (st112). ***

FlowChartPredefinedProcessShape::FlowChartPredefinedProcessShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartPredefinedProcessShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.75,1,  0.75,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, -1)); // Left top top
        curpath->LineTo(DrawLib::FPPoint( 1, -1));
        curpath->LineTo(DrawLib::FPPoint( 1,  1));
        curpath->LineTo(DrawLib::FPPoint(-1,  1));
        curpath->ClosePath();

        // The left line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-0.75,-1));
        curpath->LineTo(DrawLib::FPPoint(-0.75, 1));

        // The right line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint( 0.75,-1));
        curpath->LineTo(DrawLib::FPPoint( 0.75, 1));
}


// *** FlowChartInternalStorage shape (st113). ***

FlowChartInternalStorageShape::FlowChartInternalStorageShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartInternalStorageShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.6,0.6,  1,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, -1)); // Left top top
        curpath->LineTo(DrawLib::FPPoint( 1, -1));
        curpath->LineTo(DrawLib::FPPoint( 1,  1));
        curpath->LineTo(DrawLib::FPPoint(-1,  1));
        curpath->ClosePath();

        // The left line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-0.6,-1));
        curpath->LineTo(DrawLib::FPPoint(-0.6, 1));

        // The top line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-1,-0.6));
        curpath->LineTo(DrawLib::FPPoint( 1,-0.6));
}


// *** FlowChartDocument shape (st114). ***

FlowChartDocumentShape::FlowChartDocumentShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartDocumentShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,1,   1,0.6);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1  ,-1   )); // Left top top
        curpath->LineTo(
                DrawLib::FPPoint( 1  ,-1   ));
        curpath->LineTo(
                DrawLib::FPPoint( 1  , 0.6 ));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.5, 0.6 ),
                DrawLib::FPPoint( 0.1, 1.0 ),
                DrawLib::FPPoint(-0.5, 1.0 ));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.7, 1.0 ),
                DrawLib::FPPoint(-0.8, 0.9 ),
                DrawLib::FPPoint(-1.0, 0.85));
        curpath->ClosePath();
}


// *** FlowChartMultidocument shape (st115). ***

FlowChartMultidocumentShape::FlowChartMultidocumentShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartMultidocumentShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,0.65,   0.7250,0.675);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1     ,-0.65)); // Left top
        curpath->LineTo(
                DrawLib::FPPoint( 0.7250,-0.65));
        curpath->LineTo(
                DrawLib::FPPoint( 0.7250, 0.675));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.3725, 0.675),
                DrawLib::FPPoint(-0.1000, 1.000),
                DrawLib::FPPoint(-0.5250, 1.000));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.6375, 1.000),
                DrawLib::FPPoint(-0.8000, 0.950),
                DrawLib::FPPoint(-1     , 0.875));
        curpath->ClosePath();


        // Define the inner back 'document', clockwise:
        curpath = CreatePath(1.0, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-0.8500,-0.650));
        curpath->LineTo(
                DrawLib::FPPoint(-0.8500,-0.825));
        curpath->LineTo(
                DrawLib::FPPoint( 0.8625,-0.825));
        curpath->LineTo(
                DrawLib::FPPoint( 0.8625, 0.500));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.7925, 0.500),
                DrawLib::FPPoint( 0.7925, 0.500),
                DrawLib::FPPoint( 0.7250, 0.505));
        curpath->LineTo(
                DrawLib::FPPoint( 0.7250,-0.650));
        curpath->ClosePath();

        // ... and its outline:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-0.8500,-0.650));
        curpath->LineTo(
                DrawLib::FPPoint(-0.8500,-0.825));
        curpath->LineTo(
                DrawLib::FPPoint( 0.8625,-0.825));
        curpath->LineTo(
                DrawLib::FPPoint( 0.8625, 0.500));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.7925, 0.500),
                DrawLib::FPPoint( 0.7925, 0.500),
                DrawLib::FPPoint( 0.7250, 0.505));



        // Define the outer back 'document', clockwise:
        curpath = CreatePath(1.0, false, true, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-0.7250,-0.825));
        curpath->LineTo(
                DrawLib::FPPoint(-0.7250,-1    ));
        curpath->LineTo(
                DrawLib::FPPoint( 1     ,-1    ));
        curpath->LineTo(
                DrawLib::FPPoint( 1     , 0.325));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.95  , 0.325),
                DrawLib::FPPoint( 0.95  , 0.325),
                DrawLib::FPPoint( 0.8625, 0.330));
        curpath->LineTo(
                DrawLib::FPPoint( 0.8625,-0.825));
        curpath->ClosePath();

        // ... and its outline:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(
                DrawLib::FPPoint(-0.7250,-0.825));
        curpath->LineTo(
                DrawLib::FPPoint(-0.7250,-1    ));
        curpath->LineTo(
                DrawLib::FPPoint( 1     ,-1    ));
        curpath->LineTo(
                DrawLib::FPPoint( 1     , 0.325));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.95  , 0.325),
                DrawLib::FPPoint( 0.95  , 0.325),
                DrawLib::FPPoint( 0.8625, 0.330));
}


// *** FlowChartTerminator shape (st116). ***

FlowChartTerminatorShape::FlowChartTerminatorShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartTerminatorShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.9,0.7, 0.9,0.7);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint( 0.7,-1)); // Left top top
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1  ,-1),
                DrawLib::FPPoint( 1  , 0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1  , 1),
                DrawLib::FPPoint( 0.7, 1));
        curpath->LineTo(
                DrawLib::FPPoint(-0.7, 1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1  , 1),
                DrawLib::FPPoint(-1  , 0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1  ,-1),
                DrawLib::FPPoint(-0.7,-1));
        curpath->ClosePath();
}


// *** FlowChartPreparation shape (st117). ***

FlowChartPreparationShape::FlowChartPreparationShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartPreparationShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.6,1, 0.6,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-0.6, -1)); // Left
        curpath->LineTo(DrawLib::FPPoint( 0.6, -1));
        curpath->LineTo(DrawLib::FPPoint( 1  ,  0));
        curpath->LineTo(DrawLib::FPPoint( 0.6,  1));
        curpath->LineTo(DrawLib::FPPoint(-0.6,  1));
        curpath->LineTo(DrawLib::FPPoint(-1  ,  0));
        curpath->ClosePath();
}


// *** FlowChartManualInput shape (st118). ***

FlowChartManualInputShape::FlowChartManualInputShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartManualInputShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,0.6, 1,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, -0.6)); // Left top top
        curpath->LineTo(DrawLib::FPPoint( 1, -1  ));
        curpath->LineTo(DrawLib::FPPoint( 1,  1  ));
        curpath->LineTo(DrawLib::FPPoint(-1,  1  ));
        curpath->ClosePath();
}


// *** FlowChartManualOperation shape (st119). ***

FlowChartManualOperationShape::FlowChartManualOperationShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartManualOperationShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.6,1, 0.6,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1  ,-1  )); // Left top top
        curpath->LineTo(DrawLib::FPPoint( 1  ,-1  ));
        curpath->LineTo(DrawLib::FPPoint( 0.6, 1  ));
        curpath->LineTo(DrawLib::FPPoint(-0.6, 1  ));
        curpath->ClosePath();
}


// *** FlowChartPunchedCard shape (st121). ***

FlowChartPunchedCardShape::FlowChartPunchedCardShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartPunchedCardShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,0.6,  1,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-0.6,-1  )); // Left top top
        curpath->LineTo(DrawLib::FPPoint( 1  ,-1  ));
        curpath->LineTo(DrawLib::FPPoint( 1  , 1  ));
        curpath->LineTo(DrawLib::FPPoint(-1  , 1  ));
        curpath->LineTo(DrawLib::FPPoint(-1  ,-0.6));
        curpath->ClosePath();
}


// *** FlowChartPunchedTape shape (st122). ***

FlowChartPunchedTapeShape::FlowChartPunchedTapeShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartPunchedTapeShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,0.6,  1,0.6);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1  ,-0.8)); // Left top

        // Left top curve:
        curpath->BezierTo(
                DrawLib::FPPoint(-0.9,-0.6),
                DrawLib::FPPoint(-0.6,-0.6),
                DrawLib::FPPoint(-0.5,-0.6));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.4,-0.6),
                DrawLib::FPPoint(-0.1,-0.6),
                DrawLib::FPPoint( 0.0,-0.8));

        // Right top curve:
        curpath->BezierTo(
                DrawLib::FPPoint( 0.1,-1.0),
                DrawLib::FPPoint( 0.5,-1.0),
                DrawLib::FPPoint( 0.5,-1.0));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.6,-1.0),
                DrawLib::FPPoint( 0.9,-1.0),
                DrawLib::FPPoint( 1.0,-0.8));

        curpath->LineTo(
                DrawLib::FPPoint( 1  , 0.8));

        // Right bottom curve:
        curpath->BezierTo(
                DrawLib::FPPoint( 0.9, 0.6),
                DrawLib::FPPoint( 0.5, 0.6),
                DrawLib::FPPoint( 0.5, 0.6));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.4, 0.6),
                DrawLib::FPPoint( 0.1, 0.6),
                DrawLib::FPPoint( 0.0, 0.8));

        // Left bottom curve:
        curpath->BezierTo(
                DrawLib::FPPoint(-0.1, 1.0),
                DrawLib::FPPoint(-0.4, 1.0),
                DrawLib::FPPoint(-0.5, 1.0));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.6, 1.0),
                DrawLib::FPPoint(-0.9, 1.0),
                DrawLib::FPPoint(-1.0, 0.8));

        curpath->ClosePath();
}


// *** FlowChartSummingJunction shape (st123). ***

FlowChartSummingJunctionShape::FlowChartSummingJunctionShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartSummingJunctionShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.7,0.7, 0.7,0.7);

        // Define the main ellipse:
        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize( 1,1));

        // Define the two line through the middle:
        float z = 0.707; // ~= sqrt(2)/2.0

        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-z,-z));
        curpath->LineTo(DrawLib::FPPoint( z, z));

        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-z, z));
        curpath->LineTo(DrawLib::FPPoint( z,-z));
}


// *** FlowChartOr shape (st124). ***

FlowChartOrShape::FlowChartOrShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartOrShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.7,0.7, 0.7,0.7);

        // Define the main ellipse:
        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize( 1,1));

        // Define the two line through the middle:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint( 1, 0));
        curpath->LineTo(DrawLib::FPPoint(-1, 0));

        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint( 0, 1));
        curpath->LineTo(DrawLib::FPPoint( 0,-1));
}


// *** FlowChartCollate shape (st125). ***

FlowChartCollateShape::FlowChartCollateShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartCollateShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.5,0.5,  0.5,0.5);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1,-1)); // Left top
        curpath->LineTo(DrawLib::FPPoint( 1,-1));
        curpath->LineTo(DrawLib::FPPoint(-1, 1));
        curpath->LineTo(DrawLib::FPPoint( 1, 1));
        curpath->ClosePath();
}


// *** Pentagon shape (st126). ***

FlowChartSortShape::FlowChartSortShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartSortShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.5,0.5,  0.5,0.5);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0,-1)); // Left top
        curpath->LineTo(DrawLib::FPPoint( 1, 0));
        curpath->LineTo(DrawLib::FPPoint( 0, 1));
        curpath->LineTo(DrawLib::FPPoint(-1, 0));
        curpath->ClosePath();

        // Define the horizontal line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-1, 0)); // Left
        curpath->LineTo(DrawLib::FPPoint( 1, 0)); // Right
}


// *** FlowChartExtract shape (st127). ***

FlowChartExtractShape::FlowChartExtractShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartExtractShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.5,0,  0.5,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0,-1)); // Top
        curpath->LineTo(DrawLib::FPPoint( 1, 1));
        curpath->LineTo(DrawLib::FPPoint(-1, 1));
        curpath->ClosePath();

}


// *** FlowChartMerge shape (st128). ***

FlowChartMergeShape::FlowChartMergeShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartMergeShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.5,1,  0.5,0);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, -1)); // Left top
        curpath->LineTo(DrawLib::FPPoint( 1, -1));
        curpath->LineTo(DrawLib::FPPoint( 0,  1));
        curpath->ClosePath();
}


// *** FlowChartOnlineStorage shape (st130). ***

FlowChartOnlineStorageShape::FlowChartOnlineStorageShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartOnlineStorageShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.65,1,  0.65,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 1, -1)); // Right top
        curpath->BezierTo(
                DrawLib::FPPoint( 0.65,-0.8),
                DrawLib::FPPoint( 0.65,-0.2),
                DrawLib::FPPoint( 0.65, 0  ));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.65, 0.2),
                DrawLib::FPPoint( 0.65, 0.8),
                DrawLib::FPPoint( 1   , 1  ));

        curpath->LineTo(DrawLib::FPPoint(-0.65, 1));

        curpath->BezierTo(
                DrawLib::FPPoint(-1.0, 0.8),
                DrawLib::FPPoint(-1.0, 0.2),
                DrawLib::FPPoint(-1.0, 0  ));
        curpath->BezierTo(
                DrawLib::FPPoint(-1.0 ,-0.2),
                DrawLib::FPPoint(-1.0 ,-0.8),
                DrawLib::FPPoint(-0.65,-1  ));
        curpath->ClosePath();
}


// *** FlowChartMagneticTape shape (st131). ***

FlowChartMagneticTapeShape::FlowChartMagneticTapeShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartMagneticTapeShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.7,0.7,  0.7,0.7);

        curpath->MoveTo(DrawLib::FPPoint(0,-1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1),
                DrawLib::FPPoint( 1, 0));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, 0.4),
                DrawLib::FPPoint( 0.725,0.7));
        curpath->LineTo(DrawLib::FPPoint(0.95,0.7));
        curpath->LineTo(DrawLib::FPPoint(0.95,1.0));
        curpath->LineTo(DrawLib::FPPoint(0,1));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1, 1),
                DrawLib::FPPoint(-1, 0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-1),
                DrawLib::FPPoint( 0,-1));
        curpath->ClosePath();
}


// *** FlowChartMagneticDisk shape (st132). ***

FlowChartMagneticDiskShape::FlowChartMagneticDiskShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter) {}

void FlowChartMagneticDiskShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,0.4,  1,0.7);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1, -0.7)); // Left top left

        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-1  ),
                DrawLib::FPPoint( 0,-1  ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1  ),
                DrawLib::FPPoint( 1,-0.7));

        curpath->LineTo(
                DrawLib::FPPoint( 1, 0.7));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, 1  ),
                DrawLib::FPPoint( 0, 1  ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1, 1  ),
                DrawLib::FPPoint(-1, 0.7));

        curpath->ClosePath();


        // Define the inner line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(-1, -0.7)); // Left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-0.4),
                DrawLib::FPPoint( 0,-0.4));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-0.4),
                DrawLib::FPPoint( 1,-0.7));
}


// *** FlowChartMagneticDrum shape (st133). ***

FlowChartMagneticDrumShape::FlowChartMagneticDrumShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartMagneticDrumShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.65,1,  0.35,1);

        // Define the main path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(0.675, -1)); // Right top top

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1),
                DrawLib::FPPoint( 1, 0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, 1),
                DrawLib::FPPoint( 0.675,1));

        curpath->LineTo(DrawLib::FPPoint(-0.675, 1));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1, 1),
                DrawLib::FPPoint(-1,0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1,-1),
                DrawLib::FPPoint(-0.675,-1));

        curpath->ClosePath();


        // Define the inner line:
        curpath = CreatePath(1.0, true, false, false);
        curpath->MoveTo(DrawLib::FPPoint(0.675, -1)); // Left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.35 ,-1),
                DrawLib::FPPoint( 0.35 , 0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.35 , 1),
                DrawLib::FPPoint( 0.675, 1));
}


// *** FlowChartDisplay shape (st134). ***

FlowChartDisplayShape::FlowChartDisplayShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartDisplayShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 0.67,1,  0.66,1);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-0.67,-1   )); // Left top
        curpath->LineTo(
                DrawLib::FPPoint( 0.66,-1   ));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.82,-0.94),
                DrawLib::FPPoint( 0.89,-0.72));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.97,-0.40),
                DrawLib::FPPoint( 1.00, 0   ));

        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.97, 0.40),
                DrawLib::FPPoint( 0.89, 0.72));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.82, 0.94),
                DrawLib::FPPoint( 0.66, 1   ));


        curpath->LineTo(
                DrawLib::FPPoint(-0.67, 1   ));

        curpath->LineTo(
                DrawLib::FPPoint(-1   , 0   ));
        curpath->ClosePath();
}


// *** FlowChartDelay shape (st135). ***

FlowChartDelayShape::FlowChartDelayShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{}

void FlowChartDelayShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,0.7,  0.7,0.7);

        // Define the main path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1,-1)); // Left top
        curpath->LineTo(
                DrawLib::FPPoint( 0,-1));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1,-1),
                DrawLib::FPPoint( 1, 0));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1, 1),
                DrawLib::FPPoint( 0, 1));
        curpath->LineTo(
                DrawLib::FPPoint(-1, 1));
        curpath->ClosePath();
}


// *** FlowChartAlternateProcess shape (st176). ***

FlowChartAlternateProcessShape::FlowChartAlternateProcessShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{
}

void FlowChartAlternateProcessShape::SetupPaths(float aspect_ratio)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adj_x = 0.75;
        float adj_y = 0.75;

        if(aspect_ratio < 1.0) // Portrait:
                adj_y = 1.0 - 0.25 * aspect_ratio;
        else // Landscape:
                adj_x = 1.0 - 0.25 / aspect_ratio ;

        float text_size_x = 1.0 - (1.0 - adj_x)*0.3;
        float text_size_y = 1.0 - (1.0 - adj_y)*0.3;

        text_part.SetupTextBox(
                 text_size_x,text_size_y,  text_size_x,text_size_y);

        // Define the path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1         ,-adj_y)); // Upper left left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1         ,-1         ),
                DrawLib::FPPoint(-adj_x,-1         ));

        curpath->LineTo(
                DrawLib::FPPoint( adj_x,-1         ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1         ,-1         ),
                DrawLib::FPPoint( 1         ,-adj_y));

        curpath->LineTo(
                DrawLib::FPPoint( 1         , adj_y));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 1         , 1         ),
                DrawLib::FPPoint( adj_x, 1         ));

        curpath->LineTo(
                DrawLib::FPPoint(-adj_x, 1         ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1         , 1         ),
                DrawLib::FPPoint(-1         , adj_y));

        curpath->ClosePath();
}


// *** FlowChartAlternateProcess shape (st177). ***

FlowChartOffpageConnectorShape::FlowChartOffpageConnectorShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
{
}

void FlowChartOffpageConnectorShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                 1,1, 1,0.6);

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint(-1,-1  )); // Top left
        curpath->LineTo(DrawLib::FPPoint( 1,-1  ));
        curpath->LineTo(DrawLib::FPPoint( 1, 0.6));
        curpath->LineTo(DrawLib::FPPoint( 0, 1  ));
        curpath->LineTo(DrawLib::FPPoint(-1, 0.6));
        curpath->ClosePath();
}


// *** LeftRightUpArrow shape (st182). ***

LeftRightUpArrowShape::LeftRightUpArrowShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust_x2 = geometry_part.GetAdjustX_Value(0, -0.4);
        adjust_x  = geometry_part.GetAdjustX_ValueMinMax(1, -0.2,      -1.0,0.0);
        adjust_y  = geometry_part.GetAdjustY_Value(2, -0.4);
}

void LeftRightUpArrowShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        // Middle height of horizontal bar:
        float adjust_y2 = f(0);
        // Relative distance between adjust_y and adjust_y2 in [0, 1]:
        adjust_y2 = (1+adjust_y) / (1 + adjust_y2);
        // Translated to [-1, 0]:
        adjust_y2 = -(1 - adjust_y2);


        float text_x;
        if(adjust_x2 < 0)
                text_x = 1 - (1 - -adjust_y2) * (adjust_x/adjust_x2);
        else
                text_x = 0;

        text_part.SetupTextBox(
                 text_x,-f( adjust_x),  text_x,f(-adjust_x));

        // Define the path clockwise:
        curpath->MoveTo(DrawLib::FPPoint( 0,-1)); // Top point
        curpath->LineTo(DrawLib::FPPoint(-adjust_x2,   adjust_y  ));
        curpath->LineTo(DrawLib::FPPoint(-adjust_x ,   adjust_y  ));

        curpath->LineTo(DrawLib::FPPoint(-adjust_x ,f( adjust_x ))); // Inner corner

        curpath->LineTo(DrawLib::FPPoint(-adjust_y2,f( adjust_x )));
        curpath->LineTo(DrawLib::FPPoint(-adjust_y2,f( adjust_x2)));
        curpath->LineTo(DrawLib::FPPoint( 1        ,f( 0        ))); // Right
        curpath->LineTo(DrawLib::FPPoint(-adjust_y2,f(-adjust_x2)));
        curpath->LineTo(DrawLib::FPPoint(-adjust_y2,f(-adjust_x )));

        curpath->LineTo(DrawLib::FPPoint( adjust_y2,f(-adjust_x )));
        curpath->LineTo(DrawLib::FPPoint( adjust_y2,f(-adjust_x2)));
        curpath->LineTo(DrawLib::FPPoint(-1        ,f( 0        ))); // Left
        curpath->LineTo(DrawLib::FPPoint( adjust_y2,f( adjust_x2)));
        curpath->LineTo(DrawLib::FPPoint( adjust_y2,f( adjust_x )));

        curpath->LineTo(DrawLib::FPPoint( adjust_x ,f( adjust_x ))); // Inner corner

        curpath->LineTo(DrawLib::FPPoint( adjust_x ,   adjust_y  ));
        curpath->LineTo(DrawLib::FPPoint( adjust_x2,   adjust_y  ));

        curpath->ClosePath();
}

float LeftRightUpArrowShape::f(float y) const
{
        return (y+1)*2/(1-adjust_x2) - 1;
}


// *** Sun shape (st183). ***

SunShape::SunShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0,-0.5,     -0.751, 0.0626);
}

void SunShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float text_size = -0.7*adjust;

        text_part.SetupTextBox(
                text_size,text_size,  text_size,text_size);

        // Define the main ellipse:
        curpath->Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize( -adjust, -adjust));


        // Define the eight triangles around it:
        DrawLib::XForm2D rotation;
        float bottom = 0.7666 - (0.75+adjust)*0.675;
        float width  = 0.3*-adjust;

        for(unsigned i=0; i<8; ++i)
        {
                float angle = 2.0*M_PI*(i/8.0);

                rotation = DrawLib::XForm2D(angle, DrawLib::FPPoint(1,1), DrawLib::FPPoint(0,0));

                curpath = CreatePath(1.0, true, true, false);
                curpath->MoveTo(DrawLib::FPPoint(DrawLib::FPPoint(1     , 0    ) * rotation));
                curpath->LineTo(DrawLib::FPPoint(DrawLib::FPPoint(bottom, width) * rotation));
                curpath->LineTo(DrawLib::FPPoint(DrawLib::FPPoint(bottom,-width) * rotation));
                curpath->ClosePath();
        }
}

// *** Moon shape (st184). ***

MoonShape::MoonShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, 0.0,           -1.0, 0.751);
}

void MoonShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        //ADDME: MS Escher seems to act just a little bit different than this:
        float text_left = 1.0 - ((adjust+1.0)/1.75)/2.0;

        float text_y;
        if(text_left < 1.0)
                text_y = 0.97*sqrt(1.0 - text_left);
        else
                text_y = 0.0;

        text_part.SetupTextBox(
                text_left,text_y,  adjust,text_y);

        // Define the path clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1     , 0   )); // left
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1     ,-1   ),
                DrawLib::FPPoint( 1     ,-1   ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust,-0.75),
                DrawLib::FPPoint( adjust, 0   ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( adjust, 0.75),
                DrawLib::FPPoint( 1     , 1   ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-1     , 1   ),
                DrawLib::FPPoint(-1     , 0   ));
        curpath->ClosePath();
}


//////////////////////////////////////////////////////////
// Implementation AbstractDoubleBraceShape class:

// Common abstract shape, baseclass of all shapes which are
// a compiosition of two braces.

AbstractDoubleBraceShape::AbstractDoubleBraceShape(
        ShapeContainer const &shape_container,
        bool shade_shape_to_outline,
        float default_adjust)
: MultiPathShape(shape_container, shade_shape_to_outline,
        DrawLib::OutlineEndcapModes::Rounded, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
        adjust.x = geometry_part.GetAdjustX_Value(0, default_adjust);
        adjust.y = geometry_part.GetAdjustY_Value(0, default_adjust);
}

void AbstractDoubleBraceShape::SetupPaths(float aspect_ratio)
{
        float adj_x, adj_y;

        if(aspect_ratio < 1.0)
        { // Portrait:
                if(adjust.x < -1.0 || adjust.x > 0.0)
                        throw std::runtime_error("sanity: Adjust value out of bounds on X-axis.");

                adj_x = -adjust.x;
                adj_y = 1.0 - (1.0 + adjust.x) * aspect_ratio;
        }
        else
        { // Landscape:
                if(adjust.y < -1.0 || adjust.y > 0.0)
                        throw std::runtime_error("sanity: Adjust value out of bounds on Y-axis.");

                adj_x = 1.0 - (1.0 + adjust.y) / aspect_ratio;
                adj_y = -adjust.y;
        }

        SetupTextBox(adj_x, adj_y);

        // Define the main path, out of the left and right brace:
        DrawLib::Path *fillpath = CreatePath(1.0, /*stroke=*/false, /*fill=*/true, /*own_bitmap=*/false);
        SetupLeft (adj_x, adj_y, fillpath, false);
        SetupRight(adj_x, adj_y, fillpath, true);// true = Adding to existing path
        fillpath->ClosePath();

        //Define the left brace, as standalone path:
        DrawLib::Path *left = CreatePath(1.0, true, false, false);
        SetupLeft (adj_x, adj_y, left, false);

        //Define the right brace, as standalone path:
        DrawLib::Path *right= CreatePath(1.0, true, false, false);
        SetupRight(adj_x, adj_y, right, false);
}

// End implementation AbstractDoubleBraceShape

// *** BracketPair shape (st185). ***

BracketPairShape::BracketPairShape(ShapeContainer const &shape_container)
: AbstractDoubleBraceShape(shape_container, true, -0.7)
{
}

void BracketPairShape::SetupTextBox(float p_adjust_x, float p_adjust_y)
{
        float x2 = 1 - 0.3*(1 - p_adjust_x);
        float y2 = 1 - 0.3*(1 - p_adjust_y);

        text_part.SetupTextBox(x2,y2, x2,y2);
}

void BracketPairShape::SetupLeft(float p_adjust_x, float p_adjust_y, DrawLib::Path* path, bool adding)
{
        if(adding) path->LineTo(
                DrawLib::FPPoint(-p_adjust_x,-1         ));
        else       path->MoveTo(
                DrawLib::FPPoint(-p_adjust_x,-1         ));
        PathCornerArcTo(path,
                DrawLib::FPPoint(-1         ,-1         ),
                DrawLib::FPPoint(-1         ,-p_adjust_y));
        path->LineTo(
                DrawLib::FPPoint(-1         , p_adjust_y));
        PathCornerArcTo(path,
                DrawLib::FPPoint(-1         , 1         ),
                DrawLib::FPPoint(-p_adjust_x, 1         ));
}

void BracketPairShape::SetupRight (float p_adjust_x, float p_adjust_y, DrawLib::Path* path, bool adding)
{
        if(adding) path->LineTo(
                DrawLib::FPPoint( p_adjust_x, 1         ));
        else       path->MoveTo(
                DrawLib::FPPoint( p_adjust_x, 1         ));
        PathCornerArcTo(path,
                DrawLib::FPPoint( 1         , 1         ),
                DrawLib::FPPoint( 1         , p_adjust_y));
        path->LineTo(
                DrawLib::FPPoint( 1         ,-p_adjust_y));
        PathCornerArcTo(path,
                DrawLib::FPPoint( 1         ,-1         ),
                DrawLib::FPPoint( p_adjust_x,-1         ));
}


// *** BracePair shape (st186). ***

BracePairShape::BracePairShape(ShapeContainer const &shape_container)
: AbstractDoubleBraceShape(shape_container, false, -0.85)
{
}

void BracePairShape::SetupTextBox(float p_adjust_x, float p_adjust_y)
{
        float x2 = p_adjust_x - 0.3*(1 - p_adjust_x);
        float y2 = 1          - 0.3*(1 - p_adjust_y);

        text_part.SetupTextBox(x2,y2, x2,y2);
}

void BracePairShape::SetupLeft(float p_adjust_x, float p_adjust_y, DrawLib::Path* path, bool adding)
{
        float a2 = 1.0 - 2.0*(1.0 - p_adjust_x);

        if(adding)
            path->LineTo(
                DrawLib::FPPoint(-a2        ,-1         ));
        else
            path->MoveTo(
                DrawLib::FPPoint(-a2        ,-1         ));
        PathCornerArcTo(path,
                DrawLib::FPPoint(-p_adjust_x,-1         ),
                DrawLib::FPPoint(-p_adjust_x,-p_adjust_y));
        path->LineTo(
                DrawLib::FPPoint(-p_adjust_x,-(1.0-p_adjust_y)));
        PathCornerArcTo(path,
                DrawLib::FPPoint(-p_adjust_x, 0         ),
                DrawLib::FPPoint(-1         , 0         ));
        PathCornerArcTo(path,
                DrawLib::FPPoint(-p_adjust_x, 0         ),
                DrawLib::FPPoint(-p_adjust_x, (1.0-p_adjust_y)));
        path->LineTo(
                DrawLib::FPPoint(-p_adjust_x, p_adjust_y));
        PathCornerArcTo(path,
                DrawLib::FPPoint(-p_adjust_x, 1         ),
                DrawLib::FPPoint(-a2        , 1         ));
}

void BracePairShape::SetupRight (float p_adjust_x, float p_adjust_y, DrawLib::Path* path, bool adding)
{
        float a2 = 1.0 - 2.0*(1.0 - p_adjust_x);

        if(adding)
            path->LineTo(
                DrawLib::FPPoint( a2        , 1         ));
        else
            path->MoveTo(
                DrawLib::FPPoint( a2        , 1         ));
        PathCornerArcTo(path,
                DrawLib::FPPoint( p_adjust_x, 1         ),
                DrawLib::FPPoint( p_adjust_x, p_adjust_y));
        path->LineTo(
                DrawLib::FPPoint( p_adjust_x, (1.0-p_adjust_y)));
        PathCornerArcTo(path,
                DrawLib::FPPoint( p_adjust_x, 0         ),
                DrawLib::FPPoint( 1         , 0         ));
        PathCornerArcTo(path,
                DrawLib::FPPoint( p_adjust_x, 0         ),
                DrawLib::FPPoint( p_adjust_x,-(1.0-p_adjust_y)));
        path->LineTo(
                DrawLib::FPPoint( p_adjust_x,-p_adjust_y));
        PathCornerArcTo(path,
                DrawLib::FPPoint( p_adjust_x,-1         ),
                DrawLib::FPPoint( a2        ,-1         ));
}


// *** Seal 4 shape (st187). ***

Seal4Shape::Seal4Shape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
{
        adjust = geometry_part.GetAdjustX_ValueMinMax(0, -0.25,    -1.0,0.0);

        // Divided by sqrt(2):
        adjust /= 1.414;
}

void Seal4Shape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(
                -adjust,-adjust, -adjust,-adjust);

        // Top:
        curpath->MoveTo(DrawLib::FPPoint(      0,      -1));
        curpath->LineTo(DrawLib::FPPoint(-adjust,  adjust));

        // Right:
        curpath->LineTo(DrawLib::FPPoint(      1,       0));
        curpath->LineTo(DrawLib::FPPoint(-adjust, -adjust));

        // Bottom:
        curpath->LineTo(DrawLib::FPPoint(      0,       1));
        curpath->LineTo(DrawLib::FPPoint( adjust, -adjust));

        // Left:
        curpath->LineTo(DrawLib::FPPoint(     -1,       0));
        curpath->LineTo(DrawLib::FPPoint( adjust,  adjust));

        curpath->ClosePath();
}


// *** DoubleWave shape (st188). ***

DoubleWaveShape::DoubleWaveShape(ShapeContainer const &shape_container)
: MultiPathShape(shape_container, false, DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded)
, geometry_part(shape_container.GetProperties())
{
        adjust.x = geometry_part.GetAdjustY_ValueMinMax(1, 0.000,    -0.5, 0.5);
        adjust.y = geometry_part.GetAdjustX_ValueMinMax(0,-0.875,    -1.0,-0.5);
}

void DoubleWaveShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        float adjust_y2 = -(1 - 2*(1 - -adjust.y));

        float dx1_1 = 0, dx1_2 = 0, dx2_1 = 0, dx2_2 = 0;
        float text_x = 1;
        if(adjust.x > 0)
        {
                dx1_1 =  adjust.x;
                dx2_2 = -adjust.x;
                text_x -= 2* adjust.x;
        }
        else
        {
                dx1_2 =  adjust.x;
                dx2_1 = -adjust.x;
                text_x -= 2*-adjust.x;
        }


        text_part.SetupTextBox(
                text_x,-adjust_y2,    text_x,-adjust_y2);


        // Define the main polygon clockwise:
        curpath->MoveTo(
                DrawLib::FPPoint(-1.00 + 2.0*dx1_1 + 0.0*dx1_2, -adjust.y )); // Left bottom
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-0.90 + 1.5*dx1_1 + 0.5*dx1_2, -adjust_y2),
                DrawLib::FPPoint(-0.75 + 1.5*dx1_1 + 0.5*dx1_2, -adjust_y2));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.60 + 1.5*dx1_1 + 0.5*dx1_2, -adjust_y2),
                DrawLib::FPPoint(-0.40 + 1.0*dx1_1 + 1.0*dx1_2,  1        ),
                DrawLib::FPPoint(-0.20 + 1.0*dx1_1 + 1.0*dx1_2,  1        ));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.05 + 1.0*dx1_1 + 1.0*dx1_2,  1        ),
                DrawLib::FPPoint( 0.05 + 1.0*dx1_1 + 1.0*dx1_2, -adjust_y2),
                DrawLib::FPPoint( 0.20 + 1.0*dx1_1 + 1.0*dx1_2, -adjust_y2));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.40 + 0.5*dx1_1 + 1.5*dx1_2, -adjust_y2),
                DrawLib::FPPoint( 0.60 + 0.5*dx1_1 + 1.5*dx1_2,  1        ),
                DrawLib::FPPoint( 0.75 + 0.5*dx1_1 + 1.5*dx1_2,  1        ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.90 + 0.0*dx1_1 + 2.0*dx1_2,  1        ),
                DrawLib::FPPoint( 1.00 + 0.0*dx1_1 + 2.0*dx1_2, -adjust.y ));



        curpath->LineTo(
                DrawLib::FPPoint( 1.00 + 0.0*dx2_1 + 2.0*dx2_2,  adjust.y )); // Right top
        PathCornerArcTo(curpath,
                DrawLib::FPPoint( 0.90 + 0.5*dx2_1 + 1.5*dx2_2,  adjust_y2),
                DrawLib::FPPoint( 0.75 + 0.5*dx2_1 + 1.5*dx2_2,  adjust_y2));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.60 + 0.5*dx2_1 + 1.5*dx2_2,  adjust_y2),
                DrawLib::FPPoint( 0.40 + 1.0*dx2_1 + 1.0*dx2_2, -1        ),
                DrawLib::FPPoint( 0.20 + 1.0*dx2_1 + 1.0*dx2_2, -1        ));
        curpath->BezierTo(
                DrawLib::FPPoint( 0.05 + 1.0*dx2_1 + 1.0*dx2_2, -1        ),
                DrawLib::FPPoint(-0.05 + 1.0*dx2_1 + 1.0*dx2_2,  adjust_y2),
                DrawLib::FPPoint(-0.20 + 1.0*dx2_1 + 1.0*dx2_2,  adjust_y2));
        curpath->BezierTo(
                DrawLib::FPPoint(-0.40 + 1.5*dx2_1 + 0.5*dx2_2,  adjust_y2),
                DrawLib::FPPoint(-0.60 + 1.5*dx2_1 + 0.5*dx2_2, -1        ),
                DrawLib::FPPoint(-0.75 + 1.5*dx2_1 + 0.5*dx2_2, -1        ));
        PathCornerArcTo(curpath,
                DrawLib::FPPoint(-0.90 + 2.0*dx2_1 + 0.0*dx2_2, -1        ),
                DrawLib::FPPoint(-1.00 + 2.0*dx2_1 + 0.0*dx2_2,  adjust.y ));

        curpath->ClosePath();
}



/////////////////////////////////////////////////////
////// Implementation AbstractStarShape /////////////

SealShape::SealShape(
        ShapeContainer const &shape_container,
        int _num_points)
: MultiPathShape(shape_container, true, DrawLib::OutlineEndcapModes::Flat,
        DrawLib::OutlineJoinModes::Miter)
, geometry_part(shape_container.GetProperties())
, num_points(_num_points)
{
        adjust_x = geometry_part.GetAdjustX_Value(0, -0.764);
}

void SealShape::SetupPaths(float)
{
        DrawLib::Path *curpath = CreatePath(1.0, /*stroke=*/true, /*fill=*/true, /*own_bitmap=*/false);

        text_part.SetupTextBox(-adjust_x * 0.7,-adjust_x * 0.7,   -adjust_x * 0.7,-adjust_x * 0.7);

        float angle;
        for(int i=0; i<num_points; ++i)
        {
                angle = i*2*M_PI/num_points;
                if(i)
                        curpath->LineTo(DrawLib::FPPoint(sin(angle), cos(angle)));
                else
                        curpath->MoveTo(DrawLib::FPPoint(sin(angle), cos(angle)));

                angle += M_PI/num_points;
                curpath->LineTo(DrawLib::FPPoint(-adjust_x * sin(angle), -adjust_x * cos(angle)));
        }
        curpath->ClosePath();
}
// End implementation AbstractStarShape


} //end namespace Escher
} //end namespace Office
} //end namespace Parsers
