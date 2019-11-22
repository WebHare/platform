#include <ap/libwebhare/allincludes.h>


//ADDME: Merge with bitmanip.h in blexlib ?

#include "bitvector.h"

namespace Lucene
{

// table of #bits/byte
const uint8_t BitVector::BYTE_COUNTS[256] =
{
        0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4,
        1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5,
        1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5,
        2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
        1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5,
        2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
        2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
        3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
        1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5,
        2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
        2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
        3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
        2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6,
        3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
        3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7,
        4, 5, 5, 6, 5, 6, 6, 7, 5, 6, 6, 7, 6, 7, 7, 8
};

BitVector::BitVector(uint32_t n)
: size(n)
, count(-1)
{
        bits.resize((n >> 3) + 1);
}

void BitVector::Not()
{
        uint32_t end = bits.size();
        for (uint32_t i = 0; i < end; ++i)
            bits[i] = ~bits[i];
        count = -1;
}

void BitVector::Set(uint32_t bit)
{
        bits[bit >> 3] |= (1 << (bit & 7));
        count = -1;
}

void BitVector::Clear(uint32_t bit)
{
        bits[bit >> 3] &= ~(1 << (bit & 7));
        count = -1;
}

void BitVector::And(uint32_t bit, bool other)
{
        bits[bit >> 3] &= ~((other ? 0 : 1) << (bit & 7));
        count = -1;
}

void BitVector::Or(uint32_t bit, bool other)
{
        bits[bit >> 3] |= ((other ? 1 : 0) << (bit & 7));
        count = -1;
}

bool BitVector::Get(uint32_t bit)
{
        return (bits[bit >> 3] & (1 << (bit & 7))) != 0;
}

uint32_t BitVector::Size()
{
        return size;
}

uint32_t BitVector::Count()
{
        if (count == -1)
        {
                count = 0;
                uint32_t end = bits.size();
                for (uint32_t i = 0; i < end; ++i)
                    count += BYTE_COUNTS[bits[i] & 0xFF];
        }
        return count;
}

void BitVector::Write(Blex::ComplexFileSystem &d, const std::string & name)
{
        const std::unique_ptr<Blex::ComplexFileStream> output(d.OpenFile(name,true,true));
        output->WriteLsb<uint32_t>(size);
        output->WriteLsb<uint32_t>(Count());
        for (uint32_t i = 0; i < bits.size(); ++i)
            output->WriteLsb<uint8_t>(bits[i]);
}

BitVector::BitVector(Blex::ComplexFileSystem &d, const std::string & name)
{
        const std::unique_ptr<Blex::ComplexFileStream> input(d.OpenFile(name,false,false));
        size = input->ReadLsb<uint32_t>();
        count = input->ReadLsb<uint32_t>();
        bits.resize((size >> 3) + 1);
        for (uint32_t i = 0; i < bits.size(); ++i)
            bits[i] = input->ReadLsb<uint8_t>();
}

} // namespace Lucene

