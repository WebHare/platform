#ifndef blex_parsers_filtering
#define blex_parsers_filtering

#include <blex/unicode.h>
#include "formatter.h"

namespace Parsers
{

class SiteWriter;
class PublicationProfile;
struct StyleSettings;

class BLEXLIB_PUBLIC FilteredOutput : public ForwardingOutput
{
        public:
        FilteredOutput(FormattedOutputPtr const &dest, StyleSettings const &currentfilter);
        ~FilteredOutput();

        /** Start a list (preeedes a StartParagraph, but no end tag exists)
            @param predefstyle Predefined style settings to try to use
            @param format_para Paragraph formatting
            @param format_char Character formatting for the bullet
            @param listtype List type */
        void StartParagraph(int32_t predefstyle,
                                     Paragraph const &format_para,
                                     ObjectType listtype);

        /** Start a paragraph
            @param bottompixels Additional bottom line spacing (used by collapsed breaks) */
        virtual void EnterParaText();

        /** End the last started paragraph */
        virtual void EndParagraph();

        /** Start a hyperlink. Hyperlinks may not be nested */
        virtual void StartHyperlink(Hyperlink const &hyperlink);

        /** End a hyperlink */
        virtual void EndHyperlink();

        /** Change the character formatting
            @param new_format New character formatting
            WARNING: The data new_link points to is expected to remain available at that
                     location until the next call to ChangeFormatting */
        virtual void ChangeFormatting(Character const &new_format);

        void WriteString (unsigned numchars, char const *firstchar);
        void StartTable(Table const &tableformat);
        void EndTable();
        void NextCell();
        void SetAnchor(std::string const &anchor);
        void InsertImage(ImageInfo const &imginfo);
        int32_t PredefineStyle(std::string const &suggestedname, Paragraph const &formatpara, Character const &formatchar);

        private:
        StyleSettings const &currentfilter;
        bool filtering_bulnum;
};

/** Style (override) settings */
struct BLEXLIB_PUBLIC StyleSettings
{
        /** Fill style with default settings */
        StyleSettings();

        ///Table of contents (docobject.toclevel) level for this style
        int32_t toclevel;
        ///If not empty, an override for the font family
        Font newfont;
        ///If not -1, the new font size in half-pixels
        signed fontsize;
        ///If not NoColour, the new font foreground color
        DrawLib::Pixel32 fontcolor;
        ///If not NoColour, the paragraph complete background color
        DrawLib::Pixel32 para_bgcolor;
        ///If not -1, forced vertical spacing above
        signed vertspace_above;
        ///If not -1, forced vertical spacing below
        signed vertspace_below;
        ///If not -1, forced left margin
        signed margin_left;
        ///If not -1, forced right margin
        signed margin_right;
        ///If not -1, forced first margin
        signed margin_first;
        ///If not -1, forced alignment
        signed horizalign;
        ///If not -1, forced underline setting
        signed underlining;
        ///The AND (flags to disable) list for this style
        uint32_t formatflags_and;
        ///The OR (flags to enable) list for this style
        uint32_t formatflags_or;
        ///Should we split when we find this style?
        bool split : 1;
        ///Show bullets and numbering?
        bool show_bullets_numbering : 1;
        ///Hide paragraph?
        bool hide_docobject: 1;
        ///Show hidden text?
        bool show_hidden_text : 1;
        ///Enable paragraph formatting
        bool paragraph_formatting : 1;
        ///Enable text effects
        bool texteffects : 1;
        ///Enable sub/superscript
        bool subsuper : 1;
        ///Enable hyperlinks
        bool hyperlinks : 1;
        ///Enable anchors
        bool anchors : 1;
        ///Enable images
        bool images : 1;
        ///Enable tables (if false, linearize them)
        bool tables : 1;
        ///Enable soft breaks
        bool softbreaks : 1;
        ///Table header
        bool tableheader : 1;
        ///HTML Heading level
        unsigned headinglevel;

        void FixupCharacterSettings(Character *dest, Character const &orig) const;

        void FixupParagraphSettings(Paragraph *dest, Paragraph const &orig, ObjectType objecttype) const;

        bool ShowHiddenAnyway() const;
};

/** The publication profile stores and indexes profile settings and filters */
class BLEXLIB_PUBLIC PublicationProfile
{
        public:
        /** Initialize profile to default settings */
        PublicationProfile();

        /// Get the filter id associated with a word style
        StyleSettings const &GetFilter_WordStyle(int32_t word_id) const;

        /// Get the filter id associated with a custom word style
        StyleSettings const &GetFilter_WordCustomStyle(std::string const &stylename) const;

        /// Get the filter id associated with the implicit style
        StyleSettings const &GetFilter_Implicit() const
        { return *implicitfilter; }

        /// Add a filter by name
        void AddFilter(int32_t wordid, std::string const &name, StyleSettings const &newfilter);

        private:
        ///Map filter ids to a filter
        typedef std::list<StyleSettings> Filters;

        ///Map custom styles to a filter id
        typedef std::map<std::string,Filters::const_iterator,Blex::StrCaseLess<std::string> > CustomStyleMap;

        ///Map built-in styles to a filter id
        typedef std::map<int32_t,Filters::const_iterator> BuiltinStyleMap;

        ///The location of the implicit style
        Filters::const_iterator implicitfilter;

        ///Map custom styles to a filter id
        CustomStyleMap customstylemap;

        ///Map built-in styles to a filter id
        BuiltinStyleMap builtinstylemap;

        ///The parsed filters
        Filters filters;

        PublicationProfile(PublicationProfile const &) = delete;
        PublicationProfile& operator=(PublicationProfile const &) = delete;

        //ADDME: Clean up - a bit ugly solution, but FilterredOutput needs a persisent predefstyles storage
        friend class FilteredOutput;
};

} //end namespace Parsers

#endif /* sentry */

