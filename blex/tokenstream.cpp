#include <blex/blexlib.h>

#include "unicode.h"
#include "stream.h"

#define DEFAULT_BUFFER_MAX 0

namespace Blex
{

namespace Lang
{

Language GetLanguage(const std::string &lang)
{
        if (lang.size() < 2)
            return None;

        // We may get a string like "EN-US" or "NL-BE", but for now we only check
        // the primary code
        if (lang[0] == 'D' && lang[1] == 'A')
            return DA;
        if (lang[0] == 'D' && lang[1] == 'E')
            return DE;
        if (lang[0] == 'E' && lang[1] == 'N')
            return EN;
        if (lang[0] == 'E' && lang[1] == 'S')
            return ES;
        if (lang[0] == 'F' && lang[1] == 'R')
            return FR;
        if (lang[0] == 'I' && lang[1] == 'T')
            return IT;
        if (lang[0] == 'N' && lang[1] == 'L')
            return NL;
        if (lang[0] == 'P' && lang[1] == 'T')
            return PT;

        return None;
}

std::string GetLanguageCode(Language lang)
{
        switch (lang)
        {
            case DA:
                return "DA";
            case DE:
                return "DE";
            case EN:
                return "EN";
            case ES:
                return "ES";
            case FR:
                return "FR";
            case IT:
                return "IT";
            case NL:
                return "NL";
            case PT:
                return "PT";
            default:
                return "";
        }
}

} //end namespace Lang

Utf8Reader::Utf8Reader(Blex::Stream *in)
{
        instream = in;
        instring.clear();
        offset = 0;
        ReadBuffer();
}

Utf8Reader::Utf8Reader(std::string const &in)
{
        instream = NULL;
        instring = in;
        offset = 0;
        ReadBuffer();
}

void Utf8Reader::Clear()
{
        instream = NULL;
        instring.clear();
        offset = 0;
        ucbuffer = 0;
}

void Utf8Reader::AddToReadBuffer(std::string const &in)
{
        instring.append(in);

        //ADDME: If the initial string consisted of an incomplete UTF-8 sequence,
        //       this ReadBuffer call will also fail if the appended part starts
        //       with the rest of the UTF-8 sequence.
        if (ucbuffer == 0)
            ReadBuffer();
}

bool Utf8Reader::IsLetter() const
{
        return Blex::IsAlpha(ucbuffer) || IsUCAlNum(ucbuffer) || ucbuffer == 0x5F/*Underscore*/;
}

bool Utf8Reader::IsAlNum() const
{
        return Blex::IsAlNum(ucbuffer) || IsUCAlNum(ucbuffer) || ucbuffer == 0x5F/*Underscore*/;
}

bool Utf8Reader::IsWhitespace() const
{
        return Blex::IsWhitespace(ucbuffer) || ucbuffer == 0xA0/*NBSP*/;
}

uint8_t Utf8Reader::NextByte() const
{
        return ucbuffer & 0xFF;
}

std::string const & Utf8Reader::NextChar() const
{
        return buffer;
}

uint32_t Utf8Reader::NextUCChar() const
{
        return ucbuffer;
}

std::string Utf8Reader::ReadChar()
{
        std::string c = buffer;
        ReadBuffer();
        return c;
}

bool Utf8Reader::IsUCAlNum(uint32_t c) const
{
        // This function returns if the Unicode character c is located in a Unicode
        // letter range. It skips all non-letter Unicode character ranges, which
        // are listed in the comments.
                // 0000-007F Basic Latin (not checking here)
                // 0080-009F C1 Controls
                // 00A0-00BF Latin-1 Punctuation and Symbols
                // 00D7,00F7 Mathematical Operators
        return (c > 0xBF && c < 0x250 && c != 0xD7 && c != 0xF7)
                // 0250-02AF IPA Extensions
                // 02B0-02FF Spacing Modifier Letters
                // 0300-036F Combining Diacritical Marks
            || (c > 0x36F && c < 0x1D00)
                // 1D00-1D7F Phonetic Extensions
                // 1D80-1DBF Phonetic Extensions Supplement
                // 1DC0-1DFF Combining Diacritical Marks Supplement
            || (c > 0x1DFF && c < 0x2000)
                // 2000-206F General Punctuation
                // 2070-209F Super and Subscripts
                // 20A0-20CF Currency Symbols
                // 20D0-20FF Combining Diacritical Marks for Symbols
                // 2100-214F Letterlike Symbols
                // 2150-218F Number Forms
                // 2190-21FF Arrows
                // 2200-22FF Mathematical Operators
                // 2300-23FF Miscellaneous Technical
                // 2400-243F Control Pictures
                // 2440-245F OCR
                // 2460-24FF Enclosed Alphanumerics
                // 2500-257F Box Drawing
                // 2580-259F Block Elements
                // 25A0-25FF Geometrical Shapes
                // 2600-26FF Miscellaneous Symbols
                // 2700-27BF Dingbats
                // 27C0-27EF Misc. Math Symbols A
                // 27F0-27FF Supplemental Arrows A
                // 2800-28FF Braille Patterns
                // 2900-297F Supplemental Arrows B
                // 2980-29FF Misc. Math Symbols B
                // 2A00-2AFF Suppl. Math Operators
                // 2B00-2BFF Misc. Symbols and Arrows
            || (c > 0x2BFF && c < 0x2E00)
                // 2E00-2E7F Supplemental Punctuation
            || (c > 0x2E7F && c < 0x3000)
                // 3000-303F CJK Punctuation
            || (c > 0x303F && c < 0x3200)
                // 3200-32FF Enclosed CJK Letters and Months
                // 3300-33FF CJK Compatibility
            || (c > 0x33FF && c < 0x4DC0)
                // 4DC0-4DFF Yijing Hexagrams
            || (c > 0x4DFF && c < 0xA700)
                // A700-A71F Modifier Tone Letters
            || (c > 0xA71F && c < 0xD800)
                // D800-DBFF High Surrogates
                // DC00-DFFF Low Surrogates
                // E000-F8FF Private Use Area
            || (c > 0xF8FF && c < 0xFE00)
                // FE00-FE0F Variation Selectors
                // FE10-FE1F Vertical Forms
                // FE20-FE2F Combining Half Marks
                // FEFF      Zero Width Non-Breaking Space
            || (c > 0xFE2F && c < 0xFF00 && c != 0xFEFF)
                // FF00-FF0F Fullwidth ASCII Punctuation
            || (c > 0xFF0F && c < 0xFF1A)
                // FF1A-FF20 Fullwidth ASCII Punctuation
            || (c > 0xFF20 && c < 0xFF3B)
                // FF3B-FF40 Fullwidth ASCII Punctuation
            || (c > 0xFF40 && c < 0xFF5B)
                // FF5B-FF64 Fullwidth ASCII Punctuation
            || (c > 0xFF64 && c < 0xFFE0)
                // FFE0-FFEF Fullwidth ASCII Punctuation
                // FFF0-FFFF Specials
        // We'll skip all characters above 0xFFFF
                // 1D000-1D0FF Byzantine Musical Symbols
                // 1D100-1D1FF Western Musical Symbols
                // 1D200-1D24F Ancient Greek Musical Symbols
                // 1D300-1D35F Tai Xuan Jing Symbols
                // 1D400-1D7FF Math Alphanumeric Symbols
                // E0000-E007F Tags
                // E0100-E01EF Variation Selectors Supplement
                // F0000-FFFFD Suppl. Private Use Area A
                // 100000-10FFFD Suppl. Private Use Area B
        ;
}

std::size_t Utf8Reader::ReadFromInput(uint8_t *c)
{
        if (instream != NULL)
        {
                std::size_t r = instream->Read(c, 1);
                if (r > 0)
                    ++offset;
                return r;
        }
        else if (!instring.empty() && offset < instring.size())
        {
                *c = instring[offset++];
                return 1;
        }
        return 0;
}

void Utf8Reader::ReadBuffer()
{
        uint8_t c;
        while (true)
        {
                if (ReadFromInput(&c) < 1)
                {
                        buffer = "";
                        ucbuffer = 0;
                        return; // incomplete or malformed UTF-8 - ignore
                }
                // Break if we didn't read a BOM
                // (offset is already updated by ReadFromInput)
                if (offset > 3
                    || (offset == 1 && c != 0xEF)
                    || (offset == 2 && c != 0xBB)
                    || (offset == 3 && c != 0xBF))
                    break;
        }
        buffer = std::string(1,c);
        ucbuffer = c;

        if (c & 0x80) // extended character
        {
                ucbuffer = 0;
                if ((c & 0xE0) == 0xC0) // one more byte
                {
                        ucbuffer |= (c & 0x1F) << 6;
                        if (ReadFromInput(&c) < 1 || (c & 0xC0) != 0x80)
                        {
                                buffer = "";
                                ucbuffer = 0;
                                return; // incomplete or malformed UTF-8 - ignore
                        }
                        buffer.push_back(c);
                        ucbuffer |= c & 0x3F;
                }
                else if ((c & 0xF0) == 0xE0) // two more bytes
                {
                        ucbuffer |= (c & 0x1F) << 12;
                        if (ReadFromInput(&c) < 1 || (c & 0xC0) != 0x80)
                        {
                                buffer = "";
                                ucbuffer = 0;
                                return; // incomplete or malformed UTF-8 - ignore
                        }
                        buffer.push_back(c);
                        ucbuffer |= (c & 0x3F) << 6;
                        if (ReadFromInput(&c) < 1 || (c & 0xC0) != 0x80)
                        {
                                buffer = "";
                                ucbuffer = 0;
                                return; // incomplete or malformed UTF-8 - ignore
                        }
                        buffer.push_back(c);
                        ucbuffer |= c & 0x3F;
                }
                else if ((c & 0xF8) == 0xF0) // three more bytes
                {
                        ucbuffer |= (c & 0x1F) << 18;
                        if (ReadFromInput(&c) < 1 || (c & 0xC0) != 0x80)
                        {
                                buffer = "";
                                ucbuffer = 0;
                                return; // incomplete or malformed UTF-8 - ignore
                        }
                        buffer.push_back(c);
                        ucbuffer |= (c & 0x1F) << 12;
                        if (ReadFromInput(&c) < 1 || (c & 0xC0) != 0x80)
                        {
                                buffer = "";
                                ucbuffer = 0;
                                return; // incomplete or malformed UTF-8 - ignore
                        }
                        buffer.push_back(c);
                        ucbuffer |= (c & 0x3F) << 6;
                        if (ReadFromInput(&c) < 1 || (c & 0xC0) != 0x80)
                        {
                                buffer = "";
                                ucbuffer = 0;
                                return; // incomplete or malformed UTF-8 - ignore
                        }
                        buffer.push_back(c);
                        ucbuffer |= c & 0x3F;
                }
                else // malformed UTF-8 - ignore
                {
                        buffer = "";
                        ucbuffer = 0;
                        return;
                }
        }
}

Token::Token()
{
        valid = false;
        termtext = "";
        startoffset = 0;
        endoffset = 0;
        positionincrement = 1;
        type = Token::Word;
}

Token::Token(const std::string & text, uint32_t start, uint32_t end, Token::Type _type)
{
        valid = true;
        termtext = text;
        startoffset = start;
        endoffset = end;
        positionincrement = 1;
        type = _type;
}

TokenStream::TokenStream(Blex::Stream *in)
: reader(Utf8Reader(in))
{
        SetMaxWordLength(DEFAULT_BUFFER_MAX);
        lang = Lang::None;
}

TokenStream::TokenStream(std::string const &in)
: reader(Utf8Reader(in))
{
        SetMaxWordLength(DEFAULT_BUFFER_MAX);
        lang = Lang::None;
}

TokenStream::~TokenStream()
{
}

void TokenStream::Clear()
{
        reader.Clear();
        current_token.termtext.clear();
        current_token.normalizedterm.clear();
}

void TokenStream::AddToReadBuffer(std::string const &in)
{
        reader.AddToReadBuffer(in);
}

bool TokenStream::NextToken()
{
        current_token.termtext.clear();
        current_token.normalizedterm.clear();

        uint32_t start = reader.GetOffset();
        while (true)
        {
                uint8_t c = reader.NextByte();
                if (c == 0)
                {
                        // End-of-stream
                        if (current_token.termtext.size() > 0)
                                break; // We have read a word, return it

                        current_token.valid=false;
                        return false;
                }

                // Whitespace characters
                if (reader.IsWhitespace())
                {
                        // We have a token to send first
                        if (current_token.termtext.size() > 0)
                            break;

                        start = reader.GetOffset() - reader.NextChar().size();
                        // Read all whitespace
                        while (reader.IsWhitespace())
                        {
                                // See if we can add the current character to the
                                // buffer without exceeding the maximum buffer length
                                if (buffer_max > 0 && (current_token.termtext.size()+reader.NextChar().size()) > buffer_max)
                                    break;

                                current_token.termtext += reader.ReadChar();
                        }
                        current_token.startoffset = start;
                        current_token.endoffset = start+current_token.termtext.size();
                        current_token.type = Token::Whitespace;
                        current_token.valid = true;
                        return true;
                }

                if (reader.IsAlNum()) // Letters and digits
                {
                        if (current_token.termtext.size() == 0)
                            start = reader.GetOffset() - reader.NextChar().size();

                        // See if we can add the current character to the buffer
                        // without exceeding the maximum buffer length
                        if (buffer_max > 0 && (current_token.termtext.size()+reader.NextChar().size()) > buffer_max)
                            break;

                        NormalizeChar(reader.NextUCChar(), &current_token.normalizedterm, lang);
                        current_token.termtext += reader.ReadChar();
                }
                else if (c >= 0x20 && c != 0x7F) // Punctuation (no control characters)
                {
                        // We have a token to send first
                        if (current_token.termtext.size() > 0)
                            break;

                        start = reader.GetOffset() - reader.NextChar().size();
                        current_token.startoffset = start;
                        current_token.endoffset = start + reader.NextChar().size();
                        current_token.termtext  = reader.ReadChar();
                        current_token.type = Token::Punct;
                        current_token.valid = true;
                        return true;
                }
                else // Control characters
                {
                        // We have a token to send first
                        if (current_token.termtext.size() > 0)
                            break;

                        start = reader.GetOffset() - reader.NextChar().size();

                        current_token.startoffset = start;
                        current_token.endoffset = start + reader.NextChar().size();
                        current_token.termtext = reader.ReadChar();
                        current_token.type = Token::Control;
                        current_token.valid = true;
                        return true;
                }
        }
        current_token.startoffset = start;
        current_token.endoffset = start + current_token.termtext.size();
        current_token.type = Token::Word;
        current_token.valid = true;
        return true;
}

void TokenStream::SetLanguage(Lang::Language _lang)
{
        lang = _lang;
}

void TokenStream::SetMaxWordLength(uint32_t length)
{
        buffer_max = length;
        current_token.termtext.reserve(buffer_max);
        current_token.normalizedterm.reserve(buffer_max);
}

/** Remove accents from Latin characters (range: 00C0-017F). This table is derived
    from the Unicode charts. Each accented character is replaced with its unaccented
    letter, if given in the charts. When no single letter is given or if the character
    is a ligature of multiple characters (for example 'æ'), the character is not
    replaced. */
const uint32_t RemoveAccentLatin[] =
//         0     1     2     3     4     5     6     7     8     9     A     B     C     D     E     F
/* 00C */{ 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0xC6, 0x43, 0x45, 0x45, 0x45, 0x45, 0x49, 0x49, 0x49, 0x49
/* 00D */, 0xD0, 0x4E, 0x4F, 0x4F, 0x4F, 0x4F, 0x4F, 0xD7, 0x4F, 0x55, 0x55, 0x55, 0x55, 0x59, 0xDE, 0xDF
/* 00E */, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0xE6, 0x63, 0x65, 0x65, 0x65, 0x65, 0x69, 0x69, 0x69, 0x69
/* 00F */, 0xF0, 0x6E, 0x6F, 0x6F, 0x6F, 0x6F, 0x6F, 0xF7, 0x6F, 0x75, 0x75, 0x75, 0x75, 0x79, 0xFE, 0x79
/* 010 */, 0x41, 0x61, 0x41, 0x61, 0x41, 0x61, 0x43, 0x63, 0x43, 0x63, 0x43, 0x63, 0x43, 0x63, 0x44, 0x64
/* 011 */, 0x110,0x111,0x45, 0x65, 0x45, 0x65, 0x45, 0x65, 0x45, 0x65, 0x45, 0x65, 0x47, 0x67, 0x47, 0x67
/* 012 */, 0x47, 0x67, 0x47, 0x67, 0x48, 0x68, 0x126,0x127,0x49, 0x69, 0x49, 0x69, 0x49, 0x69, 0x49, 0x69
/* 013 */, 0x49, 0x69, 0x132,0x133,0x4A, 0x6A, 0x4B, 0x6B, 0x138,0x4C, 0x6C, 0x4C, 0x6C, 0x4C, 0x6C, 0x4C
/* 014 */, 0x6C, 0x141,0x142,0x4E, 0x6E, 0x4E, 0x6E, 0x4E, 0x6E, 0x6E, 0x14A,0x14B,0x4F, 0x6F, 0x4F, 0x6F
/* 015 */, 0x4F, 0x6F, 0x152,0x153,0x52, 0x72, 0x52, 0x72, 0x52, 0x72, 0x53, 0x73, 0x53, 0x73, 0x53, 0x73
/* 016 */, 0x53, 0x73, 0x54, 0x74, 0x54, 0x74, 0x166,0x167,0x55, 0x75, 0x55, 0x75, 0x55, 0x75, 0x55, 0x75
/* 017 */, 0x55, 0x75, 0x55, 0x75, 0x57, 0x77, 0x59, 0x79, 0x59, 0x5A, 0x7A, 0x5A, 0x7A, 0x5A, 0x7A, 0x73
};

void NormalizeChar(uint32_t ch, std::string *buffer, Blex::Lang::Language lang)
{
        //ADDME: Optimize by providing a UTF8Encoder by reference when calling NormalizeChar?
        UTF8Encoder< std::back_insert_iterator<std::string> > utf8_output(std::back_inserter(*buffer));

        // German conversions
        if (lang == Lang::DE)
        {
                if ( (ch == 0xC4 || ch == 0xCB || ch == 0xCF || ch == 0xD6 || ch == 0xDC) //uppercase
                     || (ch == 0xE4 || ch == 0xEB || ch == 0xEF || ch == 0xF6 || ch == 0xFC) ) //lowercase
                {
                        // Remove umlaut and append "e"
                        uint32_t accentless = RemoveAccentLatin[ch - 0xC0];
                        if(!(accentless & 0xDF))
                            accentless |= 0x20;

                        buffer->push_back(char(accentless));
                        buffer->push_back('e');
                        return;
                }
        }

        // General conversions
        if (ch == 0xDF) // Convert 'ß' (ringel-S)
        {
                buffer->append("ss");
                return;
        }
        else if (ch == 0xC6 || ch == 0xE6) // AE/ae ligature
        {
                buffer->append("ae");
                return;
        }
        else if (ch == 0x132 || ch == 0x133) //IJ/ij ligature
        {
                buffer->append("ij");
                return;
        }
        else if (ch == 0x152 || ch == 0x153) //OE/oe ligature
        {
                buffer->append("oe");
                return;
        }

        if (ch >= 0xC0 && ch <= 0x17F)
        {
                // Remove accents
                ch = RemoveAccentLatin[ch - 0xC0];
        }

        // Apply lowercase
        if ( (ch >= 'A' && ch <= 'Z') || ch == 0xD0 || ch == 0xDE)
            ch |= 0x20;
        else if (ch == 0x110 || ch == 0x126 || ch == 0x141 || ch == 0x166)
            ++ch;

        utf8_output(ch);
}

std::string NormalizeString(const std::string &str, Blex::Lang::Language lang)
{
        Utf8Reader reader(str);
        std::string norm;
        uint32_t ch = reader.NextUCChar();
        while (ch)
        {
                NormalizeChar(ch, &norm, lang);
                reader.ReadChar();
                ch = reader.NextUCChar();
        }
        return norm;
}

} //end namespace Blex
