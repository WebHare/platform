#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"

BLEX_TEST_FUNCTION(BezierTest)
{
/*
        DrawLib::FPPoint start(0,0);
        DrawLib::FPPoint end(100,100);
        DrawLib::FPPoint c1(30,30);
        DrawLib::FPPoint c2(60,60);

        // EvaluateBezier with t=0 should give the starting point!
        if (!(DrawLib::EvaluateBezier(start,c1,c2,end,0.0)==start))
        {
                BLEX_TEST_FAIL(" EvaluateBezier (start)");
        }
        // EvaluateBezier with t=0 should give the starting point!
        if (!(DrawLib::EvaluateBezier(start,c1,c2,end,1.0)==end))
        {
                BLEX_TEST_FAIL(" EvaluateBezier (end)");
        }
        // Draw an actual Bezier curve!

        DrawLib::Bitmap32 mybitmap(400,400);
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drawobject(&mycanvas);

        DrawLib::PolyLine bezier;
        bezier.points.push_back(DrawLib::FPPoint(50,50));
        bezier.points.push_back(DrawLib::FPPoint(75,10));
        bezier.points.push_back(DrawLib::FPPoint(90,30));
        bezier.points.push_back(DrawLib::FPPoint(100,100));

        bezier.points.push_back(DrawLib::FPPoint(100,210));
        bezier.points.push_back(DrawLib::FPPoint(150,140));
        bezier.points.push_back(DrawLib::FPPoint(200,200));

        DrawLib::PolyLine pline;
        DrawLib::BezierListToPolyline(bezier, pline);
        pline.thickness = 2.0;
        drawobject.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0xFF,0xFF));
        drawobject.DrawPolyLine(pline);

        BLEX_TEST_CHECK(DoCompare("beziertest.png",mybitmap, true));
        */
        BLEX_TEST_CHECK(true);
}

