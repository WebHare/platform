#include <ap/libwebhare/allincludes.h>


#include <cmath>
#include "ctokenstream.h"

namespace Lucene
{

NormalizedTokenStream::~NormalizedTokenStream()
{
}

ConsilioToken::ConsilioToken()
{
        valid = false;
        startoffset = 0;
        endoffset = 0;
        type = ConsilioToken::Word;
        linktext = false;
        comment = false;
        match = false;
        stopword = false;
}

ConsilioToken::ConsilioToken(const std::string & text, const std::string &normtext, uint32_t start, uint32_t end, ConsilioToken::Type _type, bool is_linktext, bool is_comment)
{
        valid = true;
        term = text;
        normalizedterm = normtext;
        startoffset = start;
        endoffset = end;
        type = _type;
        linktext = is_linktext;
        comment = is_comment;
        match = false;
        stopword = false;
}

void NormalizedTokenStream::SetLang(Blex::Lang::Language _lang)
{
        mystr.SetLanguage(_lang);
}

ConsilioToken NormalizedTokenStream::Next()
{
        Blex::Token token;
        while (true)
        {
                if (buffered_tokens.size() > 0)
                {
                        token = buffered_tokens.front();
                        buffered_tokens.erase(buffered_tokens.begin());
                }
                else
                {
                        mystr.NextToken();
                        token = mystr.GetCurrentToken(); //ADDME: Optimize away this copy?
                }
                if (!token.valid)
                    break;

                switch (token.type)
                {
                        case Blex::Token::Word:
                        {
                                return ConsilioToken(token.termtext, token.normalizedterm, token.startoffset, token.endoffset, ConsilioToken::Word, parsing_link, parsing_comment);
                        }
                        case Blex::Token::Punct:
                        {
                                parsing_comment = parsing_comment || (token.termtext.find_first_of("#;") != std::string::npos);

                                // See if we got punctuation the parser is particularly interested in
                                if (token.termtext.find_first_of("+-:\"~^.,()[]{}@") != std::string::npos)
                                    return ConsilioToken(token.termtext, token.normalizedterm, token.startoffset, token.endoffset, ConsilioToken::ParserPunct, parsing_link, parsing_comment);
                                else
                                    return ConsilioToken(token.termtext, token.normalizedterm, token.startoffset, token.endoffset, ConsilioToken::Punct, parsing_link, parsing_comment);
                        }
                        case Blex::Token::Control:
                        {
                                if (token.termtext[0] == 0x1E)
                                {
                                        // We should get a Word first...
                                        mystr.NextToken();
                                        token = mystr.GetCurrentToken(); //ADDME: Optimize away this copy?
                                        buffered_tokens.push_back(token);
                                        if (token.type != Blex::Token::Word)
                                            break;

                                        // This token contains the language code,
                                        // t is the token to return
                                        ConsilioToken t = ConsilioToken(token.termtext, token.normalizedterm, token.startoffset, token.endoffset, ConsilioToken::Lang, parsing_link, parsing_comment);

                                        // ...and finally a Control 0x1E
                                        mystr.NextToken();
                                        token = mystr.GetCurrentToken();
                                        buffered_tokens.push_back(token);
                                        if (token.type != Blex::Token::Control || token.termtext[0] != 0x1E)
                                            break;

                                        // We got a valid language switch, remove
                                        // buffered tokens we no longer need and
                                        // return t
                                        buffered_tokens.resize(buffered_tokens.size()-2);
                                        return t;
                                }
                                else if (token.termtext[0] == 0x1F)
                                {
                                        parsing_link = !parsing_link;
                                }
                                break;
                        }
                        case Blex::Token::Whitespace:
                        {
                                parsing_comment = parsing_comment && token.termtext.find_first_of("\r\n") == std::string::npos;
                                return ConsilioToken(token.termtext, token.normalizedterm, token.startoffset, token.endoffset, ConsilioToken::Whitespace, parsing_link, parsing_comment);
                        }
                        // Unrecognized token type, process next token
                }
        }
        return ConsilioToken();
}

ConsilioToken StemmedTokenStream::Next()
{
        // Only try to stem if a language was set
        if (mystr.GetCurrentLanguage() == Blex::Lang::None)
            return NormalizedTokenStream::Next();

        ConsilioToken t = NormalizedTokenStream::Next();
        if (!t.valid)
            // This is the last token
            return t;

        // Only stem if we got a normalized word
        if (t.type != ConsilioToken::Word)
            return t;

        // Generate the stemmed term
        t.stemmedterm = stemmer.Stem(t.normalizedterm);
        if (t.stemmedterm == t.normalizedterm)
            t.stemmedterm.clear();
        return t;
}

void StemmedTokenStream::SetLang(Blex::Lang::Language _lang)
{
        // Set stemmer language
        stemmer.SetLanguage(_lang);
        NormalizedTokenStream::SetLang(_lang);
}

ConsilioToken StopWordFilterTokenStream::Next()
{
        // Only filter if a language was set
        if (mystr.GetCurrentLanguage() == Blex::Lang::None)
            return StemmedTokenStream::Next();

        ConsilioToken t = StemmedTokenStream::Next();
        if (!t.valid)
            // This is the last token
            return t;

        // Only filter normalized words
        if (t.type == ConsilioToken::Word && t.stemmedterm.empty())
            t.stopword = stopwordfilter.IsStopWord(t.normalizedterm);

        return t;
}

void StopWordFilterTokenStream::SetLang(Blex::Lang::Language _lang)
{
        // Set stop word filter language
        stopwordfilter.SetLanguage(_lang);
        StemmedTokenStream::SetLang(_lang);
}

} // namespace Lucene

