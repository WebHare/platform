#ifndef blex_consilio_index_terminfo
#define blex_consilio_index_terminfo

#include "term.h"

namespace Lucene
{

/** Information about a Term. */
struct TermInfo
{
        /** Create an uninitialized TermInfo. */
        TermInfo()
        : docfreq(0)
        , freqpointer(0)
        , proxpointer(0)
        {
        }

        /** Create an initialized TermInfo for a Term.
            @param df The number of Document%s this Term appears in
            @param fp Pointer in the frequencies stream (<tt>.frq</tt>) to start reading
                      frequencies for this Term
            @param pp Pointer in the positions stream (<tt>.prx</tt>) to start reading
                      positions for this Term */
        TermInfo(uint32_t df, uint32_t fp, uint32_t pp)
        {
                docfreq = df;
                freqpointer = fp;
                proxpointer = pp;
        }

        /** Initialize this TermInfo.
            @param df The number of Document%s this Term appears in
            @param fp Pointer in the frequencies stream (<tt>.frq</tt>) to start reading
                      frequencies for this Term
            @param pp Pointer in the positions stream (<tt>.prx</tt>) to start reading
                      positions for this Term */
        void Set(uint32_t df, uint32_t fp, uint32_t pp)
        {
                docfreq = df;
                freqpointer = fp;
                proxpointer = pp;
        }

        /** Initialize this TermInfo with the information of another TermInfo.
            @param ti TermInfo to copy values from */
        void Set(const TermInfo & ti)
        {
                docfreq = ti.docfreq;
                freqpointer = ti.freqpointer;
                proxpointer = ti.proxpointer;
        }

        /// Document frequency
        int32_t docfreq;
        /// Frequencies stream pointer
        uint32_t freqpointer;
        /// Positions stream pointer
        uint32_t proxpointer;
};

} // End of namespace Lucene

#endif

