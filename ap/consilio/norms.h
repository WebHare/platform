#ifndef blex_consilio_index_norms
#define blex_consilio_index_norms

#include <blex/podvector.h>

namespace Lucene
{

/** Normalization factors for a field. */
class Norm
{
    public:
        /// Normalization factors
        Blex::PodVector< uint8_t > bytes;

        /// Norms should be rewritten
        bool dirty;
};

/** Container for a Norm object. */
typedef std::shared_ptr<Norm> NormPtr;

/** A mapping of Field names to normalization factors. */
typedef std::map<std::string, NormPtr> NormsMap;

} // End of namespace Lucene

#endif
