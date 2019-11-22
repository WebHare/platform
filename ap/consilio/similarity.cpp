#include <ap/libwebhare/allincludes.h>


#include <cmath>
#include "similarity.h"
#include "searcher.h"
#include "term.h"

namespace Lucene
{

static DefaultSimilarity default_similarity;

Similarity::~Similarity()
{
}

float Similarity::normtable[256];
bool Similarity::initnormtable = true;

void Similarity::InitNormTable()
{
        for (int i = 0; i < 256; ++i)
        {
                normtable[i] = ((i & 3) + 4) * pow(2, (i >> 2) - 33);
        }
        initnormtable = false;
}

Similarity& Similarity::GetDefault()
{
        return default_similarity;
}

float Similarity::Idf(const Term & term, Searcher * searcher)
{
        return Idf(searcher->DocFreq(term), searcher->MaxDoc());
}

float Similarity::Idf(const std::vector<Term> & terms, Searcher * searcher)
{
        float idf = 0.0;
        for (uint32_t i = 0; i < terms.size(); ++i)
            idf += Idf(searcher->DocFreq(terms[i]), searcher->MaxDoc());
        return idf;
}

float Similarity::ByteToFloat(uint8_t b)
{
        if (b == 0)
            return 0;

        uint8_t mantissa = b & 0x7;
        uint8_t exponent = (b >> 3) & 0x1F;
        uint32_t f = ((exponent+(63-15)) << 24) | (mantissa << 21);
        return *(float *)(&f);
}

uint8_t Similarity::FloatToByte(float f)
{
        if (f < 0)
            f = 0;

        if (f == 0)
            return 0;

        uint32_t bits = *(uint32_t *)(&f);
        uint32_t mantissa = (bits & 0xFFFFFF) >> 21;
        int32_t exponent = (((bits >> 24) & 0x7F) - 63) + 15;

        if (exponent > 31) {
                exponent = 31;
                mantissa = 7;
        }

        if (exponent < 0) {
                exponent = 0;
                mantissa = 1;
        }

        return (uint8_t)((exponent << 3) | mantissa);
}

float DefaultSimilarity::LengthNorm(const std::string &, uint32_t numtokens)
{
        if (numtokens == 0)
            return std::numeric_limits<float >().max();
        else
            return 1.0/std::sqrt((F64)numtokens);
}

float DefaultSimilarity::QueryNorm(float sumofsquaredweights)
{
        if (sumofsquaredweights == 0)
            return std::numeric_limits<float >().max();
        else
            return 1.0/std::sqrt(sumofsquaredweights);
}

float DefaultSimilarity::Tf(float freq)
{
        return std::sqrt(freq);
}

float DefaultSimilarity::SloppyFreq(F64 distance)
{
        return 1.0/(distance + 1);
}

float DefaultSimilarity::Idf(uint32_t docfreq, uint32_t numdocs)
{
        if (numdocs == 0)
            return std::numeric_limits<float >().min();
        else
            return std::log((numdocs / (float )(docfreq+1))) + 1.0;
}

float DefaultSimilarity::Coord(uint32_t overlap, uint32_t maxoverlap)
{
        if (maxoverlap == 0)
            return std::numeric_limits<float >().max();
        else
            return overlap/(float )maxoverlap;
}

} // namespace Lucene

