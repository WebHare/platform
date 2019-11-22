#include <ap/libwebhare/allincludes.h>


#include "shapes.h"
#include "escher.h"

namespace Parsers {
namespace Office {
namespace Escher {

void PathCornerArcTo(
        DrawLib::Path *path,
        DrawLib::FPPoint corner_point,
        DrawLib::FPPoint relative_point)
{
        DrawLib::FPPoint last_path_point = path->GetLastPoint();

        //ADDME  2.25 is just an estimate, is it necessary and can
        // DrawLib's arc perhaps implement this cleaner?
        DrawLib::FPPoint vector1(
                corner_point.x + (last_path_point.x - corner_point.x) / 2.25,
                corner_point.y + (last_path_point.y - corner_point.y) / 2.25);

        DrawLib::FPPoint vector2(
                corner_point.x + (relative_point.x - corner_point.x) / 2.25,
                corner_point.y + (relative_point.y - corner_point.y) / 2.25);

        path->BezierTo(
                vector1, vector2,
                relative_point);

}

// *** The escher shape base class. ***

EscherShape *EscherShape::ShapeFactory(ShapeContainer const &shape_container)
{
        switch(shape_container.GetType())
        {
                case   0: return new FreeFormShape                         (shape_container);
                case   1: return new RectangleShape                        (shape_container);
                case   2: return new RoundRectangleShape                   (shape_container);
                case   3: return new EllipseShape                          (shape_container);
                case   4: return new DiamondShape                          (shape_container);
                case   5: return new IsocelesTriangleShape                 (shape_container);
                case   6: return new RightTriangleShape                    (shape_container);
                case   7: return new ParallelogramShape                    (shape_container);
                case   8: return new TrapezoidShape                        (shape_container);
                case   9: return new HexagonShape                          (shape_container);
                case  10: return new OctagonShape                          (shape_container);
                case  11: return new PlusShape                             (shape_container);
                case  12: return new StarShape                             (shape_container);
                case  13: return new ArrowShape                            (shape_container, ArrowShape::RIGHT);

                case  15: return new HomePlateShape                        (shape_container);
                case  16: return new CubeShape                             (shape_container);

                case  19: return new ArcShape                              (shape_container);
                case  20: return new ConnectorShape(shape_container, ConnectorShape::ONE); // Line
                case  21: return new PlaqueShape                           (shape_container);
                case  22: return new CanShape                              (shape_container);
                case  23: return new DonutShape                            (shape_container);

                case  32: return new ConnectorShape(shape_container, ConnectorShape::ONE  );// StraightConnector1
                case  33: return new ConnectorShape(shape_container, ConnectorShape::TWO  );// BentConnector2
                case  34: return new ConnectorShape(shape_container, ConnectorShape::THREE);// BentConnector3
                case  35: return new ConnectorShape(shape_container, ConnectorShape::FOUR );// BentConnector4
                case  36: return new ConnectorShape(shape_container, ConnectorShape::FIVE );// BentConnector5
                case  37: return new ConnectorShape(shape_container, ConnectorShape::TWO  );// CurvedConnector2
                case  38: return new ConnectorShape(shape_container, ConnectorShape::THREE);// CurvedConnector3
                case  39: return new ConnectorShape(shape_container, ConnectorShape::FOUR );// CurvedConnector4
                case  40: return new ConnectorShape(shape_container, ConnectorShape::FIVE );// CurvedConnector5

                case  41: return new SimpleCalloutShape(SimpleCalloutShape::TWO_POINTS  , false, false, shape_container);/* Callout1 */
                case  42: return new SimpleCalloutShape(SimpleCalloutShape::THREE_POINTS, false, false, shape_container);/* Callout2 */
                case  43: return new SimpleCalloutShape(SimpleCalloutShape::FOUR_POINTS , false, false, shape_container);/* Callout3 */
                case  44: return new SimpleCalloutShape(SimpleCalloutShape::TWO_POINTS  , false, true , shape_container);/* AccentCallout1 */
                case  45: return new SimpleCalloutShape(SimpleCalloutShape::THREE_POINTS, false, true , shape_container);/* AccentCallout2 */
                case  46: return new SimpleCalloutShape(SimpleCalloutShape::FOUR_POINTS , false, true , shape_container);/* AccentCallout3 */
                case  47: return new SimpleCalloutShape(SimpleCalloutShape::TWO_POINTS  , true , false, shape_container);/* BorderCallout1 */
                case  48: return new SimpleCalloutShape(SimpleCalloutShape::THREE_POINTS, true , false, shape_container);/* BorderCallout2 */
                case  49: return new SimpleCalloutShape(SimpleCalloutShape::FOUR_POINTS , true , false, shape_container);/* BorderCallout3 */
                case  50: return new SimpleCalloutShape(SimpleCalloutShape::TWO_POINTS  , true , true , shape_container);/* AccentBorderCallout1 */
                case  51: return new SimpleCalloutShape(SimpleCalloutShape::THREE_POINTS, true , true , shape_container);/* AccentBorderCallout2 */
                case  52: return new SimpleCalloutShape(SimpleCalloutShape::FOUR_POINTS , true , true , shape_container);/* AccentBorderCallout3 */
                case  53: return new RibbonShape                           (shape_container, false/* not upside down*/);
                case  54: return new RibbonShape                           (shape_container, true /*     upside down*/);
                case  55: return new ChevronShape                          (shape_container);
                case  56: return new PentagonShape                         (shape_container);
                case  57: return new NoSmokingShape                        (shape_container);
                case  58: return new SealShape                             (shape_container,  8);
                case  59: return new SealShape                             (shape_container, 16);
                case  60: return new SealShape                             (shape_container, 32);
                case  61: return new WedgeRectCalloutShape                 (shape_container);
                case  62: return new WedgeRRectCalloutShape                (shape_container);
                case  63: return new WedgeEllipseCalloutShape              (shape_container);
                case  64: return new WaveShape                             (shape_container);
                case  65: return new FoldedCornerShape                     (shape_container);
                case  66: return new ArrowShape                            (shape_container, ArrowShape::LEFT);
                case  67: return new ArrowShape                            (shape_container, ArrowShape::DOWN);
                case  68: return new ArrowShape                            (shape_container, ArrowShape::UP);
                case  69: return new DoubleArrowShape                      (shape_container, DoubleArrowShape::LEFTRIGHT);
                case  70: return new DoubleArrowShape                      (shape_container, DoubleArrowShape::UPDOWN);
                case  71: return new IrregularSeal1Shape                   (shape_container);
                case  72: return new IrregularSeal2Shape                   (shape_container);
                case  73: return new LightningBoltShape                    (shape_container);
                case  74: return new HeartShape                            (shape_container);
                case  75: return new PictureFrameShape                     (shape_container);
                case  76: return new QuadArrowShape                        (shape_container);
                case  77: return new ArrowCalloutShape                     (shape_container, ArrowCalloutShape::LEFT);
                case  78: return new ArrowCalloutShape                     (shape_container, ArrowCalloutShape::RIGHT);
                case  79: return new ArrowCalloutShape                     (shape_container, ArrowCalloutShape::UP);
                case  80: return new ArrowCalloutShape                     (shape_container, ArrowCalloutShape::DOWN);
                case  81: return new DoubleArrowCalloutShape               (shape_container, DoubleArrowCalloutShape::LEFTRIGHT);
                case  82: return new DoubleArrowCalloutShape               (shape_container, DoubleArrowCalloutShape::UPDOWN);
                case  83: return new QuadArrowCalloutShape                 (shape_container);
                case  84: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::NO_BUTTON);//BevelShape
                case  85: return new BracketShape                          (shape_container, false/*left*/);
                case  86: return new BracketShape                          (shape_container, true/*right*/);
                case  87: return new BraceShape                            (shape_container, false/*left*/);
                case  88: return new BraceShape                            (shape_container, true/*right*/);
                case  89: return new LeftUpArrowShape                      (shape_container);
                case  90: return new BentUpArrowShape                      (shape_container);
                case  91: return new BentArrowShape                        (shape_container);
                case  92: return new SealShape                             (shape_container, 24);
                case  93: return new StripedRightArrowShape                (shape_container);
                case  94: return new NotchedRightArrowShape                (shape_container);
                case  95: return new BlockArcShape                         (shape_container);
                case  96: return new SmileyFaceShape                       (shape_container);
                case  97: return new VerticalScrollShape                   (shape_container);
                case  98: return new HorizontalScrollShape                 (shape_container);
                case  99: return new CircularArrowShape                    (shape_container);

                case 101: return new UturnArrowShape                       (shape_container);
                case 102: return new CurvedArrowShape                      (shape_container, CurvedArrowShape::RIGHT);
                case 103: return new CurvedArrowShape                      (shape_container, CurvedArrowShape::LEFT);
                case 104: return new CurvedArrowShape                      (shape_container, CurvedArrowShape::UP);
                case 105: return new CurvedArrowShape                      (shape_container, CurvedArrowShape::DOWN);
                case 106: return new CloudCalloutShape                     (shape_container);
                case 107: return new EllipseRibbonShape                    (shape_container, false/* not upside down*/);
                case 108: return new EllipseRibbonShape                    (shape_container, true /*     upside down*/);

                case 109: return new RectangleShape/*= FlowChartProcesse */(shape_container);
                case 110: return new FlowChartDecisionShape                (shape_container);
                case 111: return new FlowChartInputOutputShape             (shape_container);
                case 112: return new FlowChartPredefinedProcessShape       (shape_container);
                case 113: return new FlowChartInternalStorageShape         (shape_container);
                case 114: return new FlowChartDocumentShape                (shape_container);
                case 115: return new FlowChartMultidocumentShape           (shape_container);
                case 116: return new FlowChartTerminatorShape              (shape_container);
                case 117: return new FlowChartPreparationShape             (shape_container);
                case 118: return new FlowChartManualInputShape             (shape_container);
                case 119: return new FlowChartManualOperationShape         (shape_container);
                case 120: return new EllipseShape/* = FlowChartConnector */(shape_container);
                case 121: return new FlowChartPunchedCardShape             (shape_container);
                case 122: return new FlowChartPunchedTapeShape             (shape_container);
                case 123: return new FlowChartSummingJunctionShape         (shape_container);
                case 124: return new FlowChartOrShape                      (shape_container);
                case 125: return new FlowChartCollateShape                 (shape_container);
                case 126: return new FlowChartSortShape                    (shape_container);
                case 127: return new FlowChartExtractShape                 (shape_container);
                case 128: return new FlowChartMergeShape                   (shape_container);
                case 130: return new FlowChartOnlineStorageShape           (shape_container);
                case 131: return new FlowChartMagneticTapeShape            (shape_container);
                case 132: return new FlowChartMagneticDiskShape            (shape_container);
                case 133: return new FlowChartMagneticDrumShape            (shape_container);
                case 134: return new FlowChartDisplayShape                 (shape_container);
                case 135: return new FlowChartDelayShape                   (shape_container);
                case 176: return new FlowChartAlternateProcessShape        (shape_container);
                case 177: return new FlowChartOffpageConnectorShape        (shape_container);
                case 178: return new SimpleCalloutShape(SimpleCalloutShape::ANGLE_90, false, false, shape_container);/* Callout90 */
                case 179: return new SimpleCalloutShape(SimpleCalloutShape::ANGLE_90, false, false, shape_container);/* AccentCallout90 */
                case 180: return new SimpleCalloutShape(SimpleCalloutShape::ANGLE_90,  true, false, shape_container);/* BorderCallout90 */
                case 181: return new SimpleCalloutShape(SimpleCalloutShape::ANGLE_90,  true, false, shape_container);/* AccentBorderCallout90 */
                case 182: return new LeftRightUpArrowShape                 (shape_container);
                case 183: return new SunShape                              (shape_container);
                case 184: return new MoonShape                             (shape_container);
                case 185: return new BracketPairShape                      (shape_container);
                case 186: return new BracePairShape                        (shape_container);
                case 187: return new Seal4Shape                            (shape_container);
                case 188: return new DoubleWaveShape                       (shape_container);

                case 189: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::BLANK);
                case 190: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::HOME);
                case 191: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::HELP);
                case 192: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::INFO);
                case 193: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::NEXT);
                case 194: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::PREVIOUS);
                case 195: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::END);
                case 196: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::BEGIN);
                case 197: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::RETURN);
                case 198: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::DOC);
                case 199: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::SOUND);
                case 200: return new BevelOrActionbuttonShape(shape_container, BevelOrActionbuttonShape::MOVIE);

                case 202: return new RectangleShape/* = textbox */         (shape_container);
        }
        return NULL;
}

EscherShape::EscherShape()
{
}

// End implementation EscherShape


//////////////////////////////////////////////////////////
// Implementation MultiPathShape class:

MultiPathShape::MultiPathShape(ShapeContainer const &shape_container,
        bool shade_shape_to_outline,
        DrawLib::OutlineEndcapModes::Type _outline_endcap_mode,
        DrawLib::OutlineJoinModes::Type   _outline_join_mode)
: EscherShape()
, outline_endcap_mode(_outline_endcap_mode)
, outline_join_mode  (_outline_join_mode  )
, text_part(shape_container.GetProperties(), shape_container.GetShapeId())
, fill_part(shape_container, shape_container.GetProperties(), shade_shape_to_outline, true)
, line_part(shape_container, shape_container.GetProperties())
{
        text_part.SetLineWidth(line_part.GetLineWidth());
}

DrawLib::FPBoundingBox MultiPathShape::ApplyToCanvas(TransformationState const &pars)
{
        ////////////////////////////////////////
        // Let the subclass setup the path or paths here:
        SetupPaths(Escher::GetAspectRatio(pars.stored_transformation));

        if(paths.empty())
                throw std::runtime_error("Escher: Shape initialization failed - Not any path was created.");

        // Use the centerpoint as our initial bounding box
        DrawLib::FPBoundingBox outer_bounding_box = DrawLib::FPBoundingBox(0,0,0,0) * pars.stored_transformation;

        // The just locally used bb of the current path:
        DrawLib::FPBoundingBox local_path_bounding_box;

        // When any text is defined for this shape, then let the text part
        // calculate the pixel-unitss BB and extend the outer BB to this BB
        // to assure all text fits within the outer BB:
        if(text_part.DoWeNeedToDrawText())
        {
                DrawLib::FPBoundingBox text_bounding_box =
                        text_part.ApplyTextBoxToCanvas(pars);

                // Is the BB defined?
                if(text_bounding_box.upper_left.x < text_bounding_box.lower_right.x ||
                   text_bounding_box.upper_left.y < text_bounding_box.lower_right.y)
                        outer_bounding_box.ExtendTo(text_bounding_box);
        }

        std::vector<InternalPath>::iterator internal_path_i = paths.begin();
        while(internal_path_i != paths.end())
        {
                //Translate from local coordinate space to stored pixel canvas
                internal_path_i->path.ApplyTransform(localtransformation);
                internal_path_i->path.ApplyTransform(pars.stored_transformation);

                if(!internal_path_i->path.IsEmpty())
                {
                        float outline_width = internal_path_i->need_to_stroke
                                ? line_part.GetLineWidth()
                                : 0.f;

                        local_path_bounding_box = internal_path_i->path.GetPathBoundingBox(outline_endcap_mode, outline_join_mode, outline_width, line_part.GetMiterLimit());

                        // Is it defined ?:
                        if(local_path_bounding_box.upper_left.x <= local_path_bounding_box.lower_right.x)
                        {
                                outer_bounding_box.ExtendTo(local_path_bounding_box);

                                // Also get the boundingbox for the fill,
                                // of the path without an outline:

                                // ... and store the box in the fill_part OR
                                // store the box as a box of an 'own fill bitmap':
                                if(internal_path_i->fill_own_bitmap)
                                {
                                        internal_path_i->own_bitmap_bounding_box = local_path_bounding_box;
                                }
                                else
                                {
                                        fill_part.ExtendBoundingBox(local_path_bounding_box);
                                }
                        }
                }

                ++internal_path_i;
        }
        return outer_bounding_box;
}

DrawLib::Path * MultiPathShape::CreatePath(float fill_color_factor,
        bool stroke, bool fill, bool own_bitmap)
{
        InternalPath internal_path;

        internal_path.fill_color_factor = fill_color_factor;
        internal_path.need_to_stroke    = stroke;
        internal_path.need_to_fill      = fill;
        internal_path.fill_own_bitmap   = own_bitmap;

        // Add the new internal path:
        paths.push_back(internal_path);
        // ... and return a pointer to the new last path:
        return &paths.rbegin()->path;
}

void MultiPathShape::ApplyTransform(DrawLib::XForm2D const &trans)
{
        localtransformation *= trans;
        text_part.ApplyTransform(trans);
}

void MultiPathShape::Draw(ShapeDrawParameters const &pars) const
{
        if (pars.bitmap)
        {
                DrawLib::Canvas32 canvas(pars.bitmap);
                DrawLib::DrawObject drawobj(&canvas);

                // The fill texture bitmap, possibly also used by internal paths:
                std::unique_ptr<DrawLib::BitmapInterface const> fill_texture_bitmap;
                fill_texture_bitmap.reset(
                        fill_part.GenerateFillTexture(pars, paths[0].path, NULL));

                // The outline texture bitmap, possibly also used by internal paths:
                std::unique_ptr<DrawLib::BitmapInterface const> outline_texture_bitmap;
                outline_texture_bitmap.reset(line_part.GenerateLineFillTexture(pars));

                std::vector<InternalPath> local_internal_paths = paths;

                std::vector<InternalPath>::iterator internal_path_i = local_internal_paths.begin();
                while(internal_path_i != local_internal_paths.end())
                {
                        internal_path_i->path.ApplyTransform(pars.final_transformation);
                        ++internal_path_i;
                }

                // Do we need to draw fills ?:
                if(fill_part.DoWeNeedToFill())
                {
                        // Fill the internal paths, if they need to:
                        internal_path_i = local_internal_paths.begin();
                        while(internal_path_i != local_internal_paths.end())
                        {
                                if( internal_path_i->need_to_fill &&
                                // And it does not define its own bitmap?
                                   !internal_path_i->fill_own_bitmap)
                                {
                                        // Now set the fill properties for the next path:
                                        // (The fill bitmap gets reused.)
                                        fill_part.EffectProperties(&drawobj,
                                                internal_path_i->fill_color_factor==1.0,
                                                fill_texture_bitmap.get(),
                                                internal_path_i->fill_color_factor,NULL, pars);

                                        // Fill this internal path..
                                        drawobj.FillPath(internal_path_i->path);
                                }

                                ++internal_path_i;
                        }

                        fill_part.ResetNecessaryProperties(&drawobj);
                }

                #if defined(DEBUG) && defined(DEBUG_DRAW_BOXES)
                // Draw a test rectangle, around the unrotated, but scaled inner bounding box:
                drawobj.SetOutlineColor(DrawLib::Pixel32(0,0,0));
                drawobj.SetOutlineWidth(1.0);
                BoundingBox b2 = pars.GetFinalBoundingBox(canvas_bounding_box);
                DrawLib::FPPoint p[4] =
                {
                        DrawLib::FPPoint(b2.GetLeft() ,b2.GetTop()),
                        DrawLib::FPPoint(b2.GetRight(),b2.GetTop()),
                        DrawLib::FPPoint(b2.GetRight(),b2.GetBottom()),
                        DrawLib::FPPoint(b2.GetLeft() ,b2.GetBottom()),
                };
                drawobj.ResetOutlineDashing();

                DrawLib::Path path;

                path.MoveTo(p[0]);
                path.LineTo(p[1]);
                path.LineTo(p[2]);
                path.LineTo(p[3]);
                path.Close;
                drawobj.StrokePath(path);

                #endif

                // Need to draw any outlines at all?
                if(line_part.EffectProperties(
                        &drawobj, outline_endcap_mode, outline_join_mode,
                        false, outline_texture_bitmap.get(), pars))
                {
                        // Stroke the internal paths, if they need to:
                        internal_path_i = local_internal_paths.begin();
                        while(internal_path_i != local_internal_paths.end())
                        {
                                // Also need to draw its outline?
                                if( internal_path_i->need_to_stroke && !internal_path_i->fill_own_bitmap)
                                        line_part.StrokePath(drawobj, internal_path_i->path, pars);

                                ++internal_path_i;
                        }

                        line_part.ResetNecessaryProperties(&drawobj, false);
                }


                // *************************************************
                // From here the handing of internal paths which have their own fill bitmap:

                // Also fill the internal paths, if they need to:
                internal_path_i = local_internal_paths.begin();
                while(internal_path_i != local_internal_paths.end())
                {
                        // Does the internal path endeed define its own fill bitmap ?:
                        if(!internal_path_i->fill_own_bitmap)
                        {
                                ++internal_path_i;
                                continue;
                        }

                        if(internal_path_i->need_to_fill &&
                           fill_part.DoWeNeedToFill())
                        {
                                // First create the 'own' bitmap:
                                std::unique_ptr<DrawLib::BitmapInterface const> own_fill_texture_bitmap;
                                own_fill_texture_bitmap.reset(fill_part.GenerateFillTexture(
                                        pars, internal_path_i->path,
                                        &internal_path_i->own_bitmap_bounding_box));

                                // Now set the fill bitmap (if needed):
                                fill_part.EffectProperties(&drawobj,
                                        internal_path_i->fill_color_factor==1.0,
                                        own_fill_texture_bitmap.get(),
                                        internal_path_i->fill_color_factor,
                                        &internal_path_i->own_bitmap_bounding_box,pars);

                                // Fill this internal path..
                                drawobj.FillPath(internal_path_i->path);

                                fill_part.ResetNecessaryProperties(&drawobj);
                        }

                        // Need to draw any outlines at all?
                        if(internal_path_i->need_to_stroke &&
                           line_part.EffectProperties(
                                &drawobj, outline_endcap_mode, outline_join_mode,
                                false, outline_texture_bitmap.get(), pars))
                        {
                                line_part.StrokePath(drawobj,internal_path_i->path, pars);

                                line_part.ResetNecessaryProperties(&drawobj, false);
                        }

                        ++internal_path_i;
                }
        }

        text_part.Draw(pars);
}


/////////////////////////////////////////////////////
////// Implementation AbstractLineShape /////////////

AbstractLineShape::AbstractLineShape(ShapeContainer const &shape_container,
        bool shade_shape_to_outline)
: EscherShape()
, arrowheads_part(shape_container.GetProperties())
, geometry_part  (shape_container.GetProperties())
, fill_part      (shape_container, shape_container.GetProperties(), shade_shape_to_outline, false)
, line_part      (shape_container, shape_container.GetProperties())
, text_part      (shape_container.GetProperties(), shape_container.GetShapeId())
{
        text_part.SetLineWidth(line_part.GetLineWidth());
}

DrawLib::FPBoundingBox AbstractLineShape::ApplyToCanvas(TransformationState const &pars)
{
        DrawLib::XForm2D scaling =
                pars.stored_transformation *
                DrawLib::XForm2D(
                        -pars.stored_transformation.GetRotation(),
                        DrawLib::FPPoint(1,1),
                        DrawLib::FPPoint(0,0));
        scaling.translation = DrawLib::FPPoint(0,0);

        //************************************
        // Let the subclass setup the line and its fill here. It only scales
        // everything it generates. It does not rotate and translate it.
        // Also the text box and arrowheads should get initialized here.

        // Outer BB of the arrowheads is returned here:
        DrawLib::FPBoundingBox outerbox = SetupLineAndFill(scaling);


        DrawLib::XForm2D rotation_and_translation = DrawLib::XForm2D(
                pars.stored_transformation.GetRotation(),
                DrawLib::FPPoint(1,1),
                pars.stored_transformation.translation);
        outerbox = Escher::GetOuterBoundingBoxOfTransformedBoundingBox(outerbox, rotation_and_translation);
        outline_path   .ApplyTransform(rotation_and_translation);
        fill_path      .ApplyTransform(rotation_and_translation);
        arrowheads_part.ApplyTransform(rotation_and_translation);


        // When any text is defined for this shape, then let the text part
        // calculate the pixel-units BB and extend the outer BB to this BB
        // to assure all text fits within the outer BB:
        if(text_part.DoWeNeedToDrawText())
        {
                DrawLib::FPBoundingBox text_bounding_box =
                        text_part.ApplyTextBoxToCanvas(pars);

                // Is the BB defined?
                if(text_bounding_box.upper_left.x < text_bounding_box.lower_right.x ||
                   text_bounding_box.upper_left.y < text_bounding_box.lower_right.y)
                        outerbox.ExtendTo(text_bounding_box);
        }


        // Get the boundingbox of the fill path:
        if(line_part.IsSet() && !outline_path.IsEmpty())
        {
                DrawLib::FPBoundingBox bb = outline_path.GetPathBoundingBox(DrawLib::OutlineEndcapModes::Flat,
                                                                            DrawLib::OutlineJoinModes::Rounded,
                                                                            line_part.GetLineWidth(),
                                                                            -1);

                // ... and set the outer bounding box:
                outerbox.ExtendTo(bb);
        }


        // Get the boundingbox of the fill path:
        if(fill_part.DoWeNeedToFill() && !fill_path.IsEmpty())
        {
                DrawLib::FPBoundingBox bb = fill_path.GetPathBoundingBox(DrawLib::OutlineEndcapModes::Flat,
                                                                            DrawLib::OutlineJoinModes::Rounded,
                                                                            1.0,
                                                                            -1);


                // ... and set the outer bounding box:
                outerbox.ExtendTo(bb);
                fill_part.ExtendBoundingBox(bb);
        }
        return outerbox;
}

void AbstractLineShape::Draw(ShapeDrawParameters const &pars) const
{
        if (pars.bitmap)
        {
                DrawLib::Canvas32 canvas(pars.bitmap);
                DrawLib::DrawObject drawobj(&canvas);

                std::unique_ptr<DrawLib::BitmapInterface const> texture_bitmap;
                texture_bitmap.reset(fill_part.GenerateFillTexture(pars, fill_path, NULL));

                std::unique_ptr<DrawLib::BitmapInterface const> outline_bitmap;
                outline_bitmap.reset(line_part.GenerateLineFillTexture(pars));

                if(fill_part.EffectProperties(
                                &drawobj, true, texture_bitmap.get(),
                                1.0, NULL, pars))
                {
                        DrawLib::Path p2 = fill_path;
                        p2.ApplyTransform(pars.final_transformation);
                        drawobj.FillPath(p2);

                        fill_part.ResetNecessaryProperties(&drawobj);
                }


                if(line_part.EffectProperties(&drawobj,
                     DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded,
                        true, outline_bitmap.get(), pars))
                {
                        if(!outline_path.IsEmpty())
                        {
                                DrawLib::Path p2 = outline_path;
                                p2.ApplyTransform(pars.final_transformation);
                                line_part.StrokePath(drawobj, p2, pars);
                        }

                        arrowheads_part.Draw(pars.final_transformation, drawobj);

                        line_part.ResetNecessaryProperties(&drawobj, true);
                }
        }

        text_part.Draw(pars);
}
// End implementation AbstractLineShape



// *** Free Form shape (st0). ***

FreeFormShape::FreeFormShape(ShapeContainer const &shape_container)
: EscherShape()
, arrowheads_part(shape_container.GetProperties())
, geometry_part(shape_container.GetProperties())
, fill_part(shape_container, shape_container.GetProperties(), false, true)
, line_part(shape_container, shape_container.GetProperties())
{ }

DrawLib::FPBoundingBox FreeFormShape::ApplyToCanvas(TransformationState const &pars)
{
        return geometry_part.ApplyToCanvas(
                        pars,
                        &arrowheads_part,
                        &fill_part,
                        line_part.GetLineWidth());
}

void FreeFormShape::Draw(ShapeDrawParameters const &pars) const
{
        if (!pars.bitmap)
            return;

        DrawLib::Canvas32 canvas(pars.bitmap);
        DrawLib::DrawObject drawobj(&canvas);

        std::unique_ptr<DrawLib::Path> path;
        path.reset(geometry_part.CreatePathToDraw(pars));
        if(!path.get())
                return;

        // This is not a MultiPathShape, cause it must
        // store its points in pixel units, which MultiPathShape can't.
        DrawLib::Path p2 = *path;
        p2.ClosePath();

        std::unique_ptr<DrawLib::BitmapInterface const> texture_bitmap;
        texture_bitmap.reset(fill_part.GenerateFillTexture(pars, p2, NULL));

        std::unique_ptr<DrawLib::BitmapInterface const> outline_bitmap;
        outline_bitmap.reset(line_part.GenerateLineFillTexture(pars));

        if(fill_part.EffectProperties(
                        &drawobj, true, texture_bitmap.get(),
                        1.0,NULL, pars))
        {
                drawobj.FillPath(p2);
                fill_part.ResetNecessaryProperties(&drawobj);
        }


        if(line_part.EffectProperties(&drawobj,
             DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Rounded,
                true, outline_bitmap.get(), pars))
        {
                line_part.StrokePath(drawobj, *path, pars);
                if(geometry_part.IsPathOpenWithArrowheads())
                        arrowheads_part.Draw(pars.final_transformation, drawobj);

                line_part.ResetNecessaryProperties(&drawobj, true);
        }
}


// *** Picture frame shape (st75). ***

PictureFrameShape::PictureFrameShape(ShapeContainer const &shape_container)
: shapeprops(shape_container.GetProperties())
, blip_render_part(shape_container.GetProperties())
, fill_part(shape_container, shape_container.GetProperties(),false,false)
{
}

DrawLib::FPBoundingBox PictureFrameShape::ApplyToCanvas(TransformationState const &pars)
{
        // Create a BB, just fitting around the 4 corner points of the image:
        return Escher::GetOuterBoundingBoxOfTransformedBoundingBox(
                DrawLib::FPBoundingBox(-1,-1, 1,1),
                pars.stored_transformation);
}

void PictureFrameShape::Draw(ShapeDrawParameters const &pars) const
{
        msoBlip const* blipdata = shapeprops.GetPropertyAsBlip(260);
        if (!blipdata)
            return;

        DrawLib::FPBoundingBox bbox(-1, -1, 1, 1);
        bbox *= pars.stored_transformation;
        bbox *= pars.final_transformation;
        if (bbox.GetWidth() * bbox.GetHeight() < 1)
            return; //too small to render

        if (fill_part.DoWeNeedToFill() && pars.bitmap) //ADDME: Fill code is being duplicated around here..
        {
                DrawLib::Canvas32 canvas(pars.bitmap);
                DrawLib::DrawObject drawobj(&canvas);
                DrawLib::Path fill_path;
                fill_path.MoveTo(DrawLib::FPPoint(-1, -1));
                fill_path.LineTo(DrawLib::FPPoint(-1, 1));
                fill_path.LineTo(DrawLib::FPPoint(1, 1));
                fill_path.LineTo(DrawLib::FPPoint(1, -1));
                fill_path.ClosePath();
                fill_path.ApplyTransform(pars.stored_transformation);

                std::unique_ptr<DrawLib::BitmapInterface const> texture_bitmap;
                texture_bitmap.reset(fill_part.GenerateFillTexture(pars, fill_path, NULL));

                if(fill_part.EffectProperties(&drawobj, true, texture_bitmap.get(), 1.0, NULL, pars))
                {
                        DrawLib::Path p2 = fill_path;
                        p2.ApplyTransform(pars.final_transformation);
                        drawobj.FillPath(p2);
                        fill_part.ResetNecessaryProperties(&drawobj);
                }
        }

        /*
        DrawLib::FPPoint upper_right(1,-1);
        DrawLib::FPPoint lower_left(1,-1);

        upper_left *= pars.stored_transformation;
        upper_left *= pars.final_transformation;
        upper_right *= pars.stored_transformation;
        upper_right *= pars.final_transformation;
        lower_left *= pars.stored_transformation;
        lower_left *= pars.final_transformation;

        float width = (upper_right-upper_left).Norm();
        float height = (upper_right-lower_left).Norm();

        *pars.bitmap, imgbox*/

        blipdata->PaintYourself(pars, blip_render_part.GetRenderProps());
}

// *** Connector / Line shape  ***

ConnectorShape::ConnectorShape(ShapeContainer const &shape_container, LineCount _line_count)
: EscherShape()
, geometry_part  (shape_container.GetProperties())
, line_part      (shape_container, shape_container.GetProperties())
, arrowheads_part(shape_container.GetProperties())
, text_part      (shape_container.GetProperties(), shape_container.GetShapeId())
, line_count     (_line_count)
{
        text_part.SetLineWidth(line_part.GetLineWidth());

        connector_type = (int)shape_container.GetProperties().Get(Properties::cxstyle, NULL);

        adjust1 = geometry_part.GetAdjustX_Value(0, 0.0);
        adjust2 = geometry_part.GetAdjustX_Value(1, 0.0);
        adjust3 = geometry_part.GetAdjustX_Value(2, 0.0);
}

DrawLib::FPBoundingBox ConnectorShape::ApplyToCanvas(TransformationState const &pars)
{
        text_part.SetupTextBox(1, 1, 1, 1);

        DrawLib::FPBoundingBox outerbox(0,0,0,0);

        // Setting up the arrowheads for a non-straight line:
        if(connector_type == 1/*msocxstyleBent*/ ||
           connector_type == 2/*msocxstyleCurved*/)
        {
                //ADDME: This does not entirely responds exactly like MS-Escher does,
                // but the result is still just fine ans sometimes even looks better
                // then MS-Escher.
                switch(line_count)
                {
                case ONE:
                        break;
                case TWO:
                        outerbox = arrowheads_part.ApplyToCanvas(pars.stored_transformation,
                                -1,-1, 1,-1,      1,1,  1,-1, line_part.GetLineWidth());
                        break;
                case THREE:
                        outerbox = arrowheads_part.ApplyToCanvas(pars.stored_transformation,
                                -1,-1, 1,-1,      1,1,  -1,1, line_part.GetLineWidth());
                        break;
                case FOUR:
                        outerbox = arrowheads_part.ApplyToCanvas(pars.stored_transformation,
                                -1,-1, 1,-1,      1,1,  1,2, line_part.GetLineWidth());
                        break;
                case FIVE:
                        outerbox = arrowheads_part.ApplyToCanvas(pars.stored_transformation,
                                -1,-1, -2,-1,      1,1,  2, 1, line_part.GetLineWidth());
                        break;
                }
        }

        // Setting up the arrowheads for a straight line:
        else
        {
                outerbox = arrowheads_part.ApplyToCanvas(pars.stored_transformation,
                        -1,-1, 1,1,      1,1, -1, -1, line_part.GetLineWidth());
        }

        DrawLib::FPPoint start = arrowheads_part.GetConnectionPoint(ArrowHeadsPart::START);
        DrawLib::FPPoint end   = arrowheads_part.GetConnectionPoint(ArrowHeadsPart::END  );

        // When any text is defined for this shape, then let the text part
        // calculate the pixel-units BB:
        if(text_part.DoWeNeedToDrawText())
        {
                DrawLib::FPBoundingBox text_bounding_box =
                        text_part.ApplyTextBoxToCanvas(pars);
                outerbox.ExtendTo(text_bounding_box);
        }

        if (start==end)
            return outerbox; //No line to draw..

        //start and end are already transformed using pars.stored_transformation here!

        path.MoveTo(start);


        // Setting up connectors made up of multiple straight lines:
        if(connector_type == 1/*msocxstyleBent*/)
        {
                switch(line_count)
                {
                case ONE:
                        break;
                case TWO:
                        path.LineTo(DrawLib::FPPoint( 1     , -1     ) * pars.stored_transformation);
                        break;
                case THREE:
                        path.LineTo(DrawLib::FPPoint(adjust1, -1     ) * pars.stored_transformation);
                        path.LineTo(DrawLib::FPPoint(adjust1,  1     ) * pars.stored_transformation);
                        break;
                case FOUR:
                        path.LineTo(DrawLib::FPPoint(adjust1, -1     ) * pars.stored_transformation);
                        path.LineTo(DrawLib::FPPoint(adjust1, adjust2) * pars.stored_transformation);
                        path.LineTo(DrawLib::FPPoint( 1     , adjust2) * pars.stored_transformation);
                        break;
                case FIVE:
                        path.LineTo(DrawLib::FPPoint(adjust1, -1     ) * pars.stored_transformation);
                        path.LineTo(DrawLib::FPPoint(adjust1, adjust2) * pars.stored_transformation);
                        path.LineTo(DrawLib::FPPoint(adjust3, adjust2) * pars.stored_transformation);
                        path.LineTo(DrawLib::FPPoint(adjust3,  1     ) * pars.stored_transformation);
                        break;
                }

                path.LineTo(end);
        }

        // Setting up connectors made up of multiple curved lines:
        else if(connector_type == 2/*msocxstyleCurved*/)
        {
                switch(line_count)
                {
                case ONE:
                        break;
                case TWO:
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint( 1     , -1     ) * pars.stored_transformation,
                                end);
                        break;
                case THREE:
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust1, -1     ) * pars.stored_transformation,
                                DrawLib::FPPoint(adjust1,  0     ) * pars.stored_transformation);
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust1,  1     ) * pars.stored_transformation,
                                end);
                        break;
                case FOUR:
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust1, -1     ) * pars.stored_transformation,
                                DrawLib::FPPoint(adjust1, MiddleOf(-1, adjust2)) * pars.stored_transformation);
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust1, adjust2) * pars.stored_transformation,
                                DrawLib::FPPoint(MiddleOf(adjust1, 1), adjust2) * pars.stored_transformation);
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint( 1     , adjust2) * pars.stored_transformation,
                                end);
                        break;
                case FIVE:
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust1, -1     ) * pars.stored_transformation,
                                DrawLib::FPPoint(adjust1, MiddleOf(-1, adjust2)) * pars.stored_transformation);
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust1, adjust2) * pars.stored_transformation,
                                DrawLib::FPPoint(MiddleOf(adjust1, adjust3), adjust2) * pars.stored_transformation);
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust3, adjust2) * pars.stored_transformation,
                                DrawLib::FPPoint(adjust3, MiddleOf(adjust2, 1)) * pars.stored_transformation);
                        PathCornerArcTo(&path,
                                DrawLib::FPPoint(adjust3,  1     ) * pars.stored_transformation,
                                end);
                        break;
                }
        }
        else
        { // connector_type == 0(msocxstyleStraight) ||
          // connector_type == 3(msocxstyleNone    ) ||
          // connector_type == 'something else'
                path.LineTo(end);
        }

        DrawLib::FPBoundingBox bb = path.GetPathBoundingBox(DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter, line_part.GetLineWidth(), -1);
        outerbox.ExtendTo(bb);
        return outerbox;
}

void ConnectorShape::Draw(ShapeDrawParameters const &pars) const
{
        if (pars.bitmap)
        {
                DrawLib::Canvas32 canvas(pars.bitmap);
                DrawLib::DrawObject drawobj(&canvas);

                std::unique_ptr<DrawLib::BitmapInterface const> outline_bitmap;
                outline_bitmap.reset(line_part.GenerateLineFillTexture(pars));

                // Should no (out)line be drawn ?:
                if(line_part.EffectProperties(&drawobj, DrawLib::OutlineEndcapModes::Flat,
                        DrawLib::OutlineJoinModes::Miter, true, outline_bitmap.get(), pars))
                {
                        DrawLib::Path local_path = path;
                        local_path.ApplyTransform(pars.final_transformation);
                        line_part.StrokePath(drawobj, local_path, pars);

                        arrowheads_part.Draw(pars.final_transformation, drawobj);

                        line_part.ResetNecessaryProperties(&drawobj, true);
                }
        }

        text_part.Draw(pars);
}

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers
