#ifndef blex_consilio_analysis_langspecific
#define blex_consilio_analysis_langspecific

#include <set>
#include <map>
#include <blex/unicode.h>

namespace Lucene
{

/// A list of stop words
typedef std::set<std::string> StopWordList;
/// Lists of stop words for different languages
typedef std::map<Blex::Lang::Language, StopWordList> LangStopWordList;

bool ReadStopWordXml(Blex::RandomStream &xmlstream);

/** A simple stop word filter.
    This filter reads stop word (common word) files for different languages. After
    setting a language, the IsStopWord() function determines if a given word is
    a stop word for that language. */
class StopWordFilter
{
    public:
        StopWordFilter();
        ~StopWordFilter();

        /** Is the given word a stop word in a given language?
            @param input The word to check
            @return If the word appears on the stop word list for the language
                    specified in SetLanguage() */
        bool IsStopWord(std::string const &input);

        /** Set the language for which the stop word list is checked.
            @param lang The Language to use */
        void SetLanguage(Blex::Lang::Language lang);

    private:
        /// Reference to the stop word lists (with read lock)
        LangStopWordList const &stoplistref;

        /// Pointer to the list of words for the current language (or @c NULL if
        /// no language was specified or no list is available for the specified
        /// language)
        StopWordList const *lang_list;
};

} // namespace Lucene

#endif

