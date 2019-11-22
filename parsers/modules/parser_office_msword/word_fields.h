#ifndef blex_webhare_hare_msword_word_fields
#define blex_webhare_hare_msword_word_fields

#include "word_base.h"

namespace Parsers {
namespace Office {
namespace Word {

Parsers::Hyperlink BLEXLIB_PUBLIC ParseFieldCodeHyperlink(std::string const &fieldcode);

class OpenLinkParaEvent : public ParaEvent
{
        public:
        OpenLinkParaEvent(Parsers::Hyperlink const &_extern_link);
        bool Execute(FormattedOutput &output);
        std::string Describe() const;

        private:
        Parsers::Hyperlink external_link;
};
class CloseLinkParaEvent : public ParaEvent
{
        public:
        bool Execute(FormattedOutput &output);
        std::string Describe() const;
};
class AnchorEvent : public ParaEvent
{
        std::string anchor;

        public:
        AnchorEvent(std::string const &anchor);
        bool Execute(FormattedOutput &output);
        std::string Describe() const;
};


} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
