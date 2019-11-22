#ifndef blex_consilio_analysis_tokenstream
#define blex_consilio_analysis_tokenstream

#include <blex/unicode.h>
#include "consilio.h"
#include "langspecific.h"

namespace Lucene
{

/** A ConsilioToken read from a TokenStream. The ConsilioToken is the smallest
    unit that will be indexed. (ADDME: Code dupe with blex tokenstream?) */
struct ConsilioToken
{
    public:
        /** The ConsilioToken type. */
        enum Type {
                Word,           ///< A single word (sequence of letters and digits)
//                NormalizedWord, ///< The normalized form of a word
//                StemmedWord,    ///< A stemmed form of a word
                ParserPunct,    ///< Some punctuation needed for the QueryParser
                Punct,          ///< Other punctuation characters
                Whitespace,     ///< Whitespace characters
                Lang            ///< Language switch (term contains the new language code)
        };

        /** Create an invalid (uninitialized) ConsilioToken. */
        ConsilioToken();
        /** Create a ConsilioToken.
            @param text The text
            @param start Starting position in the TokenStream
            @param end End position in the TokenStream
            @param type The ConsilioToken::Type
            @param is_linktext This ConsilioToken is part of a hyperlink
            @param is_comment This ConsilioToken is commmented out */
        ConsilioToken(const std::string & text, const std::string & normtext, uint32_t start, uint32_t end, Type type, bool is_linktext, bool is_comment);

        /** Completely initialize a ConsilioToken struct (used in testing code) */
        ConsilioToken(bool _valid, const std::string & _term, const std::string & _normterm, uint32_t _startoffset, uint32_t _endoffset, Type _type,
                               bool _linktext, bool _comment, bool _match, bool _stopword)
        : valid(_valid)
        , term(_term)
        , normalizedterm(_normterm)
        , startoffset(_startoffset)
        , endoffset(_endoffset)
        , type(_type)
        , linktext(_linktext)
        , comment(_comment)
        , match(_match)
        , stopword(_stopword)
        {}

        /// This ConsilioToken is valid
        bool valid;
        /// ConsilioToken text
        std::string term;
        /// Normalized token text in lowercase
        std::string normalizedterm;
        /// The stemmed normalized text
        std::string stemmedterm;
        /// Start position
        uint32_t startoffset;
        /// End position
        uint32_t endoffset;
        /// ConsilioToken type
        Type type;
        /// This ConsilioToken appears within hyperlink text
        bool linktext;
        /// This ConsilioToken appears on a line after a comment character
        /// (<tt>'#'</tt> or <tt>';'</tt>)
        bool comment;
        /// This ConsilioToken matched the original Query
        bool match;
        /// This is a stop word ConsilioToken
        bool stopword;
};

/** A list of ConsilioToken%s. */
typedef std::vector<ConsilioToken> TokenList;

/** Is this is a 'Match' ConsilioToken? (Used for producing summaries) */
inline bool is_match_token(ConsilioToken const &t)
{
        return t.match;
}

/** @defgroup tokenstreams The ConsilioToken streams
    These classes read ConsilioToken%s from a stream or a string. They are based
    on the Blex::NormalizedTokenStream class. The Consilio NormalizedTokenStream
    splits the input into Word (words), NormalizedWord (normalized words), Whitespace
    (whitespace), Punct and ParserPunct (punctuation) and Lang (language switches).

    Classes based on this class override the Next() function to add ConsilioToken%s
    or modify the ConsilioToken%s they got from their ancestor classes by calling
    the ancestor's Next() function. StemmedTokenStream may add a StemmedWord after
    each NormalizedWord it reads from NormalizedTokenStream. StopWordFilterTokenStream
    may mark a NormalizedWord as being a stop word if it appears on the stop word
    list.

    Some of those classes provide language-specific functionality. That is why a
    SetLanguage() function can be overridden by a stream to do language-specific
    stuff. The ancestor's SetLanguage function still has to be called for ancestor
    classes to initialize language-specific features.
    @{ */

/** Reads Blex::Token%s from a stream and returns ConsilioToken%s and their normalized forms.
    This stream returns a ConsilioToken::NormalizedWord ConsilioToken after each ConsilioToken::Word ConsilioToken
    from the underlying TokenStream. Words are normalized by removing accents and
    putting all characters into lowercase). */
class NormalizedTokenStream
{
    public:
        /** Set up the NormalizedTokenStream for a given stream.
            @param in The Blex::Stream to read from */
        NormalizedTokenStream(Blex::Stream *in)
        : mystr(in)
        {
                parsing_link = false;
                parsing_comment = false;
        }

        /** Set up the NormalizedTokenStream for a given string.
            @param in The string to read from */
        NormalizedTokenStream(std::string const &in)
        : mystr(in)
        {
                parsing_link = false;
                parsing_comment = false;
        }

        virtual ~NormalizedTokenStream();

        void SetMaxWordLength(uint32_t length)
        {
                mystr.SetMaxWordLength(length);
        }

        virtual void SetLang(Blex::Lang::Language _lang);

        /** Read the next ConsilioToken.
            @return The next ConsilioToken, or an invalid ConsilioToken if no token could be read
                    (in case of an end-of-stream) */
        virtual ConsilioToken Next();

    protected:
        ///Our underlying stream
        Blex::TokenStream mystr;

    private:

        /// Currently reading hyperlink text (which should not be indexed and is
        /// therefore not returned as a ConsilioToken)
        bool parsing_link;
        /// Currently reading commented text, i.e. text on a line after a comment
        /// character (<tt>'#'</tt> or <tt>';'</tt>)
        bool parsing_comment;

        /// Temporary store for Token%s to process
        std::vector<Blex::Token> buffered_tokens;
};

/** Reads ConsilioToken%s from a NormalizedTokenStream and returns them and their stemmed
    forms. This stream MAY return a ConsilioToken::StemmedWord ConsilioToken after each
    ConsilioToken::NormalizedWord ConsilioToken from the underlying NormalizedTokenStream. */
class StemmedTokenStream : public NormalizedTokenStream
{
    public:
        /** Set up the StemmedTokenStream for a given stream.
            @param in The Blex::Stream to read from */
        StemmedTokenStream(Blex::Stream *in)
        : NormalizedTokenStream(in)
        {}

        /** Set up the StemmedTokenStream for a given string.
            @param in The string to read from */
        StemmedTokenStream(std::string const &in)
        : NormalizedTokenStream(in)
        {}

        // virtual, reimplemented from TokenStream
        ConsilioToken Next();
        // virtual, reimplemented from TokenStream
        void SetLang(Blex::Lang::Language lang);

    private:
        /// Stemmer to use
        Blex::Stemmer stemmer;
};

/** Reads ConsilioToken%s from a StemmedTokenStream and filters out stop words.
    This stream returns all ConsilioToken%s from the underlying StemmedTokenStream, but
    it marks ConsilioToken::NormalizedWord and ConsilioToken::StemmedWord ConsilioToken%s as being stop
    word if the ConsilioToken::NormalizedWord appears in the stop word list for the
    current language. */
class StopWordFilterTokenStream : public StemmedTokenStream
{
    public:
        /** Set up the StopWordFilterTokenStream for a given stream.
            @param in The Blex::Stream to read from */
        StopWordFilterTokenStream(Blex::Stream *in)
        : StemmedTokenStream(in)
        {}

        /** Set up the StopWordFilterTokenStream for a given string.
            @param in The string to read from */
        StopWordFilterTokenStream(std::string const &in)
        : StemmedTokenStream(in)
        {}

        // virtual, reimplemented from TokenStream
        ConsilioToken Next();
        // virtual, reimplemented from TokenStream
        void SetLang(Blex::Lang::Language lang);

    private:
        /// Don't return the next StemmedWord (the last ConsilioToken::NormalizedWord was
        /// filtered out)
        bool word_filtered;

        /// Stop word filter to use
        StopWordFilter stopwordfilter;
};

/** @} */

} // namespace Lucene

#endif

