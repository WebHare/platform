#include <blex/blexlib.h>

#include "bitmanip.h"

namespace Blex
{

void SetBits(Bitmap bitmap,unsigned firstbit,unsigned numbits,bool value)
{
        //ADDME: Correct but slow
        for (unsigned i=firstbit;i<firstbit+numbits;++i)
            SetBit(bitmap,i,value);

        /* This code may be a starting point for implementing an optimized
        version, but note that as presented, it has a bugs!

        // build bit masks
        beginmask = 0xFF >> (left & 0x07);
        endmask   = 0xFF >> (7-(right & 0x07));
        // calculate the number of full 8 bit bytes
        inbetween = (right >> 3) - (left >> 3) - 1;
        //inbetween = (right >> 3) - (left >> 3);
        //calculate offset into bitmap buffer
        startaddress = y*nextlinedelta + (left >> 3);

        // check for a small run..
        if ((right-left) > 8)
        {
                // this is are 'large' run
                //if (beginmask!= 255) bitmap[startaddress++] = bitmap[startaddress] | beginmask;
                bitmap[startaddress++] = bitmap[startaddress] | beginmask;
                for(uint32_t i=0; i<inbetween; i++)
                {
                        bitmap[startaddress++] = 0xFF;
                }
                bitmap[startaddress] = bitmap[startaddress] | endmask;
        }
        else
        {
                // 'small' run
                // combine beginmask and endmask
                bitmap[startaddress] = bitmap[startaddress] | (beginmask & endmask);
        }

        // Rob: This code could probably be used, though it is not tested
        unsigned limitbit = firstbit + numbits;
        uint8_t *begin = firstbit >> 3;
        uint8_t *last = (limitbit - 1) >> 3;
        uint8_t begin_mask = 0xFF >> (first & 0x07);
        uint8_t last_mask = (0x7F80 >> ((limitbit + 7) & 0x07)) & 0xFF;

        if (begin >= last)
        {
                uint8_t mask = begin_mask & end_mask;
                if (value)
                    bitmap[begin] = bitmap[begin] | mask;
                else
                    bitmap[begin] = bitmap[begin] & ~mask;
        }
        else
        {
                if (value)
                {
                        bitmap[begin] = bitmap[begin] | begin_mask;
                        bitmap[last] = bitmap[last] | last_mask;
                }
                else
                {
                        bitmap[begin] = bitmap[begin] & ~begin_mask;
                        bitmap[last] = bitmap[last] & ~last_mask;
                }
                std::fill(begin + 1, end - 1, value ? 0xFF, 0);
        }

        */
}

unsigned FindFirstSetBit(ConstBitmap bitmap, unsigned start, unsigned end)
{
      unsigned bound_start = (start + Detail::BitsPerBitmapType - 1) & ~(Detail::BitsPerBitmapType-1);
      unsigned bound_end = end & ~(Detail::BitsPerBitmapType-1);

      unsigned idx = start;
      if (bound_start < bound_end)
      {
            for (idx = start; idx < bound_start; ++idx)
                if (Blex::GetBit(bitmap, idx))
                    break;

            if (idx != bound_start)
                return idx;

            // Find first non-0 word. The end bound iterator will find the precize bit
            unsigned ofs = Detail::GetBitOffset(idx);
            for (; idx < bound_end; idx += Detail::BitsPerBitmapType, ++ofs)
                if (bitmap[ofs])
                    break;
      }

      for (; idx < end; ++idx)
          if (Blex::GetBit(bitmap, idx))
              break;

      return idx;
}

} //end namespace Blex

