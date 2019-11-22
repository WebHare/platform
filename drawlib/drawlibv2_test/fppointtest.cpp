#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"

BLEX_TEST_FUNCTION(FPPointTest)
{
        DrawLib::FPPoint vector(3,4);

        // test == compare functions for FPPoint
        BLEX_TEST_CHECK(DrawLib::FPPoint(3,4) == vector);
        BLEX_TEST_CHECK(! (DrawLib::FPPoint(3,4) != vector) );

        // test the Norm function of FPPoint
        BLEX_TEST_CHECKEQUAL(5.0, vector.Norm());

        // test the Normaliez function of FPPoint
        vector.Normalize();
        BLEX_TEST_CHECK( fabs(vector.Norm()-1.0)<=1e-6);

        // test the + operator for FPPoint
        DrawLib::FPPoint plus = DrawLib::FPPoint(1,2) + DrawLib::FPPoint(3,4);
        BLEX_TEST_CHECK(DrawLib::FPPoint(4,6) == plus);

        // test the * operator for FPPoint
        DrawLib::FPPoint mult = DrawLib::FPPoint(5,6) * 10.0;
        BLEX_TEST_CHECK(DrawLib::FPPoint(50,60)== mult);
}

BLEX_TEST_FUNCTION(TestPixel32)
{
        using DrawLib::Pixel32;

        //Create a colour
        Pixel32 mycolor;

        //Test setting of the channels
        mycolor = Pixel32(1,2,3,4);
        BLEX_TEST_CHECKEQUAL(uint8_t(1),mycolor.GetR());
        BLEX_TEST_CHECKEQUAL(uint8_t(2),mycolor.GetG());
        BLEX_TEST_CHECKEQUAL(uint8_t(3),mycolor.GetB());
        BLEX_TEST_CHECKEQUAL(uint8_t(4),mycolor.GetA());

        //Test reading from memory
        uint8_t memcolor[4] = {5,6,7,8};
        mycolor = Pixel32::GetRedFirst(memcolor);
        BLEX_TEST_CHECKEQUAL(uint8_t(5),mycolor.GetR());
        BLEX_TEST_CHECKEQUAL(uint8_t(6),mycolor.GetG());
        BLEX_TEST_CHECKEQUAL(uint8_t(7),mycolor.GetB());
        BLEX_TEST_CHECKEQUAL(uint8_t(8),mycolor.GetA());

        //Test reading from memory, reversed
        uint8_t revmemcolor[4] = {9,10,11,12};
        mycolor = Pixel32::GetAlphaFirst(revmemcolor);
        BLEX_TEST_CHECKEQUAL(uint8_t(12),mycolor.GetR());
        BLEX_TEST_CHECKEQUAL(uint8_t(11),mycolor.GetG());
        BLEX_TEST_CHECKEQUAL(uint8_t(10),mycolor.GetB());
        BLEX_TEST_CHECKEQUAL(uint8_t(9),mycolor.GetA());

        //Test reading from memory, inversed alpha
        uint8_t imemcolor[4] = {13,14,15,16};
        mycolor = Pixel32::GetRedFirstInverseAlpha(imemcolor);
        BLEX_TEST_CHECKEQUAL(uint8_t(13),mycolor.GetR());
        BLEX_TEST_CHECKEQUAL(uint8_t(14),mycolor.GetG());
        BLEX_TEST_CHECKEQUAL(uint8_t(15),mycolor.GetB());
        BLEX_TEST_CHECKEQUAL(uint8_t(239),mycolor.GetA());

        //Test reading from memory, reversed, inversed alpha
        uint8_t revimemcolor[4] = {17,18,19,20};
        mycolor = Pixel32::GetAlphaFirstInverseAlpha(revimemcolor);
        BLEX_TEST_CHECKEQUAL(uint8_t(235),mycolor.GetR());
        BLEX_TEST_CHECKEQUAL(uint8_t(19),mycolor.GetG());
        BLEX_TEST_CHECKEQUAL(uint8_t(18),mycolor.GetB());
        BLEX_TEST_CHECKEQUAL(uint8_t(17),mycolor.GetA());

        //Test the equality test
        Pixel32 secondcolor(13,14,15,16);
        BLEX_TEST_CHECKEQUAL(mycolor, Pixel32(235,19,18,17));
        BLEX_TEST_CHECK(mycolor != secondcolor);

        //Test transparancy
        BLEX_TEST_CHECKEQUAL(true,  Pixel32(8,16,24,0).IsFullyTransparent() );
        BLEX_TEST_CHECKEQUAL(false, Pixel32(8,16,24,1).IsFullyTransparent() );
        BLEX_TEST_CHECKEQUAL(false, Pixel32(8,16,24,255).IsFullyTransparent() );
}

