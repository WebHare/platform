#include <ap/libwebhare/allincludes.h>


#include <blex/testing.h>

#include "../consilio.h"
#include "../langspecific.h"
#include "../booleanquery.h"
#include "../filter.h"
#include "../hits.h"
#include "../phrasequery.h"
#include "../query.h"
#include "../queryparser.h"
#include "../searcher.h"
#include "../termquery.h"
#include "../wildcardquery.h"
#include "../cache.h"

using namespace Lucene;

extern std::string test_data;

namespace TestSearcher
{

Blex::Mutex commit_lock;
std::unique_ptr<Blex::ComplexFileSystem> directory;
std::unique_ptr<IndexSearcher> searcher;
SegmentsCache cache;

BLEX_TEST_FUNCTION(TestSearcher)
{
        try
        {
                directory.reset(new Blex::ComplexFileSystem( test_data + "searchindex"
                                                          , false
                                                          , Blex::ComplexFileSystem::BufferAll));/*
                                                          , false
                                                          , IndexFs_BlockSize
                                                          , IndexFs_BlocksPerFile
                                                          , IndexFs_CacheSize
                                                          , IndexFs_EntriesPerFatPage
                                                          , false
                                                          ));*/
        }
        catch(std::runtime_error &e)
        {
                BLEX_TEST_FAIL("Opening ComplexFileSystem " + test_data + "searchindex failed");
        }
        try
        {
                searcher.reset(new IndexSearcher(commit_lock, *directory, cache));
        }
        catch(LuceneException &e)
        {
                BLEX_TEST_FAIL("Opening IndexSearcher " + test_data + "searchindex failed");
        }

        // Can't search for empty query
        std::shared_ptr<Query> query;
        std::unique_ptr<Hits> hits;
        BLEX_TEST_CHECKTHROW(hits.reset(searcher->Search(query)), LuceneException);
}

BLEX_TEST_FUNCTION(TestSearchTerm)
{
        std::shared_ptr<Query> query;
        std::unique_ptr<Hits> hits;

        query.reset(new TermQuery(Term("body","47")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new TermQuery(Term("body","actions")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 1 is deleted

        query.reset(new TermQuery(Term("body","body")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new TermQuery(Term("body","a")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new TermQuery(Term("body","to")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        query.reset(new TermQuery(Term("","")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("Body","to")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("body","To")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("body","input")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("text","to")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("zzzzz","zzzzz")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs
}

BLEX_TEST_FUNCTION(TestSearchPhrase)
{
        std::shared_ptr<PhraseQuery> query;
        std::unique_ptr<Hits> hits;

        query.reset(new PhraseQuery());
        query->Add(Term("body", "stateless"));
        query->Add(Term("body", "protocol"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new PhraseQuery());
        query->Add(Term("body", "the"));
        query->Add(Term("body", "internet"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 1 is deleted

        query.reset(new PhraseQuery());
        query->Add(Term("body", "validity"));
        query->Add(Term("body", "accessibility"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new PhraseQuery());
        query->Add(Term("title", "http"));
        query->Add(Term("title", "1"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new PhraseQuery());
        query->Add(Term("title", "safe"));
        query->Add(Term("title", "methods"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 1 is deleted

        query.reset(new PhraseQuery());
        query->Add(Term("title", "4"));
        query->Add(Term("title", "head"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new PhraseQuery());
        query->Add(Term("body", "get"));
        query->Add(Term("body", "retrieve"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 2 contains "get method means retrieve"

        query.reset(new PhraseQuery());
        query->Add(Term("body", "get"));
        query->Add(Term("body", "retrieve"));
        query->SetSlop(1);
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 2 contains "get method means retrieve"

        query.reset(new PhraseQuery());
        query->Add(Term("body", "get"));
        query->Add(Term("body", "retrieve"));
        query->SetSlop(2);
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new PhraseQuery());
        query->Add(Term("body", "the"));
        query->Add(Term("body", "as"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new PhraseQuery());
        query->Add(Term("body", "the"));
        query->Add(Term("body", "as"));
        query->SetSlop(20);
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new PhraseQuery());
        query->Add(Term("body", "the"));
        query->Add(Term("body", "as"));
        query->SetSlop(40);
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new PhraseQuery());
        query->Add(Term("body", "http"));
        query->Add(Term("body", "for"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 2 contains "for http"

        query.reset(new PhraseQuery());
        query->Add(Term("body", "http"));
        query->Add(Term("body", "for"));
        query->SetSlop(2);
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new PhraseQuery());
        query->Add(Term("body", "allowing"));
        query->Add(Term("body", "partially"));
        query->Add(Term("body", "retrieved"));
        query->Add(Term("body", "entities"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new PhraseQuery());
        query->Add(Term("body", "response"));
        query->Add(Term("body", "get"));
        query->Add(Term("body", "cacheable"));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 2 contains "response to a get request is cacheable"

        query.reset(new PhraseQuery());
        query->Add(Term("body", "response"));
        query->Add(Term("body", "get"));
        query->Add(Term("body", "cacheable"));
        query->SetSlop(4);
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2
}

BLEX_TEST_FUNCTION(TestSearchBoolean)
{
        std::shared_ptr<BooleanQuery> query;
        std::unique_ptr<Hits> hits;

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), false, false); // doc 0
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "actions"))), false, false); // doc 1
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "body"))), false, false); // doc 2
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), true, false); // doc 0
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "actions"))), true, false); // doc 1
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "body"))), true, false); // doc 2
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), false, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), true, false); // doc 0
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), false, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "actions"))), true, false); // doc 1
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // doc 1 is deleted

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), false, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "body"))), true, false); // doc 2
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), true, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), true, false); // doc 0
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), false, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), false, true); // doc 0
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2 (doc 1 is deleted)

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), false, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "actions"))), false, true); // doc 1
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), false, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "body"))), false, true); // doc 2
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0 (doc 1 is deleted)

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "to"))), true, false); // doc 0, 1, 2
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), false, true); // doc 0
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2 (doc 1 is deleted

        query.reset(new BooleanQuery());
        query->Add(std::shared_ptr<Query>(new TermQuery(Term("body", "47"))), false, true); // doc 0
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs (just prohibited clauses not allowed)
}

BLEX_TEST_FUNCTION(TestSearchWildcard)
{
        std::shared_ptr<WildcardQuery> query;
        std::unique_ptr<Hits> hits;

        // Query must contain at least one wildcard character
        query.reset(new WildcardQuery(Term("body","hypertext")));
        BLEX_TEST_CHECKTHROW(hits.reset(searcher->Search(query)), LuceneException);

        query.reset(new WildcardQuery(Term("body","hyper*")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","hy*xt")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","hy*ia")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new WildcardQuery(Term("body","hyperl*")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new WildcardQuery(Term("body","hypertext*")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","hyper*text")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","*text")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // cannot start with wildcard char

        query.reset(new WildcardQuery(Term("body","hypertex?")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","hyperte?t")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","hypertext?")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","hyper?text")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new WildcardQuery(Term("body","?ypertext")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // cannot start with wildcard char

        query.reset(new WildcardQuery(Term("body","h*t??t")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","h?perm*")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        query.reset(new WildcardQuery(Term("body","h*rt*t?")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","h???????t")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","h??????t")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new WildcardQuery(Term("body","h*?*?*?*?*?*?*?*t")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        query.reset(new WildcardQuery(Term("body","h?*?*?*?*?*?*?*?t")));
        hits.reset(searcher->Search(query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs
}

BLEX_TEST_FUNCTION(TestSearchFilter)
{
        std::shared_ptr<TermQuery> query;
        std::shared_ptr<Filter> filter;
        std::unique_ptr<Hits> hits;

        query.reset(new TermQuery(Term("body", "to")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        filter.reset(new InitialValueFilter(Term("url", "http://test/")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        filter.reset(new InitialValueFilter(Term("url", "http://test/dir1/")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        filter.reset(new InitialValueFilter(Term("url", "http://test/dir2/")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2 (doc 1 is deleted)

        filter.reset(new InitialValueFilter(Term("url", "https://test/")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("body", "47")));
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir2/")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("body", "body")));
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir1/")));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        // Id's in the index:
        // doc 2: 8af86dfb074464ed8bef944188442ca3
        // doc 1: aee602a79c233139b4f269a535a8b965
        // doc 0: b82d9882abdf0112ce3cec7089851b9b
        query.reset(new TermQuery(Term("body", "to")));
        filter.reset(new RangeFilter("id", "", "", false, false));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (no filter)

        // {b82d9882abdf0112ce3cec7089851b9b,}
        filter.reset(new RangeFilter("id", "b82d9882abdf0112ce3cec7089851b9b", "", false, false));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        // [b82d9882abdf0112ce3cec7089851b9b,}
        filter.reset(new RangeFilter("id", "b82d9882abdf0112ce3cec7089851b9b", "", true, false));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        // {,b82d9882abdf0112ce3cec7089851b9b}
        filter.reset(new RangeFilter("id", "", "b82d9882abdf0112ce3cec7089851b9b", false, false));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2 (doc 1 is deleted)

        // {,b82d9882abdf0112ce3cec7089851b9b]
        filter.reset(new RangeFilter("id", "", "b82d9882abdf0112ce3cec7089851b9b", false, true));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        // {a,b82d9882abdf0112ce3cec7089851b9b}
        filter.reset(new RangeFilter("id", "a", "b82d9882abdf0112ce3cec7089851b9b", false, false));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs (doc 1 is deleted)

        // {a,b82d9882abdf0112ce3cec7089851b9b]
        filter.reset(new RangeFilter("id", "a", "b82d9882abdf0112ce3cec7089851b9b", false, true));
        hits.reset(searcher->Search(query, filter));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0 (doc 1 is deleted)
}

BLEX_TEST_FUNCTION(TestSearchMultiFilter)
{
        std::shared_ptr<TermQuery> query;
        std::shared_ptr<MultiFilter> multifilter;
        std::shared_ptr<Filter> filter;
        std::unique_ptr<Hits> hits;

        query.reset(new TermQuery(Term("body", "to")));
        multifilter.reset(new MultiFilter(false, false)); // any
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir1/"))); // doc 0
        multifilter->Add(filter);
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir2/"))); // doc 1, 2
        multifilter->Add(filter);
        hits.reset(searcher->Search(query, multifilter));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        query.reset(new TermQuery(Term("body", "to")));
        multifilter.reset(new MultiFilter(true, false)); // all
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir1/"))); // doc 0
        multifilter->Add(filter);
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir2/"))); // doc 1, 2
        multifilter->Add(filter);
        hits.reset(searcher->Search(query, multifilter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("body", "to")));
        multifilter.reset(new MultiFilter(false, true)); // none
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir1/"))); // doc 0
        multifilter->Add(filter);
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir2/"))); // doc 1, 2
        multifilter->Add(filter);
        hits.reset(searcher->Search(query, multifilter));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        query.reset(new TermQuery(Term("body", "to")));
        multifilter.reset(new MultiFilter(false, true)); // none
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir3/"))); // no docs
        multifilter->Add(filter);
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir4/"))); // no docs
        multifilter->Add(filter);
        hits.reset(searcher->Search(query, multifilter));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2 (doc 1 is deleted)

        query.reset(new TermQuery(Term("body", "to")));
        multifilter.reset(new MultiFilter(false, true)); // none
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir1/"))); // doc 0
        multifilter->Add(filter);
        filter.reset(new InitialValueFilter(Term("url", "http://test/dir3/"))); // doc 1, 2
        multifilter->Add(filter);
        hits.reset(searcher->Search(query, multifilter));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 2 (doc 1 is deleted)
}

BLEX_TEST_FUNCTION(TestSearchingQueries)
{
        QueryParser parser;
        ParsedQuery query;
        std::unique_ptr<Hits> hits;

        // Just one word, no language, so no stemming
        query = parser.Parse("transfers");
        hits.reset(searcher->Search(query.query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        // Just one word, stemmed
        query = parser.Parse("transfers", Blex::Lang::EN);
        hits.reset(searcher->Search(query.query));
        BLEX_TEST_CHECKEQUAL(2, hits->size()); // doc 0, 2

        // Multiple words, no language, so no stemming
        query = parser.Parse("+transferred +protocols");
        hits.reset(searcher->Search(query.query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs

        // Multiple words, stemmed
        query = parser.Parse("+transferred +protocols", Blex::Lang::EN);
        hits.reset(searcher->Search(query.query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        // Phrase, no language, so no stemming
        query = parser.Parse("\"transfer protocol\"");
        hits.reset(searcher->Search(query.query));
        BLEX_TEST_CHECKEQUAL(1, hits->size()); // doc 0

        // Phrase, so no stemming
        query = parser.Parse("\"transferred protocols\"", Blex::Lang::EN);
        hits.reset(searcher->Search(query.query));
        BLEX_TEST_CHECKEQUAL(0, hits->size()); // no docs
}

BLEX_TEST_FUNCTION(TestSearcherCleanup)
{
        cache.Clear();
        searcher.reset();
        directory.reset();
}
}

