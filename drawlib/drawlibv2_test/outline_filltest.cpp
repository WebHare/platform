#include <drawlib/drawlibv2/allincludes.h>


#include "helperfuncs.h"
#include <drawlib/drawlibv2/drawobject.h>

BLEX_TEST_FUNCTION(ThinLineTest)
{
/* FIXME fails on vz101
        //make a bitmap!
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.SetOutlineWidth(1.0);
        drobj.SetFillColor   (DrawLib::Pixel32(0xFF,0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0,0xFF));

        double dividor           = 2.0;
        int   space_between     = 3;
        for (int i=0; i<=100; i++)
        {

                drobj.DrawThinLine (DrawLib::FPPoint (10,10+i*space_between), DrawLib::FPPoint((double)i/dividor,10+i*space_between));
                drobj.DrawRectangle(DrawLib::FPPoint (10,11+i*space_between), DrawLib::FPPoint((double)i/dividor,12+i*space_between));

        }

        for (int i=0; i<=100; i++)
        {

                drobj.DrawThinLine  (DrawLib::FPPoint (100+i*space_between,10), DrawLib::FPPoint(100+i*space_between,(double)i/dividor));
                drobj.DrawRectangle (DrawLib::FPPoint (101+i*space_between,10), DrawLib::FPPoint(102+i*space_between,(double)i/dividor));
        }

        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0xFF, 0xFF));
        drobj.DrawThinLine  (DrawLib::FPPoint (100, 100), DrawLib::FPPoint(300,100));
        drobj.DrawThinLine  (DrawLib::FPPoint (100, 300), DrawLib::FPPoint(300,300));
        drobj.DrawThinLine  (DrawLib::FPPoint (200, 25), DrawLib::FPPoint(200,375));

        for (int i=-75; i<=75; i++)
        {
                if ( (i%10) ==0 )
                {
                        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0,0xFF));
                        drobj.SetFillColor   (DrawLib::Pixel32(0xFF,0xFF,0,0xFF));
                }
                else
                {
                        drobj.SetOutlineColor(DrawLib::Pixel32(0x00,0x00,0xFF,0xFF));
                        drobj.SetFillColor   (DrawLib::Pixel32(0x00,0x00,0xFF,0xFF));
                }
                drobj.DrawThinLine(DrawLib::FPPoint (200+i*2,100), DrawLib::FPPoint(200+i*2,100+(double)i/(10.0)));
                drobj.DrawRectangle(DrawLib::FPPoint (200+i*2,300), DrawLib::FPPoint(200+i*2+1,300+(double)i/(10.0)));
         }

        for (int i=-35; i<=35; i++)
        {
                if ( (i%10) ==0 )
                {
                        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0,0xFF));
                        drobj.SetFillColor   (DrawLib::Pixel32(0xFF,0xFF,0,0xFF));
                }
                else
                {
                        drobj.SetOutlineColor(DrawLib::Pixel32(0x00,0x00,0xFF,0xFF));
                        drobj.SetFillColor   (DrawLib::Pixel32(0x00,0x00,0xFF,0xFF));
                }

                drobj.DrawThinLine( DrawLib::FPPoint (200, 100+i*2), DrawLib::FPPoint(200+(double)i/(10.0),100+i*2));
                drobj.DrawThinLine( DrawLib::FPPoint(200+(double)i/(10.0),1+100+i*2), DrawLib::FPPoint (200, 1+100+i*2) );

                drobj.DrawRectangle(DrawLib::FPPoint (200, 300+i*2), DrawLib::FPPoint(200+(double)i/(10.0),300+i*2+1));

                //points in other order? doesn't make a difference luckyly.
                drobj.DrawRectangle(DrawLib::FPPoint(200+(double)i/(10.0),300+i*2+2), DrawLib::FPPoint (200, 300+i*2+1) );

        }

        BLEX_TEST_CHECK( DoCompare ("thinline.png", mybitmap, true));
*/
}

BLEX_TEST_FUNCTION(FillerBugTest)
{
        //make a bitmap!
        DrawLib::Bitmap32 mybitmap(300,150,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.SetOutlineWidth(5.0);
        drobj.SetFillColor   (DrawLib::Pixel32(0xFF,0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0,0xFF));

        DrawLib::Path mypath;
        mypath.MoveTo(DrawLib::FPPoint(0,0));
        mypath.LineTo(DrawLib::FPPoint(100,100));
        mypath.LineTo(DrawLib::FPPoint(20,100));
        mypath.ClosePath();

        drobj.StrokePath(mypath);

        mypath.ApplyTransform(DrawLib::XForm2D(1,0,0,1, DrawLib::FPPoint(150,0)));
        drobj.StrokePath(mypath);

        BLEX_TEST_CHECK( DoCompare("ref-fillerbug.png", mybitmap, true));
}
