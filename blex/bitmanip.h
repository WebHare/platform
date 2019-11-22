#ifndef blex_bitmanip
#define blex_bitmanip

#ifndef blex_blexlib
#include "blexlib.h"
#endif

namespace Blex {

/// Preferred types for bitmaps (should be the best-suited system type)
typedef uint32_t BitmapType;
/// Bitmap pointer type
typedef uint32_t* Bitmap;
/// Bitmap constant pointer type
typedef uint32_t const * ConstBitmap;

/// Platform independent bitmap type (no LSB/MSB issues)
typedef uint8_t IndependentBitmapType;
/// Bitmap pointer type
typedef uint8_t* IndependentBitmap;
/// Bitmap constant pointer type
typedef uint8_t const * IndependentConstBitmap;

namespace Detail {

/// Number of bits that fit in a BitmapType
const unsigned BitsPerBitmapType = sizeof(BitmapType) * 8 /* CHAR_BIT */;

/// Number of bits that fit in a IndependentBitmapType
const unsigned IndependentBitsPerBitmapType = sizeof(IndependentBitmapType) * 8 /* CHAR_BIT */;

/// Get the location of a bit's container in a range of BitmapType
inline unsigned GetBitOffset(unsigned bitnum)
{
        return bitnum / BitsPerBitmapType;
}

/// Get the location of a bit's container in a range of IndependentBitmapType
inline unsigned IndependentGetBitOffset(unsigned bitnum)
{
        return bitnum / IndependentBitsPerBitmapType;
}

/// Get the MASK of a bit in a BitmapType
inline unsigned GetBitMask(unsigned bitnum)
{
        return 1 << (bitnum % BitsPerBitmapType);
}

/// Get the MASK of a bit in a IndependentBitmapType
inline unsigned IndependentGetBitMask(unsigned bitnum)
{
        return 1 << (bitnum % IndependentBitsPerBitmapType);
}

} //end namespace Detail

/** Given a number of bits, return the required number of BitmapTypes. You
    need this to get the size for which to initialize a vector<BitMapTypes> */
inline unsigned BitmapRequiredSize(unsigned numbits)
{
        return (numbits + Detail::BitsPerBitmapType - 1)/ Detail::BitsPerBitmapType;
}

/** Given a number of bits, return the required number of IndependentBitmapTypes.
    You need this to get the size for which to initialize a vector<IndependentBitMapTypes> */
inline unsigned IndependentBitmapRequiredSize(unsigned numbits)
{
        return (numbits + Detail::IndependentBitsPerBitmapType - 1) / Detail::IndependentBitsPerBitmapType;
}

/** A macro version of BitmapRequiredSize, for use in constant expressions.
    You need this to set a size for a BitMapTypes[] array */
#define BLEX_BITMAPREQUIREDSIZE(numbits) ( (numbits) / ::Blex::Detail::BitsPerBitmapType )

/** Given a number of BitmapTypes, return the capacity for bits */
inline unsigned BitmapCapacity(unsigned bitmaptypes)
{
        return bitmaptypes * Detail::BitsPerBitmapType;
}

/** Given a number of IndependentBitmapTypes, return the capacity for bits */
inline unsigned IndependentBitmapCapacity(unsigned bitmaptypes)
{
        return bitmaptypes * Detail::BitsPerBitmapType;
}

/** @short Get the value of bit #bitnum in the bitmap at 'bitmap'.
    @long Bits 0-31 are in byte 0, bits 32-63 in byte 1, etc. Inside each byte,
          bits are numbered from right-to-left - bit 0 is 2^0, bit 1 is 2^1, bit 2 is 2^2 (etc).
         For example, GetBit(bitmap,33) returns the value of bit 1 at bitmap[1].
         All Bitmanip functions work properly over byte boundaries.
    @param bitmap Bitmap data to read from
    @param bitnum Number of the bit to read */
inline bool GetBit(ConstBitmap bitmap,unsigned bitnum)
{
        return bitmap[Detail::GetBitOffset(bitnum)] & Detail::GetBitMask(bitnum) ? true : false;
}
/** @short Get the value of bit #bitnum in the bitmap at 'bitmap'.
    @long Bits 0-7 are in byte 0, bits 8-15 in byte 1, etc. Inside each byte, bits are numbered
    from right-to-left - bit 0 is 2^0, bit 1 is 2^1, bit 2 is 2^2 (etc).
    For example, GetBit(bitmap,33) returns the value of bit 1 at bitmap[1].
     All Bitmanip functions work properly over byte boundaries.
    @param bitmap Bitmap data to read from
    @param bitnum Number of the bit to read */
inline bool GetBit(IndependentConstBitmap bitmap,unsigned bitnum)
{
        return bitmap[Detail::IndependentGetBitOffset(bitnum)] & Detail::IndependentGetBitMask(bitnum) ? true : false;
}


/** @short Set the value of bit #bitnum in the bitmap at 'bitmap'.
    @long For example, SetBit(bitmap,33) sets the value of bit 1 at bitmap[1].
          All Bitmanip functions work properly over byte boundaries.
    @param bitmap Bitmap data to read from
    @param bitnum Number of the bit to read
    @param value New value for the bit */
inline void SetBit(Bitmap bitmap,unsigned bitnum,bool value)
{
        if (value) //set a bit
            bitmap[Detail::GetBitOffset(bitnum)] |= Detail::GetBitMask(bitnum);
        else
            bitmap[Detail::GetBitOffset(bitnum)] &= ~Detail::GetBitMask(bitnum);
}
inline void SetBit(IndependentBitmap bitmap,unsigned bitnum,bool value)
{
        if (value) //set a bit
            bitmap[Detail::IndependentGetBitOffset(bitnum)] |= IndependentBitmapType(Detail::IndependentGetBitMask(bitnum));
        else
            bitmap[Detail::IndependentGetBitOffset(bitnum)] &= IndependentBitmapType(~Detail::IndependentGetBitMask(bitnum));
}

/** Set the value of a range of bits to the specified value.
    All Bitmanip functions work properly over byte boundaries.
    @param bitmap Bitmap to modify
    @param firstbit First bit# to set
    @param numbits Number of bits to set
    @param value Value for the set bits */
void BLEXLIB_PUBLIC SetBits(Bitmap bitmap,unsigned firstbit,unsigned numbits,bool value);

/** @short Get the first set bit in the range [start, end>. Return end if not found
    @param bitmap Bitmap data to read from
    @param start Bit to start the search at
    @param end Bit to stop the search at
    @return Index of first non-zero bit, or end if not found.
*/
unsigned BLEXLIB_PUBLIC FindFirstSetBit(ConstBitmap bitmap, unsigned start, unsigned end);

} //end namespace Blex

#endif

