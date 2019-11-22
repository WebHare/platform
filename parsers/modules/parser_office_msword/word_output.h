#ifndef blex_webhare_hare_msword_word_output
#define blex_webhare_hare_msword_word_output

#include <drawlib/drawlibv2/fontmanager.h>
#include <parsers/base/filtering.h>
#include <parsers/base/parserinterface.h>
#include "word_walker.h"
#include <stack>
#include "word_prescan.h"

namespace Parsers {
namespace Office {
namespace Word {

class OutputState
{
        private:
        std::string current_symbolfont;
        std::unique_ptr<DrawLib::Font> current_outputfont;
        Blex::UnicodeString current_text;
        DrawLib::FPBoundingBox bbox;
        void DrawText(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny);

        public:
        DocBase const &doc;
        Parsers::FormattedOutput &output;
        std::string symbolfont;
        double symbolsize;

        void ApplyChp(Chp const &chp, Parsers::StyleSettings const *filter);

        OutputState(DocBase const &doc, Parsers::FormattedOutput &output);
        ~OutputState();
        void SetFormatting(Font const *font, Parsers::Character const &formatting);
        void Write(unsigned numbytes, const char *bytes);
};

void DoBullet(OutputState &os, ListOverride const &list, unsigned level, ListCounters const &counters, Font const &font);

/// Low level character support (CHP-only, no PAP support) - cleanup this object, split off from textprocessor for word conversion rebuild
class CharacterProcessor
{
        public:
        CharacterProcessor(BiffDoc const &doc, int32_t initial_cp);

        BiffDoc const &doc;
        ParagraphWalker parawalker;

        /** Print the paragraph's text (not the opening and closing) */
        void DoText(OutputState &os, Parsers::StyleSettings const *filter, Cp startcp, Cp limitcp);

        private:
        bool InsideFieldOfType(unsigned type);
        void UpdateFormatting(OutputState &os, Parsers::StyleSettings const *filter);

        void ProcessSpecial(uint32_t ch, Cp cp, OutputState &os, bool is_hidden);

        struct FieldStack
        {
                unsigned type;
                std::string code;
                bool in_code_part;
        };

        ///Field in use stack
        std::vector<FieldStack> fieldcode_stack;
};

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
