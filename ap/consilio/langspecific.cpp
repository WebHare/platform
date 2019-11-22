#include <ap/libwebhare/allincludes.h>


#include <blex/xml.h>

#include "langspecific.h"
#include "ctokenstream.h"

namespace Lucene
{

// Read the xml:lang attribute for the given node and returns the language code
Blex::Lang::Language GetXmlNodeLanguage(const Blex::XML::Node node)
{
        Blex::XML::Namespace xml_ns("xml", "http://www.w3.org/XML/1998/namespace");
        std::string langcode = node.GetAttr(&xml_ns, "lang");
        Blex::ToUppercase(langcode);
        return Blex::Lang::GetLanguage(langcode);
}

typedef Blex::InterlockedData<LangStopWordList, Blex::ConditionMutex> LockedLangStopWordList;

/// Stop word lists
LockedLangStopWordList lockedstopwordlist;

bool ReadStopWordXml(Blex::RandomStream &xmlstream)
{
        // Read the document
        Blex::XML::Document xmldoc;
        if (!xmldoc.ReadFromStream(xmlstream))
            return false;

        // Read the root node
        Blex::XML::Namespace consilio_ns = Blex::XML::Namespace("cs", "http://www.webhare.net/xmlns/consilio/stopwords");
        Blex::XML::PathExpr xpath(xmldoc);
        xpath.RegisterNamespace(consilio_ns);
        const std::unique_ptr<Blex::XML::PathResult> nodes(xpath.Evaluate("/cs:stopwords"));
        if (nodes->Size() != 1)
            return false;
        Blex::XML::Node rootnode((*nodes)[0]);

        // Read language
        Blex::Lang::Language lang = GetXmlNodeLanguage(rootnode);
        if (lang == Blex::Lang::None)
            return false;
        DEBUGPRINT("Using language " << lang);

        // Read <word> children
        Blex::XML::NodeIterator wordnode = rootnode.GetChildNodeIterator(&consilio_ns);
        LangStopWordList &stoplistref = *LockedLangStopWordList::WriteRef(lockedstopwordlist);
        StopWordList &list = stoplistref[lang];
        list.clear();
        for (; wordnode; ++wordnode)
            if (wordnode->LocalNameIs("word"))
                list.insert(Blex::NormalizeString(wordnode->GetContent(), lang));

        // Print the stop word list
/*
        DEBUGONLY(
                std::string wordlist;
                for (StopWordList::iterator it = list.begin(); it != list.end(); ++it)
                    wordlist += (it != list.begin() ? ", " : "") + *it;
                DEBUGPRINT("Read words: " << wordlist);
        );
//*/

        return true;
}

StopWordFilter::StopWordFilter()
: stoplistref(*LockedLangStopWordList::ReadRef(lockedstopwordlist))
{
        lang_list = NULL;
}

StopWordFilter::~StopWordFilter()
{
}

bool StopWordFilter::IsStopWord(std::string const &input)
{
        // If we have a list, see if the word is on it
        if (lang_list != NULL)
            return lang_list->count(input) > 0;

        // This word is not a stop word, or we don't know
        return false;
}

void StopWordFilter::SetLanguage(Blex::Lang::Language lang)
{
        lang_list = NULL;

        // See if we read a stop word list for the new language
        LangStopWordList::const_iterator list = stoplistref.find(lang);
        if (list != stoplistref.end())
            lang_list = &list->second;
}

} // namespace Lucene
