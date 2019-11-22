#include <blex/blexlib.h>

#include "unicode.h"

// Snowball include files
#include "stem_UTF_8_danish.h"
#include "stem_UTF_8_english.h"
#include "stem_UTF_8_french.h"
#include "stem_UTF_8_german.h"
#include "stem_UTF_8_italian.h"
#include "stem_UTF_8_kraaijpohlmann.h" // dutch
#include "stem_UTF_8_portuguese.h"
#include "stem_UTF_8_spanish.h"

namespace Blex
{

Stemmer::Stemmer()
{
        language_env = NULL;
        language_stem_function = NULL;
}

Stemmer::~Stemmer()
{
        if (language_env != NULL)
            language_close_function(language_env);
}

std::string Stemmer::Stem(std::string const &input) const
{
        // Check if a language was set
        if (language_env == NULL || language_stem_function == NULL)
            return "";

        // Set word to stem in language-specific environment
        SN_set_current(language_env, input.size(), (symbol *)input.c_str());
        // Stem the word
        language_stem_function(language_env);
        // Return the stemmed word (p is a pointer to the stemmed string, l is
        // the length of the stemmed string)
        return std::string((char *)language_env->p, language_env->l);
}

void Stemmer::SetLanguage(Blex::Lang::Language lang)
{
        if (language_env != NULL)
        {
                language_close_function(language_env);
                language_env = NULL;
                language_stem_function = NULL;
                language_close_function = NULL;
        }

        // Setup language-specific environment and set pointer to stemming
        // function, reset all for unknown languages
        switch (lang)
        {
                case Blex::Lang::DA:
                {
                        language_env = danish_UTF_8_create_env();
                        language_stem_function = danish_UTF_8_stem;
                        language_close_function = danish_UTF_8_close_env;
                } break;
                case Blex::Lang::DE:
                {
                        language_env = german_UTF_8_create_env();
                        language_stem_function = german_UTF_8_stem;
                        language_close_function = german_UTF_8_close_env;
                } break;
                case Blex::Lang::EN:
                {
                        language_env = english_UTF_8_create_env();
                        language_stem_function = english_UTF_8_stem;
                        language_close_function = english_UTF_8_close_env;
                } break;
                case Blex::Lang::ES:
                {
                        language_env = spanish_UTF_8_create_env();
                        language_stem_function = spanish_UTF_8_stem;
                        language_close_function = spanish_UTF_8_close_env;
                } break;
                case Blex::Lang::FR:
                {
                        language_env = french_UTF_8_create_env();
                        language_stem_function = french_UTF_8_stem;
                        language_close_function = french_UTF_8_close_env;
                } break;
                case Blex::Lang::IT:
                {
                        language_env = italian_UTF_8_create_env();
                        language_stem_function = italian_UTF_8_stem;
                        language_close_function = italian_UTF_8_close_env;
                } break;
                case Blex::Lang::NL:
                {
                        language_env = kraaij_pohlmann_UTF_8_create_env();
                        language_stem_function = kraaij_pohlmann_UTF_8_stem;
                        language_close_function = kraaij_pohlmann_UTF_8_close_env;
                } break;
                case Blex::Lang::PT:
                {
                        language_env = portuguese_UTF_8_create_env();
                        language_stem_function = portuguese_UTF_8_stem;
                        language_close_function = portuguese_UTF_8_close_env;
                } break;
                default: ;
        }
}

} //end namespace Blex
