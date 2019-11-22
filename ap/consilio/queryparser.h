#ifndef blex_consilio_search_queryparser
#define blex_consilio_search_queryparser

#include "query.h"
#include "booleanquery.h"
#include "phrasequery.h"
#include "termquery.h"
#include "ctokenstream.h"
#include <blex/stream.h>

namespace Lucene
{

/** QueryParser results record */
struct ParsedQuery
{
        /// A searchable Lucene query
        QueryPtr query;
        /// Filters found in the query (e.g. range queries)
        std::vector<FilterPtr> filters;
        /// All single words found in the query
        std::set<std::string> words;

        ParsedQuery(QueryPtr _query, std::vector<FilterPtr> _filters, std::set<std::string> _words)
        : query(_query)
        , filters(_filters)
        , words(_words)
        {}

        ParsedQuery()
        {}
};

struct ParserState;


/** The QueryParser reads a query string typed in by a user, and parses it into
    a Lucene Query.

    The QueryParser is a simple state machine, which reads a string from left to
    right and builds a compound Query using BooleanQuery%s. It looks one byte ahead
    to determine the subquery type. If an unknown character is encountered, the
    current subquery is added to the query and a new subquery is started.

    Queries should have the following form (in BNF):
    @code
query        ::= subquery (whitespace subquery)*
subquery     ::= requirement? clause
clause       ::= field? (term | phrase) boostfactor?
                 '(' query ')'
field        ::= alnum+ ':'
term         ::= alnum+
phrase       ::= (quotephrase | directphrase) slopfactor?
quotephrase  ::= '"' term (whitespace term)* '"'
directphrase ::= term punct term (punct term)*

boostfactor  ::= '^' float
slopfactor   ::= '~' float

alnum        ::= letter | digit
float        ::= digit* '.' digit+
whitespace   ::= (' ' | '\t' | '\r' | '\n')+
requirement  ::= '+' | '-'
punct        ::= all characters, except alnum, whitespace, '^', '~'
    @endcode */
class QueryParser
{
    public:
        /// Subquery requirement
        enum Require
        {
                Allowed,        ///< Documents may match the query
                Required,       ///< Documents must match the query
                Prohibited      ///< Documents must not match the query
        };

        /** Create a QueryParser.
            @param defaultrequire The default requirement for subqueries (when
                                  not given, the default default requirement value
                                  Allowed is used) */
        QueryParser(Require defaultrequire = Allowed);

        /** Set the default requirement for subqueries. If the requirement characters
            '+' and '-' are not used, this is the default Require value.
            @param defaultrequire The default requirement for subqueries */
        void SetDefaultRequirement(Require defaultrequire);

        /** Parse a query string. The parsed Query is returned, along with a list
            of all the words that were found in the query string.
            @param query The query string to parse
            @param lang The language to use, defaults to None (don't use stemming)
            @return The parsed Query and a list of query words */
        ParsedQuery Parse(const std::string &query, Blex::Lang::Language lang = Blex::Lang::None);

    private:
        /// Requirement of the current subquery
        Require require;

        /// Default requirement for subqueries (when not using requirement
        /// characters '+' and '-')
        Require defaultrequire;

        /// The stream reader
        std::shared_ptr<NormalizedTokenStream> reader;

        /// The current subquery parsing depth
        int parser_depth;

        /// The parsed query stack
        std::vector< std::shared_ptr< BooleanQuery > > parsed_queries;
        /// Parsed filters
        std::vector<FilterPtr> parsed_filters;
        /// The words in the query
        std::set<std::string> parsed_words;

        /// The current token
        ConsilioToken query_token;
        /// Store a query term while parsing
        Query *query_term;
        /// Field to search
        std::string query_field;
        /// The current subquery word (normalized, not stemmed)
        std::string query_word;
        /// The words in the current subquery
        std::set<std::string> query_words;
        /// The current term is a stop word term
        bool query_stopterm;

        /** Create a compound Query for a given search word. The new Query searches
            for the word in body, title, keywords and description.
            @param stopterm The search word is a stop word (add with lower priority)
            @param field The field to search (leave empty for default)
            @param text The search word
            @param stemmedtext Stemmed search word, if any
            @return A new compound Query */
        BooleanQuery *MakeSearchTerm(bool stopterm, const std::string &field, const std::string &text, const std::string &stemmedtext = std::string());

        /** If query_term exists, it is added to the parsed query.
            @return If more terms can be added */
        bool FlushTerms();

        void RunParser(ParserState firststate);

    // The different QueryParser states:

        /// Reading (next) term
        ParserState State_Term();

        /// Reading untokenized text
        ParserState State_UntokenizedText(bool word_only);

        /// Reading requirement (Required or Prohibited)
        ParserState State_Requirement();

        /// Reading single search term
        ParserState State_Text(bool has_field = false);

        /// Reading field
        ParserState State_Field();

        /// Reading subquery
        ParserState State_SubQuery();

        /// Start reading a range filter
        ParserState State_RangeStart();
        /// Reading the lower range term
        ParserState State_RangeLower(bool includelower);
        /// Moving on to upper range term
        ParserState State_RangeSep(const std::string &lowerterm, bool includelower);
        /// Reading the upper range term
        ParserState State_RangeUpper(const std::string &lowerterm, bool includelower);
        /// Add the range filter
        ParserState State_RangeEnd(const std::string &lowerterm, bool includelower, const std::string &upperterm);

        /// Start reading phrase terms
        ParserState State_PhraseStart();
        /// Adding single search term to phrase term
        ParserState State_PhraseText();
        /// Not adding non-word text
        ParserState State_PhraseSep();
        /// Stop reading phrase terms
        ParserState State_PhraseEnd();
        /// Reading slop factor for phrase term
        ParserState State_SlopFactor();

        /// Started phrase separated with '+' or '-' (e.g. hello-world)
        ParserState State_DirectPhraseStart();
        /// Adding single search term to phrase term
        ParserState State_DirectPhraseText();

        /** Reading boost factor for term + further terms
            or nested query
            @param subquery_end If true, used for the end of a subquery (must not
        */
        ParserState State_BoostFactor(bool subquery_end);
};

} // namespace Lucene

#endif

