#include <ap/libwebhare/allincludes.h>


#include <blex/testing.h>

#include "../term.h"
#include "../booleanquery.h"
#include "../phrasequery.h"
#include "../termquery.h"
#include "../wildcardquery.h"

using namespace Lucene;

namespace TestQueries
{

BLEX_TEST_FUNCTION(TestTermQuery)
{
        Term term("body","transfer");
        TermQuery query = TermQuery(term);

        // Basic term and query comparison
        BLEX_TEST_CHECK(query.GetTerm() == term);
        BLEX_TEST_CHECK(query.GetTerm() == Term("body","transfer"));
        BLEX_TEST_CHECK(query == TermQuery(term));
        BLEX_TEST_CHECK(query == TermQuery(Term("body","transfer")));
        BLEX_TEST_CHECK(query != TermQuery(Term("title","transfer")));
        BLEX_TEST_CHECK(query != TermQuery(Term("body","protocol")));

        // Query string output
        BLEX_TEST_CHECKEQUAL("transfer", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:transfer", query.ToStringWithField("title"));

        // Boost factor
        query.SetBoost(2.5);
        BLEX_TEST_CHECKEQUAL(2.5, query.GetBoost());
        BLEX_TEST_CHECKEQUAL("transfer^2.5", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:transfer^2.5", query.ToStringWithField("title"));

        // Query comparison with boost factor set
        BLEX_TEST_CHECK(query != TermQuery(term));
        BLEX_TEST_CHECK(query != TermQuery(Term("body","transfer")));
}

BLEX_TEST_FUNCTION(TestBooleanQuery)
{
        // Boolean clauses
        std::shared_ptr<TermQuery> termquery(new TermQuery(Term("body","transfer")));
        std::shared_ptr<TermQuery> clausequery(new TermQuery(Term("title","hypertext")));
        BooleanClause termclause = BooleanClause(clausequery, true, false);
        BooleanClause otherclause = termclause;

        BLEX_TEST_CHECK(termclause == otherclause);
        otherclause.required = false;
        BLEX_TEST_CHECK(!(termclause == otherclause));
        otherclause.required = true;
        otherclause.prohibited = true;
        BLEX_TEST_CHECK(!(termclause == otherclause));
        otherclause.prohibited = false;
        otherclause.query = std::shared_ptr<TermQuery>(new TermQuery(Term("otherfield","othervalue")));
        BLEX_TEST_CHECK(!(termclause == otherclause));

        BooleanQuery query;

        // No clauses yet
        BLEX_TEST_CHECKEQUAL(0, query.GetClauses().size());
        BLEX_TEST_CHECKEQUAL("", query.ToStringWithField("body"));

        // Check max number of clauses constraint
        query.SetMaxClauseCount(0);
        BLEX_TEST_CHECKEQUAL(0, query.GetMaxClauseCount());
        BLEX_TEST_CHECKTHROW(query.Add(termquery,false,true), LuceneException);
        BLEX_TEST_CHECKTHROW(query.Add(termclause), LuceneException);
        BLEX_TEST_CHECKEQUAL(0, query.GetClauses().size());

        query.SetMaxClauseCount(1024);
        BLEX_TEST_CHECKEQUAL(1024, query.GetMaxClauseCount());

        // Adding clauses
        try {
                query.Add(termquery,false,true);
        } catch(LuceneException &e) {
                BLEX_TEST_FAIL("Adding TermQuery 0 failed");
        }
        BLEX_TEST_CHECKEQUAL(1, query.GetClauses().size());
        BLEX_TEST_CHECK(query.GetClauses()[0].query == termquery);
        BLEX_TEST_CHECKEQUAL("-transfer", query.ToStringWithField("body"));

        try {
                query.Add(termclause);
        } catch(LuceneException &e) {
                BLEX_TEST_FAIL("Adding BooleanClause 1 failed");
        }
        BLEX_TEST_CHECKEQUAL(2, query.GetClauses().size());
        BLEX_TEST_CHECK(query.GetClauses()[1] == termclause);
        BLEX_TEST_CHECKEQUAL("-transfer +title:hypertext", query.ToStringWithField("body"));

        // Boost factor
        termquery->SetBoost(2.5);
        BLEX_TEST_CHECKEQUAL("-transfer^2.5 +title:hypertext", query.ToStringWithField("body"));
        clausequery->SetBoost(3.5);
        BLEX_TEST_CHECKEQUAL("-transfer^2.5 +title:hypertext^3.5", query.ToStringWithField("body"));
        query.SetBoost(1.5);
        BLEX_TEST_CHECKEQUAL("(-transfer^2.5 +title:hypertext^3.5)^1.5", query.ToStringWithField("body"));

        // Clone query
        std::shared_ptr<Query> clonequery;
        try {
                clonequery = query.Clone();
        } catch(LuceneException &e) {
                BLEX_TEST_FAIL("Cloning BooleanQuery failed");
        }
        BLEX_TEST_CHECK(query == *clonequery.get());
        clonequery->SetBoost(.5);
        BLEX_TEST_CHECK(!(query == *clonequery.get()));
        BLEX_TEST_CHECKEQUAL("(-transfer^2.5 +title:hypertext^3.5)^0.5", clonequery->ToStringWithField("body"));
}

BLEX_TEST_FUNCTION(TestWildcardQuery)
{
        Term term("body","h?per*");
        WildcardQuery query = WildcardQuery(term);

        // Basic term and query comparison
        BLEX_TEST_CHECK(query.GetTerm() == term);
        BLEX_TEST_CHECK(query.GetTerm() == Term("body","h?per*"));
        BLEX_TEST_CHECK(query == WildcardQuery(term));
        BLEX_TEST_CHECK(query == WildcardQuery(Term("body","h?per*")));
        BLEX_TEST_CHECK(query != WildcardQuery(Term("title","h?per*")));
        BLEX_TEST_CHECK(query != WildcardQuery(Term("body","h*t?xt")));

        // Query string output
        BLEX_TEST_CHECKEQUAL("h?per*", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:h?per*", query.ToStringWithField("title"));

        // Boost factor
        query.SetBoost(2.5);
        BLEX_TEST_CHECKEQUAL(2.5, query.GetBoost());
        BLEX_TEST_CHECKEQUAL("h?per*^2.5", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:h?per*^2.5", query.ToStringWithField("title"));

        // Query comparison with boost factor set
        BLEX_TEST_CHECK(query != WildcardQuery(term));
        BLEX_TEST_CHECK(query != WildcardQuery(Term("body","h?per*")));
}

BLEX_TEST_FUNCTION(TestPhraseQuery)
{
        Term term = Term("body","transfer");
        PhraseQuery query = PhraseQuery();
        BLEX_TEST_CHECKEQUAL(0, query.GetTerms().size());
        BLEX_TEST_CHECKEQUAL(0, query.GetSlop());

        // Add some terms
        query.Add(term);
        BLEX_TEST_CHECKEQUAL(1, query.GetTerms().size());
        BLEX_TEST_CHECK(query.GetTerms()[0] == term);
        BLEX_TEST_CHECKEQUAL("\"transfer\"", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:\"transfer\"", query.ToStringWithField("title"));

        query.Add(Term("body","protocol"));
        BLEX_TEST_CHECKEQUAL(2, query.GetTerms().size());
        BLEX_TEST_CHECK(query.GetTerms()[1] == Term("body","protocol"));
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:\"transfer protocol\"", query.ToStringWithField("title"));

        // Terms should be of the same field
        BLEX_TEST_CHECKTHROW(query.Add(Term("title","hypertext")), LuceneException);
        BLEX_TEST_CHECKEQUAL(2, query.GetTerms().size());

        // Boost and slop factors
        query.SetBoost(2.5);
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"^2.5", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:\"transfer protocol\"^2.5", query.ToStringWithField("title"));

        query.SetSlop(7);
        BLEX_TEST_CHECKEQUAL(7, query.GetSlop());
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"~7^2.5", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:\"transfer protocol\"~7^2.5", query.ToStringWithField("title"));

        query.SetBoost(1.0);
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"~7", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:\"transfer protocol\"~7", query.ToStringWithField("title"));

        query.SetSlop(0);
        BLEX_TEST_CHECKEQUAL("\"transfer protocol\"", query.ToStringWithField("body"));
        BLEX_TEST_CHECKEQUAL("body:\"transfer protocol\"", query.ToStringWithField("title"));
}

}

