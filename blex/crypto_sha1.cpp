#include <blex/blexlib.h>


#include "crypto.h"

#define SHS_DATASIZE 64
#define f1(x,y,z)   ( z ^ ( x & ( y ^ z ) ) )           /* Rounds  0-19 */
#define f2(x,y,z)   ( x ^ y ^ z )                       /* Rounds 20-39 */
#define f3(x,y,z)   ( ( x & y ) | ( z & ( x | y ) ) )   /* Rounds 40-59 */
#define f4(x,y,z)   ( x ^ y ^ z )                       /* Rounds 60-79 */
#define K1  0x5A827999L                                 /* Rounds  0-19 */
#define K2  0x6ED9EBA1L                                 /* Rounds 20-39 */
#define K3  0x8F1BBCDCL                                 /* Rounds 40-59 */
#define K4  0xCA62C1D6L                                 /* Rounds 60-79 */
#define ROTL(n,X)  ( ( ( X ) << n ) | ( ( X ) >> ( 32 - n ) ) )
#define expand(W,i) ( W[ i & 15 ] = ROTL( 1, ( W[ i & 15 ] ^ W[ (i - 14) & 15 ] ^ W[ (i - 8) & 15 ] ^ W[ (i - 3) & 15 ] ) ) )
#define subRound(a, b, c, d, e, f, k, data) ( e += ROTL( 5, a ) + f( b, c, d ) + k + data, b = ROTL( 30, b ) )


namespace Blex {

SHA1::SHA1()
{
        digest[0]=0x67452301L;
        digest[1]=0xEFCDAB89L;
        digest[2]=0x98BADCFEL;
        digest[3]=0x10325476L;
        digest[4]=0xC3D2E1F0L;
        countlo=0;
        counthi=0;
}

static void AllToMSB(uint32_t *buffer, unsigned longcount)
{
        while (longcount-- > 0)
        {
                uint32_t val = *buffer;
                val = ((val&0xFF00FF00L)>>8) | ((val&0x00FF00FFL)<<8);
                *buffer++ = (val<<16) | (val>>16);
        }
}

static void SHA1Transform(uint32_t *digest, uint32_t *data)
{
        uint32_t A, B, C, D, E;     /* Local vars */
        uint32_t eData[ 16 ];       /* Expanded data */

        /* Set up first buffer and local data buffer */
        A = digest[ 0 ];
        B = digest[ 1 ];
        C = digest[ 2 ];
        D = digest[ 3 ];
        E = digest[ 4 ];
        memcpy( eData, data, SHS_DATASIZE );

        /* Heavy mangling, in 4 sub-rounds of 20 interations each. */
        subRound( A, B, C, D, E, f1, K1, eData[  0 ] );
        subRound( E, A, B, C, D, f1, K1, eData[  1 ] );
        subRound( D, E, A, B, C, f1, K1, eData[  2 ] );
        subRound( C, D, E, A, B, f1, K1, eData[  3 ] );
        subRound( B, C, D, E, A, f1, K1, eData[  4 ] );
        subRound( A, B, C, D, E, f1, K1, eData[  5 ] );
        subRound( E, A, B, C, D, f1, K1, eData[  6 ] );
        subRound( D, E, A, B, C, f1, K1, eData[  7 ] );
        subRound( C, D, E, A, B, f1, K1, eData[  8 ] );
        subRound( B, C, D, E, A, f1, K1, eData[  9 ] );
        subRound( A, B, C, D, E, f1, K1, eData[ 10 ] );
        subRound( E, A, B, C, D, f1, K1, eData[ 11 ] );
        subRound( D, E, A, B, C, f1, K1, eData[ 12 ] );
        subRound( C, D, E, A, B, f1, K1, eData[ 13 ] );
        subRound( B, C, D, E, A, f1, K1, eData[ 14 ] );
        subRound( A, B, C, D, E, f1, K1, eData[ 15 ] );
        subRound( E, A, B, C, D, f1, K1, expand( eData, 16 ) );
        subRound( D, E, A, B, C, f1, K1, expand( eData, 17 ) );
        subRound( C, D, E, A, B, f1, K1, expand( eData, 18 ) );
        subRound( B, C, D, E, A, f1, K1, expand( eData, 19 ) );

        subRound( A, B, C, D, E, f2, K2, expand( eData, 20 ) );
        subRound( E, A, B, C, D, f2, K2, expand( eData, 21 ) );
        subRound( D, E, A, B, C, f2, K2, expand( eData, 22 ) );
        subRound( C, D, E, A, B, f2, K2, expand( eData, 23 ) );
        subRound( B, C, D, E, A, f2, K2, expand( eData, 24 ) );
        subRound( A, B, C, D, E, f2, K2, expand( eData, 25 ) );
        subRound( E, A, B, C, D, f2, K2, expand( eData, 26 ) );
        subRound( D, E, A, B, C, f2, K2, expand( eData, 27 ) );
        subRound( C, D, E, A, B, f2, K2, expand( eData, 28 ) );
        subRound( B, C, D, E, A, f2, K2, expand( eData, 29 ) );
        subRound( A, B, C, D, E, f2, K2, expand( eData, 30 ) );
        subRound( E, A, B, C, D, f2, K2, expand( eData, 31 ) );
        subRound( D, E, A, B, C, f2, K2, expand( eData, 32 ) );
        subRound( C, D, E, A, B, f2, K2, expand( eData, 33 ) );
        subRound( B, C, D, E, A, f2, K2, expand( eData, 34 ) );
        subRound( A, B, C, D, E, f2, K2, expand( eData, 35 ) );
        subRound( E, A, B, C, D, f2, K2, expand( eData, 36 ) );
        subRound( D, E, A, B, C, f2, K2, expand( eData, 37 ) );
        subRound( C, D, E, A, B, f2, K2, expand( eData, 38 ) );
        subRound( B, C, D, E, A, f2, K2, expand( eData, 39 ) );

        subRound( A, B, C, D, E, f3, K3, expand( eData, 40 ) );
        subRound( E, A, B, C, D, f3, K3, expand( eData, 41 ) );
        subRound( D, E, A, B, C, f3, K3, expand( eData, 42 ) );
        subRound( C, D, E, A, B, f3, K3, expand( eData, 43 ) );
        subRound( B, C, D, E, A, f3, K3, expand( eData, 44 ) );
        subRound( A, B, C, D, E, f3, K3, expand( eData, 45 ) );
        subRound( E, A, B, C, D, f3, K3, expand( eData, 46 ) );
        subRound( D, E, A, B, C, f3, K3, expand( eData, 47 ) );
        subRound( C, D, E, A, B, f3, K3, expand( eData, 48 ) );
        subRound( B, C, D, E, A, f3, K3, expand( eData, 49 ) );
        subRound( A, B, C, D, E, f3, K3, expand( eData, 50 ) );
        subRound( E, A, B, C, D, f3, K3, expand( eData, 51 ) );
        subRound( D, E, A, B, C, f3, K3, expand( eData, 52 ) );
        subRound( C, D, E, A, B, f3, K3, expand( eData, 53 ) );
        subRound( B, C, D, E, A, f3, K3, expand( eData, 54 ) );
        subRound( A, B, C, D, E, f3, K3, expand( eData, 55 ) );
        subRound( E, A, B, C, D, f3, K3, expand( eData, 56 ) );
        subRound( D, E, A, B, C, f3, K3, expand( eData, 57 ) );
        subRound( C, D, E, A, B, f3, K3, expand( eData, 58 ) );
        subRound( B, C, D, E, A, f3, K3, expand( eData, 59 ) );

        subRound( A, B, C, D, E, f4, K4, expand( eData, 60 ) );
        subRound( E, A, B, C, D, f4, K4, expand( eData, 61 ) );
        subRound( D, E, A, B, C, f4, K4, expand( eData, 62 ) );
        subRound( C, D, E, A, B, f4, K4, expand( eData, 63 ) );
        subRound( B, C, D, E, A, f4, K4, expand( eData, 64 ) );
        subRound( A, B, C, D, E, f4, K4, expand( eData, 65 ) );
        subRound( E, A, B, C, D, f4, K4, expand( eData, 66 ) );
        subRound( D, E, A, B, C, f4, K4, expand( eData, 67 ) );
        subRound( C, D, E, A, B, f4, K4, expand( eData, 68 ) );
        subRound( B, C, D, E, A, f4, K4, expand( eData, 69 ) );
        subRound( A, B, C, D, E, f4, K4, expand( eData, 70 ) );
        subRound( E, A, B, C, D, f4, K4, expand( eData, 71 ) );
        subRound( D, E, A, B, C, f4, K4, expand( eData, 72 ) );
        subRound( C, D, E, A, B, f4, K4, expand( eData, 73 ) );
        subRound( B, C, D, E, A, f4, K4, expand( eData, 74 ) );
        subRound( A, B, C, D, E, f4, K4, expand( eData, 75 ) );
        subRound( E, A, B, C, D, f4, K4, expand( eData, 76 ) );
        subRound( D, E, A, B, C, f4, K4, expand( eData, 77 ) );
        subRound( C, D, E, A, B, f4, K4, expand( eData, 78 ) );
        subRound( B, C, D, E, A, f4, K4, expand( eData, 79 ) );

        /* Build message digest */
        digest[ 0 ] += A;
        digest[ 1 ] += B;
        digest[ 2 ] += C;
        digest[ 3 ] += D;
        digest[ 4 ] += E;
}

void SHA1::Process(const void *buffer,unsigned count)
{
        /* Update bitcount */
        uint32_t tmp = countlo;
        if ( ( countlo = tmp + ( ( uint32_t ) count << 3 ) ) < tmp )
            counthi++;             /* Carry from low to high */
        counthi += count >> 29;

        /* Get count of bytes already in data */
        unsigned data_count = ( unsigned ) ( tmp >> 3 ) & 0x3F;

        /* Handle any leading odd-sized chunks */
        if( data_count )
        {
                uint8_t *p = reinterpret_cast<uint8_t *>(data) + data_count;
                data_count = SHS_DATASIZE - data_count;
                if( count < data_count )
                {
                        memcpy( p, buffer, count );
                        return;
                }
                memcpy( p, buffer, data_count );
                AllToMSB( data, SHS_DATASIZE/4);
                SHA1Transform( digest, data );
                buffer = static_cast<uint8_t const*>(buffer) + data_count;
                count -= data_count;
        }

        /* Process data in SHS_DATASIZE chunks */
        while( count >= SHS_DATASIZE )
        {
                memcpy( data, buffer, SHS_DATASIZE );
                AllToMSB( data, SHS_DATASIZE/4);
                SHA1Transform( digest, data );
                buffer = static_cast<uint8_t const*>(buffer) + SHS_DATASIZE;
                count -= SHS_DATASIZE;
        }

        /* Handle any remaining bytes of data. */
        memcpy( data, buffer, count );
}

Blex::StringPair SHA1::FinalizeHash()
{
        int count;
        uint8_t *dataPtr;

        /* Compute number of bytes mod 64 */
        count = ( int ) countlo;
        count = ( count >> 3 ) & 0x3F;

        /* Set the first char of padding to 0x80.  This is safe since there is
        always at least one byte free */
        dataPtr = reinterpret_cast<uint8_t*>(data) + count;
        *dataPtr++ = 0x80;

        /* Bytes of padding needed to make 64 bytes */
        count = SHS_DATASIZE - 1 - count;

        /* Pad out to 56 mod 64 */
        if( count < 8 )
        {
                /* Two lots of padding:  Pad the first block to 64 bytes */
                memset( dataPtr, 0, count );
                AllToMSB( data, SHS_DATASIZE/4);
                SHA1Transform( digest, data );

                /* Now fill the next block with 56 bytes */
                memset( data, 0, SHS_DATASIZE - 8 );
        }
        else /* Pad block to 56 bytes */
        {
                memset( dataPtr, 0, count - 8 );
        }

        /* Append length in bits and transform */
        data[ 14 ] = counthi;
        data[ 15 ] = countlo;

        AllToMSB( data, (SHS_DATASIZE - 8)/4);
//        AllToMSB( data, SHS_DATASIZE/4);
        SHA1Transform( digest, data );

        /* Zeroise sensitive stuff */
        memset(data, 0, sizeof(data));
        countlo=counthi=0;

        AllToMSB( digest, sizeof (digest)/4); //reorder digest to MSB
        return Blex::StringPair(reinterpret_cast<char*>(&digest), reinterpret_cast<char*>(&digest) + Blex::SHA1HashLen);
}

void GetSHA1Hash(const void *data, unsigned len, void *hashstore)
{
        SHA1 processor;
        processor.Process(data,len);
        memcpy(hashstore, processor.Finalize(), SHA1HashLen);
}



} //end namsepace Blex
