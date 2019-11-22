//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include <climits>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../bitmanip.h"

BLEX_TEST_FUNCTION(TestBasics)
{
        /* Ensure proper calculations and rounding */
        BLEX_TEST_CHECKEQUAL(1u,Blex::BitmapRequiredSize(Blex::BitmapCapacity(1)-1));

        Blex::BitmapType bitmap[BLEX_BITMAPREQUIREDSIZE(128)];

        BLEX_TEST_CHECKEQUAL(128u / CHAR_BIT, sizeof bitmap);
        BLEX_TEST_CHECKEQUAL(128u, Blex::BitmapCapacity(sizeof bitmap / sizeof (*bitmap)));
        BLEX_TEST_CHECKEQUAL(sizeof bitmap / sizeof (*bitmap), Blex::BitmapRequiredSize(128));

        /* Fill with zeros */
        for (unsigned i=0;i<128;++i)
            Blex::SetBit(bitmap,i,false);

        /* Verify that it's filled with zeros */
        for (unsigned i=0;i<128;++i)
            BLEX_TEST_CHECKEQUAL(false, Blex::GetBit(bitmap,i));

        /* Test setting edge individual bits */
        Blex::SetBit(bitmap,0,true);
        for (unsigned i=0;i<128;++i)
            BLEX_TEST_CHECKEQUAL(i == 0 ? true : false , Blex::GetBit(bitmap,i));

        Blex::SetBit(bitmap,0,false);
        Blex::SetBit(bitmap,127,true);
        for (unsigned i=0;i<128;++i)
            BLEX_TEST_CHECKEQUAL(i == 127 ? true : false , Blex::GetBit(bitmap,i));
        Blex::SetBit(bitmap,127,false);

        /* Test setting some individual bits, try to have them overlap a BitmapType */
        for (unsigned testbit = 55; testbit < 75; ++testbit)
        {
                Blex::SetBit(bitmap,testbit,true);
                for (unsigned i=0;i<128;++i)
                    BLEX_TEST_CHECKEQUAL(i == testbit ? true : false , Blex::GetBit(bitmap,i));
                Blex::SetBit(bitmap,testbit,false);
        }
}

void TestBitmanipFills()
{
        Blex::BitmapType bitmap[BLEX_BITMAPREQUIREDSIZE(128)];

        /* Fill with zeroes */
        Blex::SetBits(bitmap,0,128,false);

        /* Verify that it's filled with zeros */
        for (unsigned i=0;i<128;++i)
            BLEX_TEST_CHECKEQUAL(false, Blex::GetBit(bitmap,i));

        /* Fill bits [55,75[ */
        Blex::SetBits(bitmap,55,20,true);

        /* Verify that it's filled properly */
        for (unsigned i=0;i<128;++i)
            BLEX_TEST_CHECKEQUAL(i>=55 && i<75 ? true : false, Blex::GetBit(bitmap,i));

        /* Fill bits [60,70[ with 0s */
        Blex::SetBits(bitmap,60,10,false);

        /* Verify that it's filled properly */
        for (unsigned i=55;i<75;++i)
            BLEX_TEST_CHECKEQUAL(i<60 || i>=70 ? true : false, Blex::GetBit(bitmap,i));
}

void TestBitmanipSearches()
{
        Blex::BitmapType bitmap[BLEX_BITMAPREQUIREDSIZE(128)];

        /* Fill with zeroes */
        Blex::SetBits(bitmap,0,128,false);

        BLEX_TEST_CHECKEQUAL(128, Blex::FindFirstSetBit(bitmap, 0, 128));
        Blex::SetBit(bitmap, 127, true);
        BLEX_TEST_CHECKEQUAL(127, Blex::FindFirstSetBit(bitmap, 0, 128));
        Blex::SetBit(bitmap, 126, true);
        BLEX_TEST_CHECKEQUAL(126, Blex::FindFirstSetBit(bitmap, 0, 127));
        Blex::SetBit(bitmap, 64, true);
        BLEX_TEST_CHECKEQUAL(64, Blex::FindFirstSetBit(bitmap, 0, 127));
        Blex::SetBit(bitmap, 63, true);
        BLEX_TEST_CHECKEQUAL(63, Blex::FindFirstSetBit(bitmap, 0, 127));
        BLEX_TEST_CHECKEQUAL(63, Blex::FindFirstSetBit(bitmap, 1, 127));
        BLEX_TEST_CHECKEQUAL(63, Blex::FindFirstSetBit(bitmap, 31, 127));
        BLEX_TEST_CHECKEQUAL(63, Blex::FindFirstSetBit(bitmap, 32, 127));
        BLEX_TEST_CHECKEQUAL(63, Blex::FindFirstSetBit(bitmap, 63, 127));
        BLEX_TEST_CHECKEQUAL(64, Blex::FindFirstSetBit(bitmap, 64, 127));
        BLEX_TEST_CHECKEQUAL(127, Blex::FindFirstSetBit(bitmap, 127, 127));
        BLEX_TEST_CHECKEQUAL(64, Blex::FindFirstSetBit(bitmap, 64, 65));
        BLEX_TEST_CHECKEQUAL(66, Blex::FindFirstSetBit(bitmap, 65, 66));
        Blex::SetBit(bitmap, 66, true);
        BLEX_TEST_CHECKEQUAL(66, Blex::FindFirstSetBit(bitmap, 65, 66));
}
