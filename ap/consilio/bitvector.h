#ifndef blex_consilio_index_bitvector
#define blex_consilio_index_bitvector

#include <blex/complexfs.h>
namespace Lucene
{

/** A list of bits, which can be manipulated individually. */
class BitVector
{
    public:
        /** Create a BitVector for a given number of bits.
            @param n The number of bits to store */
        BitVector(uint32_t n);

        /** Invert all bits using the NOT operator. */
        void Not();

        /** Set a given bit.
            @param bit The bit to set */
        void Set(uint32_t bit);
        /** Clear a given bit.
            @param bit The bit to clear */
        void Clear(uint32_t bit);

        /** Combine a given bit with another bit, using the AND operator.
            @param bit The bit to manipulate
            @param other The bit to combine */
        void And(uint32_t bit, bool other);
        /** Combine a given bit with another bit, using the OR operator.
            @param bit The bit to manipulate
            @param other The bit to combine */
        void Or(uint32_t bit, bool other);

        /** Get the value of a given bit.
            @param bit The bit to retrieve
            @return If the bit is set */
        bool Get(uint32_t bit);

        /** Get the total number of bits.
            @return The number of bits stored */
        uint32_t Size();
        /** Get the number of bits that are set.
            @return The number of set bits */
        uint32_t Count();

        /** Write the bits to a file.
            @param d The Blex::ComplexFileSystem to write in
            @param name The name of the file to write to */
        void Write(Blex::ComplexFileSystem& d, const std::string & name);
        /** Read the bits from a file.
            @param d The Blex::ComplexFileSystem to read in
            @param name The name of the file to read from */
        BitVector(Blex::ComplexFileSystem& d, const std::string & name);

    private:
        /// Store for the bits (the size of this vector is usually (size+1)/8)
        std::vector<uint8_t> bits;
        /// The number of bits to store
        uint32_t size;
        /// The number of bits that are set, or -1 if a recount is needed
        int64_t count;

        /// A table containing for each byte value the number of bits set
        static const uint8_t BYTE_COUNTS[256];
};

} // namespace Lucene

#endif

