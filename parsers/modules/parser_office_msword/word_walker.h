#ifndef blex_webhare_hare_msword_word_walker
#define blex_webhare_hare_msword_word_walker

#include "biff.h"

namespace Parsers {
namespace Office {
namespace Word {

uint16_t MapCharThroughFont(uint16_t ch, const Font &font);

/** Word state maintainer. This structure is needed to 'walk' through a
    word document, paragraph by paragraph

    In this structure, we prefix members that depend on the current
    paragraph with para_, and prefix members that depend on the current
    character with char_
*/
class ParagraphWalker
{
        public:
        /** Construct a DocState object
            @param doc Word Document we will be walking */
        ParagraphWalker(BiffDoc const &doc);

        /** Destroy the ParagraphWalker object */
        ~ParagraphWalker();

        /** Set the character properties to the properties at the specified
            CP. The proper paragraph should be selected first using SetParagraph! */
        void SetCharacter(Cp cp);

        /** Obtain the section properties for this section */
        SectionData const & GetSection() const { return *para_sectiondata; }

         /** Obtain the paragraph properties for this entire paragraph */
        Pap const & GetParaPap() const { return para_pap; }

        /** Obtain the table properties for this entire paragraph */
        Tap const & GetParaTap() const { return para_tap; }

        /** Obtain the character properties for the current character */
        Chp const & GetCurChp() const { return char_chp; }

        /** Obtain the character properties for the list bullet */
        Chp GetListBulletChp() const;

        Cp GetSwitchCp() const { return char_switch_cp; }

        /** Get the character to which char_cp now points
            @param cp Cursor position to read
            @param ignoremarkup If true, ignore markup (eg ALLCAPS which disrupts field control reading)*/
        uint16_t GetChar(Cp cp, bool ignoremarkup);

        Cp GetParaBeginCp() const { return curpara->startcp; }

        Cp GetParaLimitCp() const { return curpara->limitcp; }

        /** Get the filter for the current paragraph */
        Parsers::StyleSettings const *GetFilter(Parsers::PublicationProfile const &pubprof) const;

        /** Get the paragraphs 'empty' height (the current font size + 20% (should read actual font data!)
            plus the current top and bottom paddings) */
        unsigned GetEmptyHeight() const
        {
                return GetPapChpEmptyHeight(GetParaPap(), GetCurChp());
        }

        ///Walked word document (FIXME: Make private)
        BiffDoc const &doc;

        private:
        /** Move the Walker object to a new paragraph and reset cursor
            position to the start of the paragraph
            @param newpara New paragraph */
        void SetParagraph(BiffParagraph const* para);
        /** Set the character properties to the properties at the specified
            CP. The proper paragraph should be selected first using SetParagraph! */
        void SetCharProperties(Cp cp, Fc fc);

        ///Walked paragraph
        BiffParagraph const* curpara;
        ///Current section data
        Sections::const_iterator para_sectiondata;
        ///Current paragraph properties
        Pap para_pap;
        /** Current table properties (directly associated with paragraph
            properties, but would be better to remove them here if possible) */
        Tap para_tap;
        /** Style chp */
        Chp style_chp;
        /** Current character properties */
        Chp char_chp;
        /** Current character data */
        CharData const *char_chardata;
        /// Cursor position of next switch (switch CHPX, switch PIECE, switch bufferpointer)
        Cp char_switch_cp;

        RawCharacterParser rawparser;
};

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
