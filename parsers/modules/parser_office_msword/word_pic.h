#ifndef blex_webhare_hare_source_msword_word_pic
#define blex_webhare_hare_source_msword_word_pic

#include <blex/blexlib.h>
#include <blex/docfile.h>
#include <parsers/office_escher/escher.h>
#include "word_base.h"

namespace Parsers {
namespace Office {
namespace Word {

/** Centralised Escher storage (may contain multiple pictures (aka shapes) ) */
class EscherDataStore
{
        public:
        EscherDataStore (std::shared_ptr<Blex::RandomStream> const &data,
                                  std::shared_ptr<Blex::RandomStream> const &delay);

        ~EscherDataStore();

        void ScanEscherData(Blex::FileOffset start,
                                     Blex::FileOffset length);

        std::unique_ptr<Escher::Interface> escherdata;

        private:
        std::shared_ptr<Blex::RandomStream> escherparentstream;
        std::shared_ptr<Blex::RandomStream> delaystream;
};

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
