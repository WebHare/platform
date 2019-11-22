#ifndef blex_webhare_hare_msword_word_prescan
#define blex_webhare_hare_msword_word_prescan

#include "word_walker.h"

namespace Parsers {
namespace Office {
namespace Word {

struct BiffTable;

class ListScanner
{
        public:
        ListScanner()
        {
        }

        private:
        /** Properties that determine the 'uniqueness' of this list. If these
            properties differ, we consider the list to have been restarted */
        struct Unique
        {
                void SetFrom(Anld const &source)
                {
                        nfc=source.anlv.nfc;
                        textbefore=source.anlv.textbefore;
                        textafter=source.anlv.textafter;
                        rgxch=source.chars;
                }

                bool IsEqual(Anld const &source) const
                {
                        return nfc==source.anlv.nfc
                               && textbefore==source.anlv.textbefore
                               && textafter==source.anlv.textafter
                               && rgxch==source.chars;
                }

                ///The number formatting code
                uint8_t nfc;
                ///Offset to limit of text that prefixes autonumbered text
                uint8_t textbefore;
                ///Offset to limit of text that appears after autonumbered text
                uint8_t textafter;
                ///Text to use inside the numbering
                Blex::UTF16String rgxch;
        };
};

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
