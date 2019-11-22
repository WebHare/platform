#include <drawlib/drawlibv2/allincludes.h>


#include "helperfuncs.h"

#include <drawlib/drawlibv2/drawobject.h>

/********************************************************************************
        ELLIPSE
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_Ellipse)
{
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawEllipse(DrawLib::FPPoint(200,200),DrawLib::FPSize(100.5,100.5));
        drobj.DrawEllipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(50.5,50.5));
        drobj.SetOutlineWidth(4.0);
        drobj.DrawEllipseOutline(DrawLib::FPPoint(400,400), DrawLib::FPSize(50.5,50.5));
        drobj.SetOutlineWidth(0.2);
        drobj.DrawEllipseOutline(DrawLib::FPPoint(200,200), DrawLib::FPSize(110.5,110.5));

BLEX_TEST_CHECK(DoCompare ("ref-drobj_ellipse.png", mybitmap, true));
}

/********************************************************************************
        RECTANGLE
********************************************************************************/
BLEX_TEST_FUNCTION( DrObjTest_Rectangle)
{
        //make a bitmap!
        DrawLib::Bitmap32 mybitmap(400,400, DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.DrawRectangle(DrawLib::FPPoint(100,100),DrawLib::FPPoint(300,300));
        drobj.DrawRectangleOutline(DrawLib::FPPoint(90,90), DrawLib::FPPoint(310,310));

        BLEX_TEST_CHECK( DoCompare ("ref-drobj_rectangle.png", mybitmap, true));
}

/********************************************************************************
        ROUND RECTANGLE
********************************************************************************/
BLEX_TEST_FUNCTION( DrObjTest_RoundRectangle)
{
        //make a bitmap!
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.DrawRoundRectangle(DrawLib::FPPoint(100,100),DrawLib::FPPoint(300,300),DrawLib::FPSize(20,20));

        BLEX_TEST_CHECK( DoCompare ("ref-drobj_round_rectangle.png", mybitmap, true));
}

/********************************************************************************
        PIE
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_Pie)
{
        DrawLib::Bitmap32 mybitmap(500,500,DrawLib::Pixel32(255,255,255,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.SetFillColor(DrawLib::Pixel32(255,0,255,255));
        drobj.SetOutlineWidth(2.0);
        drobj.SetOutlineColor(DrawLib::Pixel32(0,0,0,255));

        //hole on the left :)
        DrawLib::FPPoint center (250,250);
        DrawLib::FPSize  radius (170, 100);
        DrawLib::FPPoint start  (50,  260);
        DrawLib::FPPoint end    (50 , 240);
        drobj.DrawPie(center, radius, start, end);
        drobj.DrawPieOutline(center, radius, start, end);

        BLEX_TEST_CHECK(DoCompare ("ref-drobj_pie.png", mybitmap, true));
}

/********************************************************************************
        ARC
********************************************************************************/

BLEX_TEST_FUNCTION( DrObjTest_Arc )
{
        DrawLib::Bitmap32 mybitmap(500,500,DrawLib::Pixel32(0,0,0,0));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.SetFillColor(DrawLib::Pixel32(255,0,255,255));
        drobj.SetOutlineWidth(10.0);
        drobj.SetOutlineColor(DrawLib::Pixel32(255,0,0,255));

        //hole on the left :)
        DrawLib::FPPoint center (100,100);
        DrawLib::FPSize  radius (30 , 30);
        DrawLib::FPPoint start  (50,  90);
        DrawLib::FPPoint end    (50 , 110);
        drobj.DrawArcOutline(center, radius, start, end, true);

        //demi circle left .. (red)
        center.x=200;           center.y=100;
        radius.width=50;        radius.height=50;
        start.x=200;            start.y=110;
        end.x=200;              end.y=90;
        drobj.DrawArcOutline(center, radius, start, end, true);

        drobj.SetOutlineColor(DrawLib::Pixel32(255,255,0,255));
        radius.width=30;        radius.height=30;
        //demi circle right .. (yellow)
        drobj.DrawArcOutline(center, radius, start, end, false);

        //demi circle top (cyan)
        center.x=100;           center.y=200;
        radius.width=50;        radius.height=50;
        start.x=50;             start.y=100;
        end.x  =150;            end.y=  100;
        drobj.SetOutlineColor(DrawLib::Pixel32(0,255,255,255));
        drobj.DrawArcOutline(center, radius, start, end, true);

        //quarter circle right bottom (green)
        center.x=200;           center.y=200;
        radius.width=50;        radius.height=50;
        start.x=250;            start.y=200;
        end.x  =200;            end.y=  300;
        drobj.SetOutlineColor(DrawLib::Pixel32(0,255,0,255));
        drobj.DrawArcOutline(center, radius, start, end, true);

        //same quarter circle right bottom (white) but draw in reverse
        center.x=200;           center.y=200;
        radius.width=70;        radius.height=70;
        start.x=200;            start.y=300;
        end.x  =250;            end.y=  200;
        drobj.SetOutlineColor(DrawLib::Pixel32(255,255,255,255));
        drobj.DrawArcOutline(center, radius, start, end, false);

        //three-quarter ellipse except right bottom (blue )
        center.x=200;           center.y=200;
        radius.width=170;       radius.height=10;
        start.x=200;            start.y=300;
        end.x  =250;            end.y=  200;
        drobj.SetOutlineColor(DrawLib::Pixel32(0,0,255,255));
        drobj.DrawArcOutline(center, radius, start, end, true);

        BLEX_TEST_CHECK(DoCompare ("ref-drobj_arc.png", mybitmap, true));

}

/********************************************************************************
        Bounding box of path test
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_PathBoundingBox_Lines10_Rounded)
{
        DrawLib::Path mypath;

        mypath.MoveTo(DrawLib::FPPoint(0,0));
        mypath.LineTo(DrawLib::FPPoint(150,0));
        mypath.LineTo(DrawLib::FPPoint(100,100));
        mypath.LineTo(DrawLib::FPPoint(0,100));
        mypath.BezierTo(DrawLib::FPPoint(-30, 70),
                        DrawLib::FPPoint(-30, 30),
                        DrawLib::FPPoint(  0,  0));

        DrawLib::FPBoundingBox bbox = mypath.GetPathBoundingBox(DrawLib::OutlineEndcapModes::Rounded, DrawLib::OutlineJoinModes::Rounded, 10.0, -1);
        BLEX_TEST_CHECK(
                bbox.upper_left.x  > - 27.55 && bbox.upper_left.x  < - 27.45 &&
                bbox.upper_left.y  > -  5.05 && bbox.upper_left.y  < -  4.95 &&
                bbox.lower_right.x >  154.95 && bbox.lower_right.x <  155.05 &&
                bbox.lower_right.y >  104.95 && bbox.lower_right.y <  105.05);
}

BLEX_TEST_FUNCTION(DrObjTest_PathBoundingBox_Lines10_FlatMiter)
{
        DrawLib::Bitmap32 mybitmap(1,1);
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::Path mypath;

        mypath.MoveTo(DrawLib::FPPoint(0,0));
        mypath.LineTo(DrawLib::FPPoint(150,0));
        mypath.LineTo(DrawLib::FPPoint(100,100));
        mypath.LineTo(DrawLib::FPPoint(0,100));
        mypath.BezierTo(DrawLib::FPPoint(-30, 70),
                        DrawLib::FPPoint(-30, 30),
                        DrawLib::FPPoint(  0,  0));

        DrawLib::FPBoundingBox bbox = mypath.GetPathBoundingBox(DrawLib::OutlineEndcapModes::Flat, DrawLib::OutlineJoinModes::Miter, 10.0, -1);
        BLEX_TEST_CHECK(
                bbox.upper_left.x  > - 27.55 && bbox.upper_left.x  < - 27.45 &&
                bbox.upper_left.y  > -  5.05 && bbox.upper_left.y  < -  4.95 &&
                bbox.lower_right.x >  158.05 && bbox.lower_right.x <  158.10 &&
                bbox.lower_right.y >  104.95 && bbox.lower_right.y <  105.05);
}


/********************************************************************************
        Stroke and FillPath.
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_Path_StrokeAndFill)
{
        DrawLib::Bitmap32 mybitmap(500,500,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetOutlineWidth(10.0);
        drobj.SetOutlineEndcapMode(DrawLib::OutlineEndcapModes::Flat);
        drobj.SetOutlineJoinMode  (DrawLib::OutlineJoinModes::Miter);
        drobj.SetFillColor(DrawLib::Pixel32(0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0,0));


        DrawLib::Path mypath;

        // first define the path..

        mypath.MoveTo(DrawLib::FPPoint(310,290));               // startpoint
        mypath.BezierTo(DrawLib::FPPoint(300,280),
                DrawLib::FPPoint(300,320),
                DrawLib::FPPoint(290,310));
        mypath.LineTo(DrawLib::FPPoint(290,390));
        mypath.BezierTo(DrawLib::FPPoint(300,420),
                DrawLib::FPPoint(300,400),
                DrawLib::FPPoint(310,410));
        mypath.LineTo(DrawLib::FPPoint(390,410));
        mypath.BezierTo(DrawLib::FPPoint(400,420),
                DrawLib::FPPoint(400,400),
                DrawLib::FPPoint(410,390));
        mypath.LineTo(DrawLib::FPPoint(410,310));
        mypath.BezierTo(DrawLib::FPPoint(400,300),
                DrawLib::FPPoint(400,320),
                DrawLib::FPPoint(390,290));
        mypath.ClosePath();

        // second path..
        mypath.MoveTo(DrawLib::FPPoint(100, 50));
        mypath.LineTo(DrawLib::FPPoint(150, 150));
        mypath.LineTo(DrawLib::FPPoint(50,  100));
        mypath.ClosePath();

        drobj.StrokeAndFillPath(mypath);


        // check if it doesn't throw an exception...
        mypath.Reset();
        mypath.MoveTo(DrawLib::FPPoint(0,0));
        mypath.LineTo(DrawLib::FPPoint(480,0));
        mypath.LineTo(DrawLib::FPPoint(480,480));

        drobj.StrokeAndFillPath(mypath);

//FIXME: Marcoen: faalt op linux!        BLEX_TEST_CHECK( DoCompare("drobj_path.png", mybitmap, true) );
}

BLEX_TEST_FUNCTION(DrObjTest_MilterLimit_Path)
{
        DrawLib::Bitmap32 mybitmap(210,160,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetOutlineWidth(10);
        drobj.SetOutlineEndcapMode(DrawLib::OutlineEndcapModes::Flat);
        drobj.SetOutlineJoinMode  (DrawLib::OutlineJoinModes::Miter);

        // Setting of the miter limit here!
        drobj.SetOutlineJoinMiterLimit(30);


        DrawLib::Path mypath;

        mypath.MoveTo(DrawLib::FPPoint( 60, 10));
        mypath.LineTo(DrawLib::FPPoint(140, 10));

        mypath.LineTo(DrawLib::FPPoint( 60, 15));
        mypath.LineTo(DrawLib::FPPoint(140, 15));

        mypath.LineTo(DrawLib::FPPoint( 60, 25));
        mypath.LineTo(DrawLib::FPPoint(140, 25));

        mypath.LineTo(DrawLib::FPPoint( 60, 40));
        mypath.LineTo(DrawLib::FPPoint(140, 40));

        mypath.LineTo(DrawLib::FPPoint( 60, 60));
        mypath.LineTo(DrawLib::FPPoint(140, 60));

        mypath.LineTo(DrawLib::FPPoint( 60, 85));
        mypath.LineTo(DrawLib::FPPoint(140, 85));

        mypath.LineTo(DrawLib::FPPoint( 60,115));
        mypath.LineTo(DrawLib::FPPoint(140,115));

        mypath.LineTo(DrawLib::FPPoint( 60,150));
        mypath.LineTo(DrawLib::FPPoint(140,150));

        drobj.StrokePath(mypath);


        BLEX_TEST_CHECK( DoCompare("ref-drobj_miterlimit_path.png", mybitmap, true) );
}

/********************************************************************************
        Ellipse and Path test..
********************************************************************************/

BLEX_TEST_FUNCTION(XForm2DTest)
{
        BLEX_TEST_CHECK( std::abs(1.75*M_PI - DrawLib::XForm2D(-0.25*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK( std::abs(0.00*M_PI - DrawLib::XForm2D(0.00*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK( std::abs(0.25*M_PI - DrawLib::XForm2D(0.25*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK( std::abs(0.50*M_PI - DrawLib::XForm2D(0.50*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK( std::abs(0.75*M_PI - DrawLib::XForm2D(0.75*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK( std::abs(1.00*M_PI - DrawLib::XForm2D(1.00*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation())< 0.0001);
        BLEX_TEST_CHECK( std::abs(1.25*M_PI - DrawLib::XForm2D(1.25*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation())< 0.0001);
        BLEX_TEST_CHECK( std::abs(1.50*M_PI - DrawLib::XForm2D(1.50*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK( std::abs(1.75*M_PI - DrawLib::XForm2D(1.75*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
        BLEX_TEST_CHECK(( std::abs(2.00*M_PI - DrawLib::XForm2D(2.00*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001)
                     || ( std::abs(0.00*M_PI - DrawLib::XForm2D(2.00*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001));
        BLEX_TEST_CHECK( std::abs(0.25*M_PI - DrawLib::XForm2D(2.25*M_PI,DrawLib::FPPoint(1,1),DrawLib::FPPoint(0,0)).GetRotation()) < 0.0001);
}

BLEX_TEST_FUNCTION(DrObjTest_EllipsePath)
{
        DrawLib::Bitmap32 mybitmap(1300,500,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetFillColor(DrawLib::Pixel32(0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0,0));
        drobj.SetOutlineWidth(1.0);

        DrawLib::Path mypath;

        mypath.Ellipse(DrawLib::FPPoint(150,150), DrawLib::FPSize(100,100));
        drobj.StrokeAndFillPath(mypath);
        mypath.Reset();

        mypath.Ellipse(DrawLib::FPPoint(50,350), DrawLib::FPSize(15,25));
        drobj.StrokeAndFillPath(mypath);
        mypath.Reset();

        mypath.Reset();
        mypath.Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(3,1));
        DrawLib::XForm2D xform(0.25*M_PI, DrawLib::FPPoint(50,50), DrawLib::FPPoint(250,250));
        mypath.SetTransform(xform);

        drobj.StrokeAndFillPath(mypath);

        // Test ellipses of different sizes:
        int x = 15;
        for(int i=0; i<10; ++i)
        {
                mypath.Reset();
                mypath.Ellipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(1,2));
                mypath.SetTransform(DrawLib::XForm2D(0, DrawLib::FPPoint(5+10*i,5+10*i),
                                    DrawLib::FPPoint(x,300)));
                x += 30+20*i;
                drobj.StrokeAndFillPath(mypath);
        }

        BLEX_TEST_CHECK( DoErrorCompare("ref-drobj_ellipsepath.png", mybitmap, 230, true) );
}

BLEX_TEST_FUNCTION(DrObjTest_EllipseHole)
{
        DrawLib::Bitmap32 mybitmap(500,500,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        DrawLib::Path mypath;

        drobj.SetFillColor(DrawLib::Pixel32(0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0,0));
        drobj.SetOutlineWidth(5.0);

        mypath.Ellipse(DrawLib::FPPoint(250,250), DrawLib::FPSize(200,200));
        mypath.Ellipse(DrawLib::FPPoint(250,250), DrawLib::FPSize(100,100));

        drobj.SetPolyEdgeMode(true);

        drobj.StrokeAndFillPath(mypath);
        BLEX_TEST_CHECK( DoErrorCompare("ref-drobj_ellipsehole.png", mybitmap, 150,  true) );
}

BLEX_TEST_FUNCTION(DrObjTest_ArcPath)
{
        DrawLib::Bitmap32 mybitmap(500,500,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        DrawLib::Path mypath;

        drobj.SetFillColor(DrawLib::Pixel32(0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0,0));
        drobj.SetOutlineWidth(5.0);

        mypath.MoveTo(DrawLib::FPPoint(50,50));
        mypath.LineTo(DrawLib::FPPoint(250,50));
        mypath.ArcTo(DrawLib::FPPoint(250,100), DrawLib::FPSize(50,50), DrawLib::FPPoint(300,100));
        mypath.LineTo(DrawLib::FPPoint(300,250));
        mypath.ArcTo(DrawLib::FPPoint(250,250), DrawLib::FPSize(50,50), DrawLib::FPPoint(250,300));
        mypath.LineTo(DrawLib::FPPoint(50,300));
        mypath.ArcTo(DrawLib::FPPoint(50,250), DrawLib::FPSize(50,50), DrawLib::FPPoint(0,250));
        mypath.LineTo(DrawLib::FPPoint(0,100));
        mypath.ArcTo(DrawLib::FPPoint(50,100), DrawLib::FPSize(50,50), DrawLib::FPPoint(50,50));
        mypath.ClosePath();

        DrawLib::XForm2D myxform(0,DrawLib::FPPoint(1,1),DrawLib::FPPoint(100,0));
        mypath.SetTransform(myxform);

        drobj.StrokePath(mypath);

        BLEX_TEST_CHECK( DoCompare("ref-drobj_arcpath.png", mybitmap, true) );
}

/********************************************************************************
        Path transformation..
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_TransformPath)
{
        DrawLib::Bitmap32 mybitmap(500,500);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        DrawLib::Path mypath;

        // first path..

        mypath.MoveTo(DrawLib::FPPoint(-100,-100));               // startpoint
        mypath.BezierTo(
                DrawLib::FPPoint(-50,-200),
                DrawLib::FPPoint( 50,0),
                DrawLib::FPPoint(100,-100));
        mypath.LineTo(DrawLib::FPPoint(100,80));
        mypath.LineTo(DrawLib::FPPoint(80,100));
        mypath.LineTo(DrawLib::FPPoint(-100,100));
        mypath.ClosePath();

        drobj.SetFillColor(DrawLib::Pixel32(0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0,0));
        drobj.SetOutlineWidth(5.0);
        for(unsigned int t=0; t<10; t++)
        {
                DrawLib::XForm2D xform(3.1415927*static_cast<double>(t)/10.0,
                                DrawLib::FPPoint(1.5, 1.0), DrawLib::FPPoint(250,250));

                mypath.SetTransform(xform);
                drobj.StrokeAndFillPath(mypath);
        }

        BLEX_TEST_CHECK( DoCompare("ref-drobj_transformpath.png", mybitmap, true) );
}



/********************************************************************************
        BITMAP CHECK FUNCTIONS
********************************************************************************/


/********************************************************************************
        BITMAP blit test functions..
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_Bitmap)
{
        DrawLib::Bitmap32 mybitmap1(75,75);
        DrawLib::Canvas32 mycanvas1(&mybitmap1);
        DrawLib::Bitmap32 mybitmap2(100,100);
        DrawLib::Canvas32 mycanvas2(&mybitmap2);
        DrawLib::DrawObject drobj1(&mycanvas1);
        DrawLib::DrawObject drobj2(&mycanvas2);

        //drobj.Clear(DrawLib::Pixel32(0,0,0,0)); // make canvas2 transparent black!
        mycanvas2.SetAlphaMode(DrawLib::Canvas32::COPYALL);
        // draw a semitransparent light blue rectangle..
        drobj2.SetFillColor(DrawLib::Pixel32(0x20,0x40,0xFF,0x80));
        drobj2.DrawRectangle(DrawLib::FPPoint(25,25),DrawLib::FPPoint(175,175));

        mycanvas1.SetAlphaMode(DrawLib::Canvas32::BLEND255);
        drobj1.SetFillColor(DrawLib::Pixel32(0xFF,0,0));
        drobj1.DrawEllipse(DrawLib::FPPoint(50,50), DrawLib::FPSize(40,40));
        // blit mybitmap2 onto mybitmap1...
        drobj1.DrawBitmap(mybitmap2, DrawLib::XForm2D());

        BLEX_TEST_CHECK(DoCompare("ref-drobj_bitmapblit.png", mybitmap1, true));
}

BLEX_TEST_FUNCTION(DrObjTest_PolyLine_DrawModes_Closing)
{
        DrawLib::Bitmap32 mybitmap(200,1270,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetOutlineWidth(20);

        DrawLib::Path mypath;

        DrawLib::OutlineEndcapModes::Type oem[8] = {
                DrawLib::OutlineEndcapModes::Flat,
                DrawLib::OutlineEndcapModes::Square,
                DrawLib::OutlineEndcapModes::Rounded,
                DrawLib::OutlineEndcapModes::Flat,
                DrawLib::OutlineEndcapModes::Square,
                DrawLib::OutlineEndcapModes::Rounded,
                DrawLib::OutlineEndcapModes::Flat,//Dont care
                DrawLib::OutlineEndcapModes::Flat,//Dont care
        };
        DrawLib::OutlineJoinModes::Type ojm[8] = {
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
        };

        for(int i=0;i<8; i++)
        {
                drobj.SetOutlineEndcapMode(oem[i]);
                drobj.SetOutlineJoinMode  (ojm[i]);

                mypath.Reset();
                mypath.MoveTo(DrawLib::FPPoint(50,50   + 160*i));
                mypath.LineTo(DrawLib::FPPoint(100,50  + 160*i));
                mypath.LineTo(DrawLib::FPPoint(50,100  + 160*i));
                mypath.LineTo(DrawLib::FPPoint(100,100 + 160*i));
                if(i>=6) mypath.ClosePath();

                drobj.StrokePath(mypath);
        }

        BLEX_TEST_CHECK( DoCompare("ref-drobj_polyline_modes_closing.png", mybitmap, true) );
}


BLEX_TEST_FUNCTION(DrObjTest_PolyLine_DrawModes_Closing_New)
{
        DrawLib::Bitmap32 mybitmap(450,2540,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetOutlineWidth(15);

        DrawLib::Path mypath;

        DrawLib::OutlineEndcapModes::Type oem[8] = {
                DrawLib::OutlineEndcapModes::Flat,
                DrawLib::OutlineEndcapModes::Square,
                DrawLib::OutlineEndcapModes::Rounded,
                DrawLib::OutlineEndcapModes::Flat,
                DrawLib::OutlineEndcapModes::Square,
                DrawLib::OutlineEndcapModes::Rounded,
                DrawLib::OutlineEndcapModes::Flat,//Dont care
                DrawLib::OutlineEndcapModes::Flat,//Dont care
        };
        DrawLib::OutlineJoinModes::Type ojm[8] = {
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
                DrawLib::OutlineJoinModes::Miter,
                DrawLib::OutlineJoinModes::Rounded,
        };

        for(int i=0;i<8; i++)
        {
                drobj.SetOutlineEndcapMode(oem[i]);
                drobj.SetOutlineJoinMode  (ojm[i]);
                drobj.SetOutlineJoinMiterLimit(30);

                mypath.Reset();
                mypath.MoveTo(DrawLib::FPPoint( 50, 50 + 320*i));
                mypath.LineTo(DrawLib::FPPoint(200, 50 + 320*i));
                mypath.LineTo(DrawLib::FPPoint( 50,200 + 320*i));
                mypath.LineTo(DrawLib::FPPoint(200,200 + 320*i));
                if(i>=6) mypath.ClosePath();

                drobj.StrokePath(mypath);


                mypath.Reset();
                mypath.MoveTo(DrawLib::FPPoint(300, 50 + 320*i));
                mypath.LineTo(DrawLib::FPPoint(400, 50 + 320*i));
                mypath.BezierTo(DrawLib::FPPoint(300, 50 + 320*i),
                                DrawLib::FPPoint(250,100 + 320*i),
                                DrawLib::FPPoint(250,200 + 320*i));
                mypath.LineTo(DrawLib::FPPoint(250,100 + 320*i));
                if(i>=6) mypath.ClosePath();

                drobj.StrokePath(mypath);
        }

        BLEX_TEST_CHECK( DoCompare("ref-drobj_polyline_modes_closing_new.png", mybitmap, true) );
}

BLEX_TEST_FUNCTION(ContourIterator_Test)
{
        DrawLib::Bitmap32 mybitmap(110,110,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetOutlineWidth(4);
        drobj.SetOutlineEndcapMode(DrawLib::OutlineEndcapModes::Flat);
        drobj.SetOutlineJoinMode  (DrawLib::OutlineJoinModes::Miter );

        DrawLib::PolyLine mypolyline[2];

        mypolyline[0].points.push_back(DrawLib::FPPoint( 10,  10));
        mypolyline[0].points.push_back(DrawLib::FPPoint(100,  10));
        mypolyline[0].points.push_back(DrawLib::FPPoint(100, 100));
        mypolyline[0].points.push_back(DrawLib::FPPoint( 10, 100));
        mypolyline[0].Close();

        mypolyline[1].points.push_back(DrawLib::FPPoint( 20,  20));
        mypolyline[1].points.push_back(DrawLib::FPPoint( 80,  20));
        mypolyline[1].points.push_back(DrawLib::FPPoint( 20,  80));
        mypolyline[1].points.push_back(DrawLib::FPPoint( 80,  80));

        DrawLib::PolyLine part_polyline;

        for(unsigned i=0; i<2; ++i)
        {
                DrawLib::ContourIterator contour_iterator(mypolyline[i]);

                for(;;)
                {
                        contour_iterator.GetNextPart(&part_polyline, 17);
                        if(!part_polyline.IsValid()) break;
                        drobj.DrawPolyLine(part_polyline);

                        contour_iterator.GetNextPart(&part_polyline,  7);
                        if(!part_polyline.IsValid()) break;

                        contour_iterator.GetNextPart(&part_polyline,  7);
                        if(!part_polyline.IsValid()) break;
                        drobj.DrawPolyLine(part_polyline);

                        contour_iterator.GetNextPart(&part_polyline,  7);
                        if(!part_polyline.IsValid()) break;

                        contour_iterator.GetNextPart(&part_polyline,  7);
                        if(!part_polyline.IsValid()) break;
                        drobj.DrawPolyLine(part_polyline);

                        contour_iterator.GetNextPart(&part_polyline, 21);
                        if(!part_polyline.IsValid()) break;
                }
        }

        BLEX_TEST_CHECK( DoCompare("ref-contour_iterator.png", mybitmap, true) );
}
/*FIXME - fails on vz101
BLEX_TEST_FUNCTION(OutlineDashing_Test)
{
        DrawLib::Bitmap32 mybitmap(110,110,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);

        DrawLib::DrawObject drobj(&mycanvas);
        drobj.SetOutlineWidth(6);
        drobj.SetOutlineEndcapMode(DrawLib::OutlineEndcapModes::Flat);
        drobj.SetOutlineJoinMode  (DrawLib::OutlineJoinModes::Miter );
        drobj.SetOutlineColor(DrawLib::Pixel32(255, 0, 0));
        drobj.SetFillColor   (DrawLib::Pixel32(0, 0, 255));

        DrawLib::Path mypath;

        mypath.MoveTo(DrawLib::FPPoint( 10,  10));
        mypath.LineTo(DrawLib::FPPoint(100,  10));
        mypath.LineTo(DrawLib::FPPoint(100, 100));
        mypath.LineTo(DrawLib::FPPoint( 10, 100));
        mypath.ClosePath();

        mypath.MoveTo(DrawLib::FPPoint( 20,  20));
        mypath.LineTo(DrawLib::FPPoint( 80,  20));
        mypath.LineTo(DrawLib::FPPoint( 20,  80));
        mypath.LineTo(DrawLib::FPPoint( 80,  80));

        // Now set the dashing:
        uint32_t mydashstyle[6] = { 7, 7, 7, 7, 43, 43 };
        drobj.SetOutlineDashing(6, mydashstyle);

        drobj.StrokeAndFillPath(mypath);

        BLEX_TEST_CHECK( DoCompare("outline_dashing.png", mybitmap, true) );
}
*/
BLEX_TEST_FUNCTION(PathStrokingRounding_Versus_FillingRounding_Test)
{
        /*  Deze test kijkt of er bij het stroken van een path,
            dezelfde afrondingen worden gebruikt als bij het fillen
            van datzelfde path.

            Er wort daarom express eerst gestroked en dan gefillt.

            Vooralsnog gaat dit niet in alle gevallen goed. Met de
            huidige DrawLib code wordt bij deze test een lijnstuk
            over getekend bij het fillen. Ook zijn er bij gebruik
            door Escher gevallen gezien waarbij er pixels tussen de
            fill en de outline ongedekt bleven.

            Het zou mooi zijn als DrawLib wat dit betreft in ieder
            geval wat consequenter gedrag gaat vertonen. Hoogste
            prioriteit heeft in ieder geval dat bij gebruik van
            'StrokeAndFillPath' (of bij fillen na stroken) nooit
            pixels tussen de fill en de outline ongedekt blijven.
        */

        int const s=100;

        DrawLib::Bitmap32 mybitmap(s, s);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // Make the background white:
        drobj.SetFillColor(DrawLib::Pixel32(255, 255, 255));
        drobj.DrawRectangle(DrawLib::FPPoint(0,0), DrawLib::FPPoint(s,s));


        drobj.SetOutlineColor(DrawLib::Pixel32(255, 0, 0));
        drobj.SetFillColor   (DrawLib::Pixel32(0, 0, 255));


        DrawLib::Path mypath;

        mypath.MoveTo(DrawLib::FPPoint(-70, -70));
        mypath.LineTo(DrawLib::FPPoint(-50, -60));
        mypath.LineTo(DrawLib::FPPoint(-10, -10));
        mypath.LineTo(DrawLib::FPPoint(-70, -10));
        mypath.ClosePath();

        mypath.ApplyTransform(DrawLib::XForm2D(0.0, DrawLib::FPPoint(1, 1), DrawLib::FPPoint(s,s)));

        drobj.StrokePath(mypath);
        drobj.FillPath(mypath);


        // Accenturate the corner points:
        drobj.DrawPixel(DrawLib::FPPoint(s - 70, s - 70), DrawLib::Pixel32(200, 200, 0));
        drobj.DrawPixel(DrawLib::FPPoint(s - 50, s - 60), DrawLib::Pixel32(200, 200, 0));
        drobj.DrawPixel(DrawLib::FPPoint(s - 10, s - 10), DrawLib::Pixel32(200, 200, 0));
        drobj.DrawPixel(DrawLib::FPPoint(s - 70, s - 10), DrawLib::Pixel32(200, 200, 0));

        BLEX_TEST_CHECK( DoCompare("ref-path_stokingfilling_rounding.png", mybitmap, true) );
}

DrawLib::FPPoint RoundedPoint(DrawLib::FPPoint const& p)
{
        return DrawLib::FPPoint(floor(p.x + 0.5), floor(p.y + 0.5));
}
/*
BLEX_TEST_FUNCTION(Path_PerfectEllipse_Test)
{
        DrawLib::Bitmap32 mybitmap(43, 41);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);


        drobj.SetOutlineColor(DrawLib::Pixel32(255, 0, 0));
        drobj.SetFillColor   (DrawLib::Pixel32(0, 0, 255));

        DrawLib::Path mypath;

        mypath.Ellipse(DrawLib::FPPoint(10, 20), DrawLib::FPPoint(10, 20));
        mypath.Ellipse(DrawLib::FPPoint(32, 20), DrawLib::FPPoint(10, 20));

        drobj.SetPolyEdgeMode(true);
        drobj./ *StrokeAnd* /FillPath(mypath);

        std::vector<DrawLib::PolyLine> poly_polyline;
        mypath.ConvertToPolylines(&poly_polyline);

        for(unsigned i=0; i<poly_polyline[0].points.size(); ++i)
        {
                drobj.DrawPixel(RoundedPoint(poly_polyline[0].points[i]), DrawLib::Pixel32(255, 255, 0));
        }

        drobj.DrawLine(
                DrawLib::FPPoint( 5, 20),
                DrawLib::FPPoint( 7, 16));
        drobj.DrawLine(
                DrawLib::FPPoint(15, 20),
                DrawLib::FPPoint(13, 16));
        drobj.DrawPixel(RoundedPoint(DrawLib::FPPoint( 5, 20)), DrawLib::Pixel32(255, 255, 0));
        drobj.DrawPixel(RoundedPoint(DrawLib::FPPoint( 7, 16)), DrawLib::Pixel32(255, 255, 0));
        drobj.DrawPixel(RoundedPoint(DrawLib::FPPoint(15, 20)), DrawLib::Pixel32(255, 255, 0));
        drobj.DrawPixel(RoundedPoint(DrawLib::FPPoint(13, 16)), DrawLib::Pixel32(255, 255, 0));

        BLEX_TEST_CHECK( DoCompare("path_perfect_ellipse.png", mybitmap, true) );
}
*/


BLEX_TEST_FUNCTION(Critical_Line_Versus_Polygon)
{
        /*
           Bij deze test wordt een lijn getekend met een zelfde begin-
           en eindpunt als een linker rand van een polygon. Het is hierbij
           natuurliujk de bedoeling dat de pixels die voor de lijn getekend
           worden, precies liggen op de pixels, die de linker pixels vormen
           van de delen van de scanlines die getekend worden voor de
           polygoon.

        */

        DrawLib::Bitmap32 mybitmap(692, 1068);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // White background:
        drobj.SetFillColor   (DrawLib::Pixel32(255, 255, 255));
        drobj.DrawRectangle(
                DrawLib::FPPoint(   0,   0),
                DrawLib::FPPoint( 693,1069));

        drobj.SetOutlineColor(DrawLib::Pixel32(  0,   0,   0));
        drobj.SetFillColor   (DrawLib::Pixel32(  0,   0, 255));

        int x_off = 435;
        int y_off = 815;

        DrawLib::FPPoint pb(x_off +   0, y_off + 156); // Begin
        DrawLib::FPPoint pe(x_off +  90, y_off +   0); // Eind
        DrawLib::FPPoint po(x_off + 150, y_off + 150); // Overstaand

        DrawLib::Polygon polygon;
        polygon.points.push_back(pb);
        polygon.points.push_back(pe);
        polygon.points.push_back(po);
        drobj.DrawPolygon(polygon);

        drobj.DrawLine(pb, pe);

        BLEX_TEST_CHECK( DoCompare("ref-critical_line_versus_polygon.png", mybitmap, true) );
}
