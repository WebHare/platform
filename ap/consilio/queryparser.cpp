#include <ap/libwebhare/allincludes.h>


#include <cmath>
#include "queryparser.h"
#include "wildcardquery.h"
#include "ctokenstream.h"

namespace Lucene
{

// Boost factors for different types of query terms
const float title_boost = 5;
const float keywords_boost = 10;
const float description_boost = 5;
const float body_boost = 1;
//const float initial_body_boost = .7;
const float stemmed_factor = .5;
const float stopword_factor = .1;

enum ParserStates
{
        NONE,
        BoostFactor,
        DirectPhraseStart,
        DirectPhraseText,
        Field,
        PhraseEnd,
        PhraseSep,
        PhraseStart,
        PhraseText,
        RangeEnd,
        RangeLower,
        RangeSep,
        RangeStart,
        RangeUpper,
        Requirement,
        SlopFactor,
        SubQuery,
        TermState, // Not "Term", as Lucene::Term is already defined
        Text,
        UntokenizedText
};

struct ParserState
{
        ParserState()
        : state(ParserStates::NONE)
        , subquery_end(false)
        , includelower(false)
        , has_field(false)
        , word_only(false)
        {}

        ParserState(ParserStates _state)
        : state(_state)
        , subquery_end(false)
        , includelower(false)
        , has_field(false)
        , word_only(false)
        {}

        ParserStates state;

        bool subquery_end;
        std::string lowerterm;
        bool includelower;
        std::string upperterm;
        bool has_field;
        bool word_only;
};

//ADDME: Support for query composition with parentheses
QueryParser::QueryParser(Require _defaultrequire)
{
        defaultrequire = _defaultrequire;
}

void QueryParser::SetDefaultRequirement(Require _defaultrequire)
{
        defaultrequire = _defaultrequire;
}

ParsedQuery QueryParser::Parse(const std::string &query, Blex::Lang::Language lang)
{
        // Init
        reader.reset(new StopWordFilterTokenStream(query));
        reader->SetLang(lang);
        reader->SetMaxWordLength(MAX_WORD_LENGTH);
        std::shared_ptr< BooleanQuery > root_query;

        parsed_queries.clear();
        root_query.reset(new BooleanQuery());
        parsed_queries.push_back(root_query);

        parser_depth = 0;
        query_term = NULL; // No terms yet
        parsed_filters.clear();
        parsed_words.clear();
        query_words.clear();
        query_stopterm = false;

        // Goto first state
        query_token = reader->Next();
        RunParser(ParserState(ParserStates::TermState));

        // If we were parsing a term, add it
        FlushTerms();

        reader.reset();
        return ParsedQuery(parsed_queries[0], parsed_filters, parsed_words);
}

void QueryParser::RunParser(ParserState state)
{
        if (parser_depth == 100)
            return;
        ++parser_depth;

        while (state.state != ParserStates::NONE)
        {
                switch (state.state)
                {
                        case ParserStates::NONE:              break;
                        case ParserStates::BoostFactor:       state = State_BoostFactor(state.subquery_end); break;
                        case ParserStates::DirectPhraseStart: state = State_DirectPhraseStart(); break;
                        case ParserStates::DirectPhraseText:  state = State_DirectPhraseText(); break;
                        case ParserStates::Field:             state = State_Field(); break;
                        case ParserStates::PhraseEnd:         state = State_PhraseEnd(); break;
                        case ParserStates::PhraseSep:         state = State_PhraseSep(); break;
                        case ParserStates::PhraseStart:       state = State_PhraseStart(); break;
                        case ParserStates::PhraseText:        state = State_PhraseText(); break;
                        case ParserStates::RangeEnd:          state = State_RangeEnd(state.lowerterm, state.includelower, state.upperterm); break;
                        case ParserStates::RangeLower:        state = State_RangeLower(state.includelower); break;
                        case ParserStates::RangeSep:          state = State_RangeSep(state.lowerterm, state.includelower); break;
                        case ParserStates::RangeStart:        state = State_RangeStart(); break;
                        case ParserStates::RangeUpper:        state = State_RangeUpper(state.lowerterm, state.includelower); break;
                        case ParserStates::Requirement:       state = State_Requirement(); break;
                        case ParserStates::SlopFactor:        state = State_SlopFactor(); break;
                        case ParserStates::SubQuery:          state = State_SubQuery(); break;
                        case ParserStates::TermState:         state = State_Term(); break;
                        case ParserStates::Text:              state = State_Text(state.has_field); break;
                        case ParserStates::UntokenizedText:   state = State_UntokenizedText(state.word_only); break;
                }

                if (parser_depth == 1 && state.state == ParserStates::NONE && query_token.valid)
                {
                        query_token = reader->Next();
                        state = ParserState(ParserStates::TermState);
                }
        }
        --parser_depth;
}

ParserState QueryParser::State_SubQuery()
{
        std::shared_ptr< BooleanQuery > subquery;
        subquery.reset(new BooleanQuery());

        Require subrequire = require;

        parsed_queries.push_back(subquery);

        query_token = reader->Next(); // Eat '('
        RunParser(ParserState(ParserStates::TermState));

        if (!FlushTerms())
            return ParserState();

        if (query_token.term[0] == ')')
            query_token = reader->Next(); // Eat ')'

        if (query_token.term[0] == '^')
        {
                ParserState state(ParserStates::BoostFactor);
                state.subquery_end = true;
                RunParser(state);
        }

        parsed_queries.pop_back();
        if (subquery->GetClauses().size())
            parsed_queries.back()->Add(subquery, subrequire == Required, subrequire == Prohibited);

        return ParserState(ParserStates::TermState);
}

ParserState QueryParser::State_Term()
{
        if (!FlushTerms())
            return ParserState();

        // Initialize subquery
        require = defaultrequire; // Switch to default requirement for new term
        query_field.clear(); // Field to search
        query_word.clear(); // Word to look for

        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                return ParserState(ParserStates::Text);
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == ')')
                                    return ParserState();
                                else if (query_token.term[0] == '(')
                                    return ParserState(ParserStates::SubQuery);
                                else if (query_token.term[0] == '"')
                                    return ParserState(ParserStates::PhraseStart);
                                else if (query_token.term[0] == '-' || query_token.term[0] == '+')
                                    return ParserState(ParserStates::Requirement);
                        } //fallthrough
                        default:
                        {
                        }
                }
                query_token = reader->Next(); // Eat unknown token, read next and start over
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_UntokenizedText(bool word_only)
{
        query_word.clear(); // Clear the field name

        bool have_quotes = false;
        bool next_escaped = false;
        if (query_token.term[0] == '\"')
        {
                have_quotes = true;
                query_token = reader->Next(); // Eat opening quote
        }

        // Parse the untokenized text, end at whitespace, '(' or ')', '{', '}', '[', ']', ','
        while (true)
        {
                if (!query_token.valid) // Invalid token means end of untokenized text
                    break;

                if (query_token.type == ConsilioToken::Whitespace && !have_quotes)
                    break;

                if (query_token.type == ConsilioToken::ParserPunct)
                {
                        if (!have_quotes)
                        {
                                  if (query_token.term[0] == '(' || query_token.term[0] == ')'
                                        || query_token.term[0] == '{' || query_token.term[0] == '}'
                                        || query_token.term[0] == '[' || query_token.term[0] == ']'
                                        || query_token.term[0] == ',')
                                      break;
                        }
                        else if (!next_escaped && query_token.term[0] == '"')
                        {
                                query_token = reader->Next(); // Eat current token
                                break;
                        }
                }

                if (!next_escaped && query_token.term[0] == '\\')
                    next_escaped = true;
                else
                    next_escaped = false;

                query_word += query_token.term;

                query_token = reader->Next(); // Eat current token
        }
        if (have_quotes)
        {
                std::string decoded;
                Blex::DecodeJava(query_word.begin(), query_word.end(), std::back_inserter(decoded));
                query_word = decoded;
        }
        if (word_only)
            return ParserState(); // We don't want a term created, just read a word and return

        // Create the query term
        query_term = new TermQuery(Term(query_field, query_word));

        query_field.clear(); // Field to search
        query_word.clear(); // Word to look for

        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == ')')
                                    return ParserState();
                                else if (query_token.term[0] == '^')
                                    return ParserState(ParserStates::BoostFactor);
                                // Field is done, return
                        } //fallthrough
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_Requirement()
{
        if (query_token.term[0] == '+')
            require = Required;
        else if (query_token.term[0] == '-')
            require = Prohibited;

        query_token = reader->Next(); // Eat '+' or '-'
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                return ParserState(ParserStates::Text);
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == ')')
                                    return ParserState();
                                else if (query_token.term[0] == '(')
                                    return ParserState(ParserStates::SubQuery);
                                else if (query_token.term[0] == '"')
                                    return ParserState(ParserStates::PhraseStart);
                        } //fallthrough
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_Text(bool has_field)
{
        query_stopterm = query_token.stopword;
        query_word = query_token.normalizedterm;

        if (query_token.valid)
        {
                // Make search term with query word and stemmed word, if available
                query_term = MakeSearchTerm(query_stopterm, query_field, query_word, query_token.stemmedterm);

                // If we didn't read a field name yet, this might be it
                if (!has_field)
                {
                        query_field = query_word;

                        // Support for "field.member@module" field names
                        ConsilioToken next_token = reader->Next(); // Eat word
                        while (next_token.valid && next_token.type == ConsilioToken::ParserPunct
                            && (next_token.term[0] == '@' || next_token.term[0] == '.'))
                        {
                            std::string punct = next_token.term;
                            next_token = reader->Next(); // Eat '@' or '.'

                            if (next_token.valid && next_token.type == ConsilioToken::Word)
                            {
                                query_field += punct + next_token.normalizedterm;
                                next_token = reader->Next(); // Eat word
                            }
                            else
                                break;
                        }
                        query_token = next_token;
                }
                else
                    query_token = reader->Next(); // Eat word
        }
        else
            query_token = reader->Next(); // Eat word

        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::ParserPunct:
                        {
                                if (!has_field && query_token.term[0] == ':')
                                    return ParserState(ParserStates::Field);
                                else if (query_token.term[0] == '^')
                                    return ParserState(ParserStates::BoostFactor);
                                else if (query_token.term[0] == ')')
                                    return ParserState();
                                // Fall through to normal punctuation, which starts a direct phrase
                        } //fallthrough
                        case ConsilioToken::Punct:
                        {
                                if (!has_field)
                                    query_field = "";

                                return ParserState(ParserStates::DirectPhraseStart);
                        }
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_Field()
{
        // The last word was the field name to search, delete current subquery
        delete query_term;
        query_term = NULL;
        query_words.clear();
        query_stopterm = false;

        query_token = reader->Next(); // Eat ':'
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                if (!IsTokenizedField(query_field))
                                    return ParserState(ParserStates::UntokenizedText);
                                else
                                {
                                        ParserState state(ParserStates::Text);
                                        state.has_field = true;
                                        return state;
                                }
                        } break;
                        case ConsilioToken::Punct:
                        {
                                if (query_token.term[0] == '*')
                                {
                                        // Consilio doesn't have a dedicated 'field exists' query type, so use a RangeFilter
                                        // that matches all text as a fallback
                                        FilterPtr rangefilter(new RangeFilter(query_field, "0", "", true, false));
                                        parsed_filters.push_back(rangefilter);
                                        query_token = reader->Next(); // Eat '*'
                                        return ParserState(ParserStates::TermState);
                                }
                        } break;
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '[' || query_token.term[0] == '{')
                                    return ParserState(ParserStates::RangeStart);
                                else if (query_token.term[0] == ')')
                                    break;
                                else
                                {
                                        if (!IsTokenizedField(query_field))
                                            return ParserState(ParserStates::UntokenizedText);
                                        else if (query_token.term[0] == '"')
                                            return ParserState(ParserStates::PhraseStart);
                                }
                                return ParserState();
                        }
                        default:
                        {
                        }
                }
                if (!IsTokenizedField(query_field))
                    return ParserState(ParserStates::UntokenizedText);
                else
                {
                        // Let Term handle the unknown token
                        return ParserState(ParserStates::TermState);
                }
        }
        return ParserState();
}

ParserState QueryParser::State_RangeStart()
{
        bool includelower = query_token.term[0] == '[';
        query_word.clear();

        query_token = reader->Next(); // Eat '[' or '{'
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                ParserState state(ParserStates::RangeLower);
                                state.includelower = includelower;
                                return state;
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == ',')
                                {
                                        ParserState state(ParserStates::RangeSep);
                                        state.includelower = includelower;
                                        return state;
                                }
                        } //fallthrough
                        default:
                        {
                        }
                }
                if (!IsTokenizedField(query_field))
                {
                        ParserState state(ParserStates::RangeLower);
                        state.includelower = includelower;
                        return state;
                }
                else
                {
                        // Let Term handle the unknown token
                        return ParserState(ParserStates::TermState);
                }
        }
        return ParserState();
}

ParserState QueryParser::State_RangeLower(bool includelower)
{
        std::string lowerterm;
        if (!IsTokenizedField(query_field))
        {
                ParserState state(ParserStates::UntokenizedText);
                state.word_only = true;
                RunParser(state);
                lowerterm = query_word;
        }
        else
        {
                lowerterm = query_word.empty() ? query_token.normalizedterm : (query_word + query_token.term);

                query_token = reader->Next(); // Eat lower term
        }
        if (query_token.valid) // Invalid token means end of text
        {
                if (query_token.type == ConsilioToken::ParserPunct && query_token.term[0] == ',')
                {
                        ParserState state(ParserStates::RangeSep);
                        state.lowerterm = lowerterm;
                        state.includelower = includelower;
                        return state;
                }
                else
                    // Let Term handle the unknown token
                    return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_RangeSep(const std::string &lowerterm, bool includelower)
{
        query_word.clear();

        query_token = reader->Next(); // Eat ','
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                ParserState state(ParserStates::RangeUpper);
                                state.lowerterm = lowerterm;
                                state.includelower = includelower;
                                return state;
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == ']' || query_token.term[0] == '}')
                                {
                                        ParserState state(ParserStates::RangeEnd);
                                        state.lowerterm = lowerterm;
                                        state.includelower = includelower;
                                        return state;
                                }
                        } //fallthrough
                        default:
                        {
                        }
                }
                if (!IsTokenizedField(query_field))
                {
                        ParserState state(ParserStates::RangeUpper);
                        state.lowerterm = lowerterm;
                        state.includelower = includelower;
                        return state;
                }
                else
                {
                        // Let Term handle the unknown token
                        return ParserState(ParserStates::TermState);
                }
        }
        return ParserState();
}

ParserState QueryParser::State_RangeUpper(const std::string &lowerterm, bool includelower)
{
        std::string upperterm;
        if (!IsTokenizedField(query_field))
        {
                ParserState state(ParserStates::UntokenizedText);
                state.word_only = true;
                RunParser(state);
                upperterm = query_word;
        }
        else
        {
                upperterm = query_word.empty() ? query_token.normalizedterm : (query_word + query_token.term);

                query_token = reader->Next(); // Eat lower term
        }

        if (query_token.valid) // Invalid token means end of text
        {
                if (query_token.type == ConsilioToken::ParserPunct && (query_token.term[0] == ']' || query_token.term[0] == '}'))
                {
                        ParserState state(ParserStates::RangeEnd);
                        state.lowerterm = lowerterm;
                        state.includelower = includelower;
                        state.upperterm = upperterm;
                        return state;
                }
                else
                    // Let Term handle the unknown token
                    return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_RangeEnd(const std::string &lowerterm, bool includelower, const std::string &upperterm)
{
        // query_field holds the field name
        bool includeupper = query_token.term[0] == ']';

        // Only apply filter if not lowerterm and upperterm are both empty
        if (!(lowerterm.empty() && upperterm.empty()))
        {
                FilterPtr rangefilter(new RangeFilter(query_field, lowerterm, upperterm, includelower, includeupper));
                parsed_filters.push_back(rangefilter);
        }

        query_token = reader->Next(); // Eat ']' or '}'
        if (query_token.valid) // Invalid token means end of text
            return ParserState(ParserStates::TermState);
        return ParserState();
}

ParserState QueryParser::State_PhraseStart()
{
        query_term = new PhraseQuery();

        query_token = reader->Next(); // Eat '"'
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                return ParserState(ParserStates::PhraseText);
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '"')
                                {
                                        // Empty term, delete it
                                        delete query_term;
                                        query_term = NULL;
                                        query_words.clear();

                                        // Go to next term
                                        query_token = reader->Next(); // Eat '"'
                                        return ParserState(ParserStates::TermState);
                                }
                        } //fallthrough
                        default:
                        {
                        }
                }
                // Not a word, read next token
                return ParserState(ParserStates::PhraseSep);
        }
        return ParserState();
}

ParserState QueryParser::State_PhraseText()
{
//ADDME: Search other fields as well (maybe we should have a PhraseQuery per field?)
        if (query_token.type == ConsilioToken::Word)
        {
                if (query_field.empty())
                {
                        ((PhraseQuery *)query_term)->Add(Term("body", query_token.normalizedterm));
                        query_words.insert(query_token.normalizedterm);
                }
                else
                {
                        ((PhraseQuery *)query_term)->Add(Term(query_field, query_token.normalizedterm));

                        // Add the query word if searching through body or title
                        if (query_field == "body" || query_field == "title")
                            query_words.insert(query_token.normalizedterm);
                }
                query_token = reader->Next(); // Eat word
        }

        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '"')
                                    return ParserState(ParserStates::PhraseEnd);
                        }
                        //fallthrough
                        default:
                        {
                        }
                }
                // Not a word, read next token
                return ParserState(ParserStates::PhraseSep);
        }
        return ParserState();
}

ParserState QueryParser::State_PhraseSep()
{
        query_token = reader->Next(); // Eat non-word token
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                return ParserState(ParserStates::PhraseText);
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '"')
                                    return ParserState(ParserStates::PhraseEnd);
                        } //fallthrough
                        default:
                        {
                        }
                }
                // Not a word, read next token
                return ParserState(ParserStates::PhraseSep);
        }
        return ParserState();
}

ParserState QueryParser::State_PhraseEnd()
{
        query_token = reader->Next(); // Eat '"'
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '~')
                                    return ParserState(ParserStates::SlopFactor);
                                else if (query_token.term[0] == '^')
                                    return ParserState(ParserStates::BoostFactor);
                                else if (query_token.term[0] == ')')
                                    return ParserState();
                        } //fallthrough
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_DirectPhraseStart()
{
        if (typeid(*query_term) != typeid(PhraseQuery))
        {
                // The last word was the first phrase term, delete current subquery
                delete query_term;
                query_term = new PhraseQuery();
                query_words.clear();

                if (query_field.empty())
                {
                        ((PhraseQuery *)query_term)->Add(Term("body", query_word));
                        query_words.insert(query_word);
                }
                else
                {
                        ((PhraseQuery *)query_term)->Add(Term(query_field, query_word));

                        // Clear the query word if not searching for body or title
                        if (query_field == "body" || query_field == "title")
                            query_words.insert(query_word);
                }
        }

        if (query_token.term[0] == ')')
            return ParserState();

        query_token = reader->Next(); // Eat '+' or '-'
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                return ParserState(ParserStates::DirectPhraseText);
                        }
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_DirectPhraseText()
{
        if (query_token.type == ConsilioToken::Word)
        {
                if (query_field.empty())
                {
                        ((PhraseQuery *)query_term)->Add(Term("body", query_token.normalizedterm));
                        query_words.insert(query_token.normalizedterm);
                }
                else
                {
                        ((PhraseQuery *)query_term)->Add(Term(query_field, query_token.normalizedterm));

                        // Add the query word if searching through body or title
                        if (query_field == "body" || query_field == "title")
                            query_words.insert(query_token.normalizedterm);
                }
        }

        query_token = reader->Next(); // Eat (stemmed) word
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::Word:
                        {
                                return ParserState(ParserStates::DirectPhraseText);
                        }
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '~')
                                    return ParserState(ParserStates::SlopFactor);
                                else if (query_token.term[0] == '^')
                                    return ParserState(ParserStates::BoostFactor);
                                else if (query_token.term[0] == ')')
                                    return ParserState();
                                // Fall through to normal punctuation, which continues direct phrase
                        } //fallthrough
                        case ConsilioToken::Punct:
                        {
                                return ParserState(ParserStates::DirectPhraseStart);
                        }
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_SlopFactor()
{
        query_token = reader->Next(); // Eat '~'
        if (!query_token.valid)
            return ParserState();

        // Read slop factor (unsigned integer)
        ((PhraseQuery *)query_term)->SetSlop(Blex::DecodeUnsignedNumber<uint32_t>(query_token.term.begin(),query_token.term.end()).first);

        query_token = reader->Next(); // Eat number
        if (query_token.valid) // Invalid token means end of text
        {
                switch (query_token.type)
                {
                        case ConsilioToken::ParserPunct:
                        {
                                if (query_token.term[0] == '^')
                                    return ParserState(ParserStates::BoostFactor);
                                else if (query_token.term[0] == ')')
                                    return ParserState();
                        } //fallthrough
                        default:
                        {
                        }
                }
                // Let Term handle the unknown token
                return ParserState(ParserStates::TermState);
        }
        return ParserState();
}

ParserState QueryParser::State_BoostFactor(bool subquery_end)
{
        query_token = reader->Next(); // Eat '^'
        if (!query_token.valid)
            return ParserState();

        // Read boost factor (unsigned float)
        float boost = 0;
        uint32_t intpart = 0;
        if (query_token.type == ConsilioToken::Word)
        {
                intpart = Blex::DecodeUnsignedNumber<uint32_t>(query_token.term.begin(),query_token.term.end()).first;
                boost = intpart;

                query_token = reader->Next(); // Eat number
        }
        if (query_token.valid && query_token.type == ConsilioToken::ParserPunct && query_token.term[0] == '.')
        {
                query_token = reader->Next(); // Eat '.'
                if (!query_token.valid)
                    return ParserState();

                int factor = query_token.term.size();
                uint32_t decimals = Blex::DecodeUnsignedNumber<uint32_t>(query_token.term.begin(),query_token.term.end()).first;
                float f = 1;
                for (int i = 0; i < factor; ++i)
                    f *= 10;
                boost = intpart + (decimals / f);

                query_token = reader->Next(); // Eat number
        }
        if (boost > 0)
        {
                if (subquery_end)
                    parsed_queries.back()->SetBoost(boost);
                else
                    query_term->SetBoost(boost);
        }

        if (!subquery_end)
            return ParserState(ParserStates::TermState);
        return ParserState();
}

BooleanQuery *QueryParser::MakeSearchTerm(bool stopterm, const std::string &field, const std::string &text, const std::string &stemmedtext)
{
        BooleanQuery * searchterm = new BooleanQuery();

        if (field.empty())
        {
                // Search title
                TermQuery * subquery = new TermQuery(Term("title", text));
                subquery->SetBoost((stopterm ? stopword_factor : 1) * title_boost);
                searchterm->Add(QueryPtr(subquery), false, false);

                // Search keywords
                subquery = new TermQuery(Term("keywords", text));
                subquery->SetBoost((stopterm ? stopword_factor : 1) * keywords_boost);
                searchterm->Add(QueryPtr(subquery), false, false);

                // Search description
                subquery = new TermQuery(Term("description", text));
                subquery->SetBoost((stopterm ? stopword_factor : 1) * description_boost);
                searchterm->Add(QueryPtr(subquery), false, false);

                // Search body text
                subquery = new TermQuery(Term("body", text));
                subquery->SetBoost((stopterm ? stopword_factor : 1) * body_boost);
                searchterm->Add(QueryPtr(subquery), false, false);

                // Search body text with initial keyword search
/*Disabled for now
                if (text.size() > 4)
                {
                        WildcardQuery * startquery = new WildcardQuery(Term("body", text+"*"));
                        startquery->SetBoost((stopterm ? stopword_factor : 1) * initial_body_boost);
                        searchterm->Add(QueryPtr(startquery), false, false);
                }
*/

                query_words.insert(text);

                // Stemmed term?
                if (!stemmedtext.empty())
                {
                        // Search title
                        subquery = new TermQuery(Term("title", stemmedtext));
                        subquery->SetBoost((stopterm ? stopword_factor : 1) * stemmed_factor * title_boost);
                        searchterm->Add(QueryPtr(subquery), false, false);

                        // Search body text
                        subquery = new TermQuery(Term("body", stemmedtext));
                        subquery->SetBoost((stopterm ? stopword_factor : 1) * stemmed_factor * body_boost);
                        searchterm->Add(QueryPtr(subquery), false, false);

                        query_words.insert(stemmedtext);
                }
        }
        else
        {
                // Search given field
                TermQuery * subquery = new TermQuery(Term(field, text));
                subquery->SetBoost((stopterm ? stopword_factor : 1) * body_boost);
                searchterm->Add(QueryPtr(subquery), false, false);

                if (!stemmedtext.empty())
                {
                        // Search given field
                        subquery = new TermQuery(Term(field, stemmedtext));
                        subquery->SetBoost((stopterm ? stopword_factor : 1) * stemmed_factor * body_boost);
                        searchterm->Add(QueryPtr(subquery), false, false);
                }

                //if (field == "body" || field == "title")
                {
                        query_words.insert(text);

                        if (!stemmedtext.empty())
                            query_words.insert(stemmedtext);
                }
        }

        return searchterm;
}

bool QueryParser::FlushTerms()
{
        if (query_term)
        {
                // Check the maximum number of boolean clauses before adding
                if (parsed_queries.back()->GetClauses().size() < parsed_queries.back()->GetMaxClauseCount())
                {
                        parsed_queries.back()->Add(QueryPtr(query_term), require == Required, require == Prohibited);
                        if (require != Prohibited)
                            parsed_words.insert(query_words.begin(), query_words.end());
                        query_term = NULL;
                        query_words.clear();
                        query_stopterm = false;
                }
                else
                {
                        // Not adding this query_term, so delete it
                        delete query_term;
                        query_term = NULL;
                        query_words.clear();
                        query_stopterm = false;

                        // No more terms to add
                        return false;
                }
        }
        return true;
}

} // namespace Lucene

