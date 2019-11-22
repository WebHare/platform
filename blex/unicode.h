#ifndef blex_unicode
#define blex_unicode

#ifndef blex_blexlib
#include "blexlib.h"
#endif

#include <algorithm>
#include <vector>

#include "api.h"

namespace Blex
{
class Stream;

/** Language-specific types and functions */
namespace Lang {

/** Supported languages */
enum Language
{
        DA,     ///< Danish
        DE,     ///< German
        EN,     ///< English
        ES,     ///< Spanish
        FR,     ///< French
        IT,     ///< Italic
        NL,     ///< Dutch
        PT,     ///< Portuguese
        None    ///< No language-specific functionality
};

/** Get the Lang language code, given an HTML language string (as specified in
    http://www.w3.org/TR/html4/struct/dirlang.html#h-8.1.1).
    @param lang An UPPERCASE language string (e.g. "NL" or "EN-US")
    @return A Lang value (Lang::None if the string was not recognized) */
BLEXLIB_PUBLIC Language GetLanguage(const std::string &lang);

BLEXLIB_PUBLIC std::string GetLanguageCode(Language lang);

} //end namespace Lang

///32-bit Unicode string
typedef std::vector<uint32_t> UnicodeString;
///16-bit UTF-16 string
typedef std::vector<uint16_t> UTF16String;

template <class OutputIterator> class UTF8Encoder
{
        public:
        UTF8Encoder(OutputIterator _output) : output(_output) {}

        void operator() (uint32_t ch)
        {
                if (ch < 128)
                {
                        *output++ = uint8_t(ch);
                }
                else if (ch <= 0x7FF) //2-byte sequence
                {
                        *output++ = uint8_t(0xC0 + ch / (1<<6));
                        *output++ = uint8_t(0x80 + ch % (1<<6));
                }
                else if (ch <= 0xFFFF) //3-byte sequences
                {
                        *output++ = uint8_t(0xE0 + ch / (1<<12));
                        *output++ = uint8_t(0x80 + (ch / (1<<6)) % (1<<6));
                        *output++ = uint8_t(0x80 + ch % (1<<6));
                }
                else if (ch <= 0x1FFFFF) //4-byte sequence
                {
                        *output++ = uint8_t(0xF0 + ch / (1<<18));
                        *output++ = uint8_t(0x80 + (ch / (1<<12)) % (1<<6));
                        *output++ = uint8_t(0x80 + (ch / (1<<6)) % (1<<6));
                        *output++ = uint8_t(0x80 + ch % (1<<6));
                }
                else if (ch <= 0x3FFFFFF) //5-byte sequence
                {
                        *output++ = uint8_t(0xF8 + ch / (1<<24));
                        *output++ = uint8_t(0x80 + (ch / (1<<18)) % (1<<6));
                        *output++ = uint8_t(0x80 + (ch / (1<<12)) % (1<<6));
                        *output++ = uint8_t(0x80 + (ch / (1<<6)) % (1<<6));
                        *output++ = uint8_t(0x80 + ch % (1<<6));
                }
                else if (ch <= 0x7FFFFFFF) //6-byte sequence
                {
                        *output++ = uint8_t(0xFC + ch / (1<<30));
                        *output++ = uint8_t(0x80 + (ch / (1<<24)) % (1<<6));
                        *output++ = uint8_t(0x80 + (ch / (1<<18)) % (1<<6));
                        *output++ = uint8_t(0x80 + (ch / (1<<12)) % (1<<6));
                        *output++ = uint8_t(0x80 + (ch / (1<<6)) % (1<<6));
                        *output++ = uint8_t(0x80 + ch % (1<<6));
                }
        }

        //Ensure safe upcasting of signed types (ie, don't convert char 166 to -90 before doing further conversion)
        void operator() (signed char ch) { operator() (uint32_t(static_cast<unsigned char>(ch))); }
        void operator() (unsigned char ch){ operator() (uint32_t(ch)); }
        void operator() (int16_t ch)         { operator() (uint32_t(uint16_t(ch))); }
        void operator() (uint16_t ch)         { operator() (uint32_t(uint16_t(ch))); }
        void operator() (char ch)        { operator() (uint32_t(static_cast<unsigned char>(ch))); }
        void operator() (int ch)         { operator() (uint32_t(static_cast<unsigned int>(ch))); }

        OutputIterator output;
};

template <class OutputIterator, class InputIterator>
  OutputIterator UTF8Encode(InputIterator begin,InputIterator end, OutputIterator output)
{
        UTF8Encoder<OutputIterator> encoder(output);
        for(;begin!=end;++begin)
            encoder(*begin);
        return encoder.output;
}

/** A class to process and decode UTF-8 characters to Unicode characters */
class BLEXLIB_PUBLIC UTF8DecodeMachine
{
        ///Currently received UTF-8 bytes
        uint8_t sequence[6];
        ///Current # of stored UTF-8 bytes
        unsigned utf8ptr;

        uint32_t ComplexDecode(uint8_t byte);

        public:
        static const uint32_t NoChar = 0xFFFFFFFF;
        static const uint32_t InvalidChar = 0xFFFFFFFE;

        ///Initialize a decoder
        UTF8DecodeMachine() : utf8ptr(0) {  }

        /** Is the UTF8 machine busy processing a character? */
        bool InsideCharacter() { return utf8ptr > 0; }

        /** Process a UTF8 coded character
            @return NoChar if there is no output yet, the current (unicode) character otherwise */
        uint32_t operator() (uint8_t inputbyte)
        {
                if (utf8ptr==0 && inputbyte<128) //simple sequence
                    return inputbyte;
                else
                    return ComplexDecode(inputbyte);
        }
};

/** UTF-8 to Unicode decoder */
template <class OutputIterator> class UTF8Decoder
{
        UTF8DecodeMachine decoder;

        public:
        UTF8Decoder(OutputIterator _output) : output(_output)
        {
        }

        inline void operator() (uint8_t inputbyte)
        {
                uint32_t decoded = decoder(inputbyte);
                if (decoded != UTF8DecodeMachine::NoChar && decoded != UTF8DecodeMachine::InvalidChar)
                    *output++ = decoded;
        }

        OutputIterator output;
};

/** Decode a UTF-8 string to Unicode */
template <class OutputIterator, class InputIterator>
  void UTF8Decode(InputIterator begin, InputIterator end, OutputIterator output)
{
        std::for_each(begin,end,UTF8Decoder<OutputIterator>(output));
}

inline bool IsValidXMLChar(uint32_t charvalue)
{
        //#x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]    /* any Unicode character, excluding the surrogate blocks, FFFE, and FFFF. */
        return (charvalue >= 0x20 && charvalue <= 0xFFFD)
            || (charvalue >= 0x10000 && charvalue <= 0x10FFFF)
            || charvalue == 0x9 || charvalue == 0xA || charvalue == 0xD;
}

/** Check whether a string is valid Unicode
    @param xmlchar If true, check against the valid xml Char subset too. ( https://www.w3.org/TR/2008/REC-xml-20081126/#NT-Char )*/
template <typename Itr>
  bool IsValidUTF8(Itr begin, Itr end, bool xmlchar)
{
        UTF8DecodeMachine checker;
        for (;begin!=end;++begin)
        {
                uint32_t decoded = checker(*begin);
                if(decoded == UTF8DecodeMachine::NoChar)
                        continue;
                if(decoded == UTF8DecodeMachine::InvalidChar)
                        return false;
                if(decoded == 0 || (decoded >= 0xD800 && decoded <= 0xDFFF)) //deny 0s and surrogate pairs
                        return false;
                if(xmlchar && !IsValidXMLChar(decoded))
                        return false;
        }
        return checker.InsideCharacter() == false; //not halfway inside a character ?
}

/** Ensure a string contains valid Unicode */
BLEXLIB_PUBLIC void EnsureValidUTF8(std::string *tofix, bool xmlchar);

///Supported character sets
namespace Charsets
{
        enum Charset
        {
                ///Unknown character set (used as error codes)
                Unknown=0,
                ///DOS Codepage 437 (extended ASCII - DOS Latin US)
                CP437,
                ///Thai
                CP874,
                ///Central Europe
                CP1250,
                ///Cyrillic
                CP1251,
                ///Windows Codepage 1252 (extended latin-1)
                CP1252,
                ///Greek
                CP1253,
                ///Turkish
                CP1254,
                ///Hebrew
                CP1255,
                ///Windows Codepage 1256 (arabic)
                CP1256,
                ///Baltic
                CP1257,
                ///Vietnam
                CP1258,
                ///Windows Symbol codepage
                CPSymbol,
                ///US ASCII character set
                USAscii,
                ///ISO-8859-1 character set
                Iso8859_1,
                ///ISO-8859-15 (Latin-9) character set
                Iso8859_15,
                ///MacWord character set
                CPMacWord,
                ///Wingdings character set
                CPWingdings,
                ///Unicode character set
                Unicode
        };
} //end namespace charsets

/** Reads UTF-8 characters, words and values from a Stream. (ADDME: Merge with the other utf8 decoders) */
class Utf8Reader
{
    public:
        /** Set up the Utf8Reader for a given stream.
            @param in The Blex::Stream to read from */
        Utf8Reader(Blex::Stream *in);

        /** Set up the Utf8Reader for a given string.
            @param in The string to read from */
        Utf8Reader(std::string const &in);

        /** Add new text to the read buffer, if the reader is set up to read from
            a string.
            @param in The string to add to the read buffer */
        void AddToReadBuffer(std::string const &in);

        /** Is the next UTF-8 char a letter? */
        bool IsLetter() const;
        /** Is the next UTF-8 char a letter or digit? */
        bool IsAlNum() const;
        /** Is the next UTF-8 char whitespace? */
        bool IsWhitespace() const;

        /** Return the next byte to read (do not advance the read pointer).
            @return The byte that will be read next */
        uint8_t NextByte() const;
        /** Return the next (possibly multi-byte) UTF-8 letter sequence to read
            (do not advance the read pointer).
            @return The letter that will be read next */
        std::string const & NextChar() const;
        /** Return the next Unicode character to read (do not advance the read
            pointer).
            @return The Unicode character that will be read next */
        uint32_t NextUCChar() const;

        /** Read and return the next (possibly multi-byte) UTF-8 letter sequence.
            @return The letter read from the stream */
        std::string ReadChar();

        /** Get the current stream offset.
            @return The offset of the underlying stream */
        uint32_t GetOffset() const { return offset; }

        /** Clear the buffer */
        void Clear();

    private:
        /** Is @c c a Unicode letter?
            This function returns false for Unicode Symbols and Punctuation (as
            listed in http://www.unicode.org/charts/symbols.html). */
        bool IsUCAlNum(uint32_t c) const;

        /** Read next byte from input. The read byte is stored in c, the number
            of bytes read (either 0 or 1) is returned. */
        std::size_t ReadFromInput(uint8_t *c);
        /** Put next UTF-8 letter sequence in buffer. */
        void ReadBuffer();

        /// Input stream to read from
        Blex::Stream *instream;
        /// Input string to read from
        std::string instring;
        /// Stream offset
        uint32_t offset;

        /// The current UTF-8 letter sequence
        std::string buffer;
        /// The current Unicode character
        uint32_t ucbuffer;
};

/** A Token read from a TokenStream. The @c termtext is UTF-8 encoded, so a single
    character may take up to 4 bytes in @c termtext (the length of @c termtext
    may be different from the number of characters). */
struct BLEXLIB_PUBLIC Token
{
    public:
        /** The Token type. */
        enum Type {
                Word = 1,       ///< A single word (sequence of letters and digits)
                Punct = 2,      ///< A single punctuation character (not a letter, digit or control character)
                Control = 3,    ///< A single control character (0-31 and 127)
                Whitespace = 4  ///< Whitespace (sequence of ' ', '\\n', '\\r', or '\\t')
        };

        /** Create an invalid (uninitialized) Token. */
        Token();
        /** Create a Token.
            @param text The text
            @param start Starting position in the TokenStream
            @param end End position in the TokenStream
            @param type The Token::Type */
        Token(const std::string & text, uint32_t start, uint32_t end, Type type);

        /// This Token is valid
        bool valid;
        /// Token text
        std::string termtext;
        /// Normalized token text in lowercase
        std::string normalizedterm;
        /// Start position
        uint32_t startoffset;
        /// End position (<tt>endoffset - startoffset</tt> is the number of bytes
        /// read from the stream)
        uint32_t endoffset;
        /// Token type
        Type type;
        /// This Token's position relative to the previous Token. This can be set
        /// to 0 to place multiple tokens the same position (e.g. normalized forms
        /// of the token). The default value is 1.
        uint32_t positionincrement;
};

/** Reads Token%s from a UTF-8 encoded Blex::Stream.
    The TokenStream does not return Token%s of type Token::NormalizedWord. */
class BLEXLIB_PUBLIC TokenStream
{
    public:
        /** Set up the TokenStream for a given stream.
            @param in The Blex::Stream to read from */
        TokenStream(Blex::Stream *in);

        /** Set up the TokenStream for a given string.
            @param in The string to read from */
        TokenStream(std::string const &in);

        // Destructor
        ~TokenStream();

        /** Add new text to the read buffer, if the TokenStream is set up to read
            from a string. If NextToken() is called before adding text, Token%s
            may be split if they span across multiple input strings.
            @param in The string to add to the read buffer */
        void AddToReadBuffer(std::string const &in);

        Blex::Token const &GetCurrentToken() const
        {
                return current_token;
        }

        /** Read the next Token.
            @return The next Token, or an invalid Token if no token could be read
                    (in case of an end-of-stream) */
        bool NextToken();

        /** Set the stream language.
            The stream language is used for language-specific functionality, like
            normalization.
            @param lang The language to use */
        void SetLanguage(Lang::Language lang);

        /** Set the maximum word length in bytes. Set this to 0 for unlimited word
            length or at least 4 (to hold at least one maximum-sized UTF-8 character).
            @param length The maximum length of returned Token%s */
        void SetMaxWordLength(uint32_t length);

        /// Restart buffer and starting position
        void Clear();

        Lang::Language GetCurrentLanguage() const
        {
                return lang;
        }

    private:
        /// The stream language. This is not used directly in TokenStream, but it
        /// is used in derived classes for language-specific functionality like
        /// normalization
        Lang::Language lang;

        /// The reader which reads letters and words from the stream
        Utf8Reader reader;
        /// Current token
        Blex::Token current_token;
        /// Maximum token length
        uint32_t buffer_max;
};

/** Normalize character and add it to a given buffer */
void NormalizeChar(uint32_t unicodechar, std::string *buffer, Blex::Lang::Language lang);

/** Normalize a string */
BLEXLIB_PUBLIC std::string NormalizeString(const std::string &str, Blex::Lang::Language lang);

/** The Snowball word stemmer. To use stemming, create a Stemmer object, set
    the stemming language using SetLanguage() and call Stem() to stem a single
    word. */
class BLEXLIB_PUBLIC Stemmer
{
    public:
        Stemmer();
        ~Stemmer();

        /** Get the stemmed form of a word in a given language.
            @param input The word to stem
            @return The stemmed word, which can be empty (if no language was
                    set) or equal to the original */
        std::string Stem(std::string const &input) const;

        /** Set the language which is used for stemming.
            @param lang The Language to use */
        void SetLanguage(Blex::Lang::Language lang);

    private:
        /// Stemming environment
        struct SN_env *language_env; // This object is destroyed by calling
                                     // SN_close_env() (in the Stemmer destructor)
                                     // and therefore not wrapped in a scoped_ptr

        /// Pointer to language-specific stemming function
        int (*language_stem_function)(struct SN_env *);

        /// Pointer to language-specific stemming environment closing function
        void (*language_close_function)(struct SN_env *);
};

/** @short Get the name for a character set */
BLEXLIB_PUBLIC char const * GetCharsetName(Charsets::Charset page);

/** @short Given a name, find a matching character set
    @param start Start of character set name
    @param end End of character set name
    @return The character set, or Unknown if the charset name was unrecognized */
BLEXLIB_PUBLIC Charsets::Charset FindCharacterset(const char *start, const char *end);

/** @short Given a string of characters, pick the most suitable character
           set to represent it
    @return USAscii, ISO_8859_1 or Unicode */
BLEXLIB_PUBLIC Charsets::Charset GetBestCharacterset(const char *start,const char *end);

/** Get the specified codepage. Throws logic_error if a non-existing codepage
    is requested
    @param page requested codepage
    @return Codepage contents (a 256-uint32_t array) or NULL if no codepage is available (eg Unicode) */
BLEXLIB_PUBLIC uint32_t const * GetCharsetConversiontable(Charsets::Charset page);

/** Is a character in the private Unicode range?
    @param ch Character to test
    @return true if the character is in the private, undocumented range (eg Symbol) */
inline bool IsPrivateRangeUnicode(uint32_t ch)
{
        return ch >= 0xe000 && ch <= 0xf8ff;
}

BLEXLIB_PUBLIC void ConvertUTF8ToCharset(const char *start,const char *end, Charsets::Charset page, std::string *output);

BLEXLIB_PUBLIC void ConvertCharsetToUTF8(const char *start,const char *end, Charsets::Charset page, std::string *output);

} //end namespace Blex

#endif /* sentry */
