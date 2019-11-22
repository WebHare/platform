#include <ap/libwebhare/allincludes.h>


#include <blex/testing.h>

#include "../langspecific.h"
#include "../queryparser.h"
#include "../query.h"

using namespace Lucene;

namespace TestQueries
{

BLEX_TEST_FUNCTION(TestQueryParserBasics)
{
        QueryParser parser;
        ParsedQuery query;

        // Just one word
        query = parser.Parse("transfer");
        BLEX_TEST_CHECKEQUAL("(title:transfer^5 keywords:transfer^10 description:transfer^5 transfer)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Just one word, with boost factor
        query = parser.Parse("transfer^7");
        BLEX_TEST_CHECKEQUAL("((title:transfer^5 keywords:transfer^10 description:transfer^5 transfer)^7)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Just one word, with boost factor
        query = parser.Parse("transfer^7.7");
        BLEX_TEST_CHECKEQUAL("((title:transfer^5 keywords:transfer^10 description:transfer^5 transfer)^7.7)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Multiple words
        query = parser.Parse("transfer protocol");
        BLEX_TEST_CHECKEQUAL("(title:transfer^5 keywords:transfer^10 description:transfer^5 transfer) (title:protocol^5 keywords:protocol^10 description:protocol^5 protocol)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Multiple words, with boost factor
        query = parser.Parse("transfer^3 protocol^8");
        BLEX_TEST_CHECKEQUAL("((title:transfer^5 keywords:transfer^10 description:transfer^5 transfer)^3) ((title:protocol^5 keywords:protocol^10 description:protocol^5 protocol)^8)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Multiple words, with boost factor
        query = parser.Parse("transfer^3.4 protocol^8.9");
        BLEX_TEST_CHECKEQUAL("((title:transfer^5 keywords:transfer^10 description:transfer^5 transfer)^3.4) ((title:protocol^5 keywords:protocol^10 description:protocol^5 protocol)^8.9)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Required/prohibited words
        query = parser.Parse("+transfer -protocol");
        BLEX_TEST_CHECKEQUAL("+(title:transfer^5 keywords:transfer^10 description:transfer^5 transfer) -(title:protocol^5 keywords:protocol^10 description:protocol^5 protocol)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Non-alphanumeric characters are used to create phrase
        query = parser.Parse("http/1.0");
        BLEX_TEST_CHECKEQUAL("\"http 1 0\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("1"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("0"));

        // Phrase searches
        query = parser.Parse("\"transfer protocol\"");
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Phrase searches, with boost factor
        query = parser.Parse("\"transfer protocol\"^4.4");
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"^4.4", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Phrase searches, with slop factor
        query = parser.Parse("\"transfer protocol\"~2");
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"~2", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Phrase searches, ignore non-alphanumeric characters
        query = parser.Parse("\"http/1.0\"");
        BLEX_TEST_CHECKEQUAL("\"http 1 0\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("1"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("0"));

        // 'Direct' phrase searches
        query = parser.Parse("hypertext-transfer-protocol");
        BLEX_TEST_CHECKEQUAL("\"hypertext transfer protocol\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("hypertext"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // 'Direct' phrase searches, with boost factor
        query = parser.Parse("transfer+protocol^4.4");
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"^4.4", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // 'Direct' phrase searches, with slop factor
        query = parser.Parse("transfer-protocol~2");
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"~2", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));
}

BLEX_TEST_FUNCTION(TestQueryParserFields)
{
        QueryParser parser;
        ParsedQuery query;

        // Just one word
        query = parser.Parse("title:transfer");
        BLEX_TEST_CHECKEQUAL("(title:transfer)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Just one word, with boost factor
        query = parser.Parse("title:transfer^7");
        BLEX_TEST_CHECKEQUAL("((title:transfer)^7)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Just one word, with boost factor
        query = parser.Parse("title:transfer^7.7");
        BLEX_TEST_CHECKEQUAL("((title:transfer)^7.7)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Multiple words
        query = parser.Parse("title:transfer body:protocol");
        BLEX_TEST_CHECKEQUAL("(title:transfer) (protocol)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Multiple words, with boost factor
        query = parser.Parse("title:transfer^3 body:protocol^8");
        BLEX_TEST_CHECKEQUAL("((title:transfer)^3) ((protocol)^8)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Multiple words, with boost factor
        query = parser.Parse("title:transfer^3.4 body:protocol^8.9");
        BLEX_TEST_CHECKEQUAL("((title:transfer)^3.4) ((protocol)^8.9)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Required/prohibited words
        query = parser.Parse("+title:transfer -body:protocol");
        BLEX_TEST_CHECKEQUAL("+(title:transfer) -(protocol)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Ignore non-alphanumeric characters
        query = parser.Parse("title:http/1.0");
        BLEX_TEST_CHECKEQUAL("title:\"http 1 0\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("1"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("0"));

        // Phrase searches
        query = parser.Parse("title:\"transfer protocol\"");
        BLEX_TEST_CHECKEQUAL("title:\"transfer protocol\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Phrase searches, with boost factor
        query = parser.Parse("title:\"transfer protocol\"^4.4");
        BLEX_TEST_CHECKEQUAL("title:\"transfer protocol\"^4.4", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Phrase searches, with slop factor
        query = parser.Parse("title:\"transfer protocol\"~2");
        BLEX_TEST_CHECKEQUAL("title:\"transfer protocol\"~2", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Phrase searches, ignore non-alphanumeric characters
        query = parser.Parse("title:\"http/1.0\"");
        BLEX_TEST_CHECKEQUAL("title:\"http 1 0\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("1"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("0"));

        // 'Direct' phrase searches
        query = parser.Parse("title:hypertext-transfer-protocol");
        BLEX_TEST_CHECKEQUAL("title:\"hypertext transfer protocol\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("hypertext"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // 'Direct' phrase searches, with boost factor
        query = parser.Parse("title:transfer+protocol^4.4");
        BLEX_TEST_CHECKEQUAL("title:\"transfer protocol\"^4.4", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // 'Direct' phrase searches, with slop factor
        query = parser.Parse("title:transfer-protocol~2");
        BLEX_TEST_CHECKEQUAL("title:\"transfer protocol\"~2", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));

        // Special field
        query = parser.Parse("groupid:aap:noot:mies");
        BLEX_TEST_CHECKEQUAL("aap:noot:mies", query.query->ToStringWithField("groupid"));

        query = parser.Parse("groupid:aap:noot:mies^6 veld:beeh");
        BLEX_TEST_CHECKEQUAL("aap:noot:mies^6 (veld:beeh)", query.query->ToStringWithField("groupid"));
        BLEX_TEST_CHECKEQUAL("groupid:aap:noot:mies^6 (beeh)", query.query->ToStringWithField("veld"));

        query = parser.Parse("+(groupid:aap:noot:mies^6) veld:beeh");
        BLEX_TEST_CHECKEQUAL("+(groupid:aap:noot:mies^6) (veld:beeh)", query.query->ToString());

        query = parser.Parse("+(+groupid:aap:noot:mies^6 +veld:beeh)");
        BLEX_TEST_CHECKEQUAL("+(+groupid:aap:noot:mies^6 +(veld:beeh))", query.query->ToString());

        // Module field
        query = parser.Parse("field@module:aap");
        BLEX_TEST_CHECKEQUAL("(field@module:aap)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("(aap)", query.query->ToStringWithField("field@module"));
        query = parser.Parse("field@module:\"aap noot mies\"");
        BLEX_TEST_CHECKEQUAL("field@module:\"aap noot mies\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("\"aap noot mies\"", query.query->ToStringWithField("field@module"));
        query = parser.Parse("field@module:aap+noot-mies");
        BLEX_TEST_CHECKEQUAL("field@module:\"aap noot mies\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(0, query.words.size()); // only 'body' and 'title' fields have those
        query = parser.Parse("field.member@module:aap");
        BLEX_TEST_CHECKEQUAL("(field.member@module:aap)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("(aap)", query.query->ToStringWithField("field.member@module"));
        query = parser.Parse("field@module");
        BLEX_TEST_CHECKEQUAL("(title:field^5 keywords:field^10 description:field^5 field)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("(title:field^5 keywords:field^10 description:field^5 body:field)", query.query->ToStringWithField("field.member@module"));
        query = parser.Parse("field.member@module");
        BLEX_TEST_CHECKEQUAL("(title:field^5 keywords:field^10 description:field^5 field)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("(title:field^5 keywords:field^10 description:field^5 body:field)", query.query->ToStringWithField("field.member@module"));

        // Exists query
        query = parser.Parse("title:*");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(title:[0,})", query.filters[0]->ToString());
        query = parser.Parse("*"); // field is required for exists queries
        BLEX_TEST_CHECKEQUAL(0, query.filters.size());
        query = parser.Parse("title:**");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(title:[0,})", query.filters[0]->ToString());
        query = parser.Parse("title:*test*"); // test* is interpreted as (start of) a phrase query
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(title:[0,})", query.filters[0]->ToString());
        BLEX_TEST_CHECKEQUAL("\"test\"", query.query->ToStringWithField("body"));
        query = parser.Parse("test title:* keywords:test");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(title:[0,})", query.filters[0]->ToString());
        BLEX_TEST_CHECKEQUAL("(title:test^5 keywords:test^10 description:test^5 test) (keywords:test)", query.query->ToStringWithField("body"));
}

BLEX_TEST_FUNCTION(TestStemmedQueryParser)
{
        QueryParser parser;
        ParsedQuery query;

        // Just one word, no language, so no stemming
        query = parser.Parse("transfers");
        BLEX_TEST_CHECKEQUAL("(title:transfers^5 keywords:transfers^10 description:transfers^5 transfers)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfers"));

        // Just one word
        query = parser.Parse("transfers", Blex::Lang::EN);
        BLEX_TEST_CHECKEQUAL("(title:transfers^5 keywords:transfers^10 description:transfers^5 transfers title:transfer^2.5 transfer^0.5)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfers"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Just one word, with boost factor
        query = parser.Parse("transferring^8", Blex::Lang::EN);
        BLEX_TEST_CHECKEQUAL("((title:transferring^5 keywords:transferring^10 description:transferring^5 transferring title:transfer^2.5 transfer^0.5)^8)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transferring"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Just one word, with boost factor
        query = parser.Parse("transferred^8.8", Blex::Lang::EN);
        BLEX_TEST_CHECKEQUAL("((title:transferred^5 keywords:transferred^10 description:transferred^5 transferred title:transfer^2.5 transfer^0.5)^8.8)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transferred"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));

        // Phrases should not be stemmed
        query = parser.Parse("\"transfers transferring transferred\"", Blex::Lang::EN);
        BLEX_TEST_CHECKEQUAL("\"transfers transferring transferred\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(false, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfers"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transferring"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transferred"));

        // 'Direct' phrases should not be stemmed
        query = parser.Parse("transfers-transferring+transferred", Blex::Lang::EN);
        BLEX_TEST_CHECKEQUAL("\"transfers transferring transferred\"", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(false, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfers"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transferring"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transferred"));

        // Specific fields are stemmed
        query = parser.Parse("titles:transferring", Blex::Lang::EN);
        BLEX_TEST_CHECKEQUAL("(titles:transferring titles:transfer^0.5)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());

        // Just one word, Dutch
        query = parser.Parse("protocollen", Blex::Lang::NL);
        BLEX_TEST_CHECKEQUAL("(title:protocollen^5 keywords:protocollen^10 description:protocollen^5 protocollen title:protocol^2.5 protocol^0.5)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(2, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocollen"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));
}

BLEX_TEST_FUNCTION(TestQueryParserFilters)
{
        QueryParser parser;
        ParsedQuery query;

        // One range filter, inclusive and exclusive limits
        query = parser.Parse("field:[start,finish]");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:[start,finish])", query.filters[0]->ToString());
        query = parser.Parse("field:{start,finish}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:{start,finish})", query.filters[0]->ToString());

        // Leaving out start or finish
        query = parser.Parse("field:[,finish]");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:[,finish])", query.filters[0]->ToString());
        query = parser.Parse("field:[start,]");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:[start,])", query.filters[0]->ToString());
        query = parser.Parse("field:{,finish}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:{,finish})", query.filters[0]->ToString());
        query = parser.Parse("field:{start,}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:{start,})", query.filters[0]->ToString());

        // Leaving out field name: no filter
        query = parser.Parse("[start,finish]");
        BLEX_TEST_CHECKEQUAL(0, query.filters.size());
        BLEX_TEST_CHECKEQUAL("\"start finish\"", query.query->ToStringWithField("body"));

        // Leaving out both start and finish: no filter
        query = parser.Parse("field:[,]");
        BLEX_TEST_CHECKEQUAL(0, query.filters.size());
        BLEX_TEST_CHECKEQUAL("", query.query->ToStringWithField("body"));

        // One range filter as subquery, ignore requirement
        query = parser.Parse("+(field:test -field:[start,finish])");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("(field:[start,finish])", query.filters[0]->ToString());
        BLEX_TEST_CHECKEQUAL("+((field:test))", query.query->ToStringWithField("body"));

        // The query:
        //   field:{start finish} field:[start field:{start} field[start,finish]
        // should be parsed as follows:
        // 'field:{' starts a range query, which is interrupted by the space after 'start' and ignored
        // 'finish}' starts a phrase query, which is ended by the space
        // 'field:[' starts a range query, which is interrupted by the space after 'start' and ignored
        // 'field:{' starts a range query, which is interrupted by the '}' after 'start' and ignored
        // 'field[start,finish' is treated as a phrase query
        // ']' is ingored
        query = parser.Parse("field:{start finish} field:[start field:{start} field[start,finish]");
        BLEX_TEST_CHECKEQUAL(0, query.filters.size());
        BLEX_TEST_CHECKEQUAL("\"finish\" \"field start finish\"", query.query->ToStringWithField("body"));

        // Range filter on untokenized fields
        query = parser.Parse("indexid:[start,finish]");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        query = parser.Parse("indexid:{start,finish}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        query = parser.Parse("date_field:[start,finish]");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        query = parser.Parse("date_field:{start,finish}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());

        query = parser.Parse("date_field:[@0123456789ABCDEF,@0123456789ABCDEF}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("(date_field:[@0123456789ABCDEF,@0123456789ABCDEF})", query.filters[0]->ToString());

        query = parser.Parse("arryfield.date_field@module:[@0123456789ABCDEF,@0123456789ABCDEF}");
        BLEX_TEST_CHECKEQUAL(1, query.filters.size());
        BLEX_TEST_CHECKEQUAL("", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("(arryfield.date_field@module:[@0123456789ABCDEF,@0123456789ABCDEF})", query.filters[0]->ToString());
}

BLEX_TEST_FUNCTION(TestQueryParserCombinations)
{
        QueryParser parser;
        ParsedQuery query;

        query = parser.Parse("-hypertext +\"transfer protocol\"~2 http^15");
        BLEX_TEST_CHECKEQUAL("-(title:hypertext^5 keywords:hypertext^10 description:hypertext^5 hypertext) +\"transfer protocol\"~2 ((title:http^5 keywords:http^10 description:http^5 http)^15)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(3, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));

        query = parser.Parse("hypertext^2.0 +\"transfer protocol\"~2^0.5 http");
        BLEX_TEST_CHECKEQUAL("((title:hypertext^5 keywords:hypertext^10 description:hypertext^5 hypertext)^2) +\"transfer protocol\"~2^0.5 (title:http^5 keywords:http^10 description:http^5 http)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(4, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("hypertext"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));

        // The query:
        //   - hypertext-transfer-^.4 +\"title:protocol\" ~3 http ^2 +rfc+ 2616^.5
        // should be parsed as follows:
        // The query '-' is ignored, nothing follows it
        // 'hypertext' and 'transfer' form a direct phrase query
        //   Because there is no word after the '-' after transfer, the query is ended
        // '^.' is ignored (no words)
        // '4' is a single term query
        // 'title' and 'protocol' form a phrase query
        //   'title' is no field here, because it included within the quotes
        //   The ':' is treated as whitespace
        //   The space after the closing quote ends the query
        // '~' is ignored (no word)
        // '3' is a single term query
        // 'http' is a single term query
        //   The space ends the query
        // '^' is ignored (no word)
        // '2' is a single term query
        // '+' makes the next query required
        // 'rfc' forms a direct phrase query, because of the following '+'
        //   The space after the '+' ends the query
        // '2616' is a single term query
        //   A boost factor of 0.5 is set for the query (the query '0' may be ommitted)
        query = parser.Parse("- hypertext-transfer-^.4 +\"title:protocol\" ~3 http ^2 +rfc+ 2616^.5");
        BLEX_TEST_CHECKEQUAL("\"hypertext transfer\" (title:4^5 keywords:4^10 description:4^5 4) +\"title protocol\" (title:3^5 keywords:3^10 description:3^5 3) (title:http^5 keywords:http^10 description:http^5 http) (title:2^5 keywords:2^10 description:2^5 2) +\"rfc\" ((title:2616^5 keywords:2616^10 description:2616^5 2616)^0.5)", query.query->ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL(10, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("hypertext"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("transfer"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("4"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("title"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("protocol"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("3"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("http"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("2"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("rfc"));
        BLEX_TEST_CHECKEQUAL(true, query.words.count("2616"));

        query = parser.Parse("+newstype:\"news\" +lang:\"nl\" +(publocations:112491 publocations:232462 publocations:47744 publocations:47808 publocations:356877 publocations:47151 publocations:47152 publocations:47164 publocations:46053 publocations:164213 publocations:164214 publocations:46275 publocations:46283 publocations:46295 publocations:46308 publocations:46367 publocations:46397 publocations:46403 publocations:46522 publocations:46607 publocations:356130 publocations:46839 publocations:46844 publocations:269848 publocations:46881 publocations:134990 publocations:138149 publocations:341583 publocations:341584 publocations:46885 publocations:46890 publocations:345964 publocations:31255 publocations:85154 publocations:347802 publocations:347814 publocations:46142 publocations:46150 publocations:47624 publocations:46159 publocations:46161 publocations:46168 publocations:46193 publocations:46016 publocations:46028 publocations:46038 publocations:46039 publocations:47249 publocations:47289 publocations:47345 publocations:47594 publocations:47618 publocations:45734 publocations:45793 publocations:45589 publocations:45592 publocations:44518 publocations:44541 publocations:45724 publocations:45727 publocations:101391 publocations:106825 publocations:129780 publocations:449105 publocations:435638 publocations:435665 publocations:46110 publocations:368995 publocations:372552 publocations:109411 publocations:109423 publocations:109429 publocations:109430 publocations:109527 publocations:109528 publocations:109538 publocations:109551 publocations:109553 publocations:111050 publocations:111467 publocations:113877 publocations:114481 publocations:114512 publocations:181651 publocations:181654 publocations:105074 publocations:105084 publocations:409735 publocations:409736 publocations:344468 publocations:344478 publocations:344479 publocations:344480 publocations:442277 publocations:442278 publocations:329229 publocations:329232 publocations:329233 publocations:329237 publocations:452817 publocations:452818 publocations:259165 publocations:497125 publocations:497126 publocations:475646 publocations:488739 publocations:136806 publocations:72083 publocations:238505 publocations:238506 publocations:231662 publocations:127340 publocations:496914 publocations:402215 publocations:402216 publocations:47758 publocations:47761 publocations:506444 publocations:506596 publocations:498311 publocations:76575 publocations:76576 publocations:436789 publocations:436792 publocations:496277 publocations:410538 publocations:410539 publocations:496278 publocations:496336 publocations:496466 publocations:105193 publocations:105197 publocations:498312 publocations:498059 publocations:182158 publocations:182651 publocations:367778 publocations:367797 publocations:2034 publocations:256443 publocations:256446 publocations:105059 publocations:10570 publocations:10571 publocations:66683 publocations:509659 publocations:509766 publocations:106776 publocations:30953 publocations:76550 publocations:76556 publocations:76558 publocations:127409 publocations:30929 publocations:30945 publocations:76663 publocations:188219 publocations:252712 publocations:110218 publocations:510927 publocations:107198 publocations:510931 publocations:38738 publocations:497744 publocations:497750 publocations:510928 publocations:68162 publocations:104161 publocations:223967 publocations:68157 publocations:104237 publocations:68254 publocations:498842 publocations:498850 publocations:105060 publocations:208915 publocations:331952 publocations:331976 publocations:45152 publocations:510719 publocations:510720 publocations:506099 publocations:251379 publocations:498207 publocations:345735 publocations:368140 publocations:380504 publocations:425719 publocations:425720 publocations:425731 publocations:425732 publocations:439078 publocations:439079 publocations:232462 publocations:47744 publocations:47808 publocations:356877 publocations:47151 publocations:47152 publocations:47164 publocations:46053 publocations:164213 publocations:164214 publocations:46275 publocations:46283 publocations:46295 publocations:46308 publocations:46367 publocations:46397 publocations:46403 publocations:46522 publocations:46607 publocations:356130 publocations:46839 publocations:46844 publocations:269848 publocations:46881 publocations:134990 publocations:138149 publocations:341583 publocations:341584 publocations:46885 publocations:46890 publocations:345964 publocations:31255 publocations:85154 publocations:347802 publocations:347814 publocations:46142 publocations:46150 publocations:47624 publocations:46159 publocations:46161 publocations:46168 publocations:46193 publocations:46016 publocations:46028 publocations:46038 publocations:46039 publocations:47249 publocations:47289 publocations:47345 publocations:47594 publocations:47618 publocations:45734 publocations:45793 publocations:45589 publocations:45592 publocations:44518 publocations:44541 publocations:45724 publocations:45727 publocations:101391 publocations:106825 publocations:129780 publocations:449105 publocations:435638 publocations:435665 publocations:46110 publocations:368995 publocations:372552 publocations:109411 publocations:109423 publocations:109429 publocations:109430 publocations:109527 publocations:109528 publocations:109538 publocations:109551 publocations:109553 publocations:111050 publocations:111467 publocations:113877 publocations:114481 publocations:114512 publocations:181651 publocations:181654 publocations:105074 publocations:105084 publocations:409735 publocations:409736 publocations:344468 publocations:344478 publocations:344479 publocations:344480 publocations:442277 publocations:442278 publocations:329229 publocations:329232 publocations:329233 publocations:329237 publocations:452817 publocations:452818 publocations:259165 publocations:497125 publocations:497126 publocations:475646 publocations:488739 publocations:136806 publocations:72083 publocations:238505 publocations:238506 publocations:231662 publocations:127340 publocations:496914 publocations:402215 publocations:402216 publocations:47758 publocations:47761 publocations:506444 publocations:506596 publocations:498311 publocations:76575 publocations:76576 publocations:436789 publocations:436792 publocations:496277 publocations:410538 publocations:410539 publocations:496278 publocations:496336 publocations:496466 publocations:105193 publocations:105197 publocations:498312 publocations:498059 publocations:182158 publocations:182651 publocations:367778 publocations:367797 publocations:2034 publocations:256443 publocations:256446 publocations:105059 publocations:10570 publocations:10571 publocations:66683 publocations:509659 publocations:509766 publocations:106776 publocations:30953 publocations:76550 publocations:76556 publocations:76558 publocations:127409 publocations:30929 publocations:30945 publocations:76663 publocations:188219 publocations:252712 publocations:110218 publocations:510927 publocations:107198 publocations:510931 publocations:38738 publocations:497744 publocations:497750 publocations:510928 publocations:68162 publocations:104161 publocations:223967 publocations:68157 publocations:104237 publocations:68254 publocations:498842 publocations:498850 publocations:105060 publocations:208915 publocations:331952 publocations:331976 publocations:45152 publocations:510719 publocations:510720 publocations:506099 publocations:251379 publocations:498207 publocations:345735 publocations:368140 publocations:380504 publocations:425719 publocations:425720 publocations:425731 publocations:425732 publocations:439078 publocations:439079)");

        // Should not crash (stack overflow)
        query = parser.Parse("(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a(a");

        // Should return the text "ab"
        query = parser.Parse(")ab");
        BLEX_TEST_CHECKEQUAL(1, query.words.size());
        BLEX_TEST_CHECKEQUAL(true, query.words.count("ab"));
}

}
BLEX_TEST_FUNCTION(TestNestedQueries)
{
        QueryParser parser;
        ParsedQuery query;

        // Normal nested query
        query = parser.Parse("+(\"transfer\" +\"test\")^2 \"wow\" ");
        BLEX_TEST_CHECKEQUAL("+((\"transfer\" +\"test\")^2) \"wow\"", query.query->ToStringWithField("body"));

        // Nested query, but not terminated
        query = parser.Parse("\"wow\" +(\"transfer\" +\"test");
        BLEX_TEST_CHECKEQUAL("\"wow\" +(\"transfer\" +\"test\")", query.query->ToStringWithField("body"));
}

