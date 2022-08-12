//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------
#include <harescript/vm/hsvm_dllinterface.h>
#include "xml_provider.h"
#include "xml_cssengine.h"
#include <blex/podvector.h>


namespace HareScript
{
namespace Xml
{
namespace CSS
{

using namespace std::literals::string_view_literals;

namespace
{

bool IsCSSWhitespace(char c)
{
        return c == 9 || c == 0x0a || c == 0x0d || c == 0x0d || c == ' ';
}

// Search for a case-sensitive whole word in a whitespace-separated list
bool TestIncludes(std::string_view search, std::string_view searchfor)
{
        if (searchfor.empty())
             return false;

        std::string_view::iterator itr = search.begin();
        while (true)
        {
                while (itr != search.end() && IsCSSWhitespace(*itr))
                    ++itr;

                if (itr == search.end())
                    return false;

                std::string_view::iterator wordend = itr + 1;
                while (wordend != search.end() && !IsCSSWhitespace(*wordend))
                    ++wordend;

                if (Blex::StrCaseCompare(itr, wordend, searchfor.begin(), searchfor.end()) == 0)
                    return true;

                itr = wordend;
        }
}

bool TestContains(std::string_view search, std::string_view searchfor)
{
        return std::search(search.begin(), search.end(), searchfor.begin(), searchfor.end(), Blex::CharCaseEqual< char >) != search.end();
}

std::vector< std::string > GetAttributes(xmlNodePtr node, std::string_view namespaceuri, std::string_view name, bool ishtml)
{
        std::vector< std::string > attrs;

        // Walk through namespace declarations too
        if (namespaceuri == XML_XMLNS_NAMESPACE || namespaceuri == "*")
        {
                for (xmlNs* nsattr = node->nsDef; nsattr; nsattr = nsattr->next)
                {
                        std::string_view attrname = nsattr->prefix ? std::string_view(reinterpret_cast< char const * >(nsattr->prefix)) : "xmlns"sv;

                        if (ishtml ? Blex::StrCaseCompare(attrname, name) == 0 : Blex::StrCompare(attrname, name) == 0)
                            attrs.push_back(reinterpret_cast< char const * >(nsattr->href));
                }
        }

        for (xmlAttrPtr attr = node->properties; attr; attr = attr->next)
        {
                std::string_view ns = attr->ns ? std::string_view(reinterpret_cast< char const * >(attr->ns->href)) : ""sv;
                if (namespaceuri != "*"sv && ns != namespaceuri)
                    continue;

                std::string_view attr_name = reinterpret_cast< char const * >(attr->name);
                if (ishtml ? Blex::StrCaseCompare(attr_name, name) == 0 : Blex::StrCompare(attr_name, name) == 0)
                {
                        xmlChar *content = xmlNodeListGetString(attr->doc, attr->children, 1);
                        attrs.push_back(reinterpret_cast< char const * >(content));
                        xmlFree(content);
                }
        }
        return attrs;
}

}

bool SimpleSelector::Test(EngineContext const &context, xmlNodePtr node) const
{
        if (node->type != 1)
            return false;

        switch (type)
        {
                case SimpleSelectorType::Id: // ID test (#id)
                {
                        xmlAttrPtr attr = xmlHasNsProp(node, reinterpret_cast<xmlChar const *>("id"), nullptr);
                        if (!attr)
                        {
                                return false;
                        }

                        auto content = xmlNodeListGetString(attr->doc, attr->children, 1);
                        if (!content)
                        {
                                return false;
                        }

                        auto attrvalue = std::string_view(reinterpret_cast<char const *>(content));
                        std::string_view compareto = value;
                        bool retval = Blex::StrCaseCompare(attrvalue.begin(), attrvalue.end(), compareto.begin(), compareto.end()) == 0;
                        xmlFree(content);
                        return retval;
                }
                case SimpleSelectorType::Class: // class test (.class)
                {
                        std::vector< std::string > classattrs = GetAttributes(node, ""sv, "class"sv, context.ishtml);

                        if (classattrs.empty())
                        {
                                return false;
                        }

                        bool retval = false;
                        for (auto &attrvalue: classattrs)
                        {
                                retval = TestIncludes(attrvalue, value);
                                if (retval)
                                    break;
                        }

                        return retval;
                }

                case SimpleSelectorType::Attribute: // attribute test ([attr=value])
                {
                        std::vector< std::string > attrs = GetAttributes(node, namespaceuri, name, context.ishtml);

                        bool retval = false;
                        for (auto &attrvalue: attrs)
                        {
                                if (casesensitive && attributematcher != AttributeMatcher::Existence)
                                {
                                        // Compareto already lowercased during parsing
                                        Blex::ToLowercase(attrvalue);
                                }

                                switch (attributematcher)
                                {
                                case AttributeMatcher::Existence:             retval = true; break;
                                case AttributeMatcher::Equality:              retval = Blex::StrCompare< std::string::const_iterator >(attrvalue.begin(), attrvalue.end(), value.begin(), value.end()) == 0; break;
                                case AttributeMatcher::SpaceSeparatedValue:   retval = TestIncludes(attrvalue, value); break;
                                case AttributeMatcher::HyphenSeparatedValue:
                                {
                                        if (value.empty() || Blex::StrCaseCompare< std::string::const_iterator >(attrvalue.begin(), attrvalue.end(), value.begin(), value.end(), value.size()) != 0)
                                            retval = false;
                                        else
                                        {
                                                auto nextchar = attrvalue.begin() + value.size();
                                                retval = nextchar == attrvalue.end() || *nextchar == '-';
                                        }
                                } break;
                                case AttributeMatcher::Startswith:
                                {
                                        retval = !value.empty() && Blex::StrCaseCompare< std::string::const_iterator >(attrvalue.begin(), attrvalue.end(), value.begin(), value.end(), value.size()) == 0;
                                } break;
                                case AttributeMatcher::EndsWith:
                                {
                                        if (attrvalue.size() < value.size())
                                            retval = false;
                                        else
                                            retval = !value.empty() && Blex::StrCaseCompare< std::string::const_iterator >(attrvalue.end() - value.size(), attrvalue.end(), value.begin(), value.end()) == 0;
                                } break;
                                case AttributeMatcher::Contains:
                                {
                                        retval = !value.empty() && TestContains(attrvalue, value);
                                } break;
                                case AttributeMatcher::NoMatch:                 retval = false; break;
                                default:                                        retval = false; break;
                                }

                                if (retval)
                                    break;

                        }
                        return retval;
                }

                case SimpleSelectorType::Function: // Function test (func(...)
                {
                        bool retval;
                        if (name == "not"sv)
                            retval = !compoundselector->Test(context, node);
                        else if (name == "nth-child"sv)
                            retval = TestIndex(context, node, true, compoundselector.get());
                        else if (name == "nth-last-child"sv)
                            retval = TestIndex(context, node, false, compoundselector.get());
                        else if (name == "nth-of-type"sv)
                        {
                                CompoundSelector c;
                                c.tag = reinterpret_cast<const char*>(node->name);

                                retval = TestIndex(context, node, true, &c);
                        }
                        else if (name == "nth-last-of-type"sv)
                        {
                                CompoundSelector c;
                                c.tag = reinterpret_cast<const char*>(node->name);

                                retval = TestIndex(context, node, false, &c);
                        }
                        else
                        {
                                throw std::runtime_error("unknown function");
                        }
                        return retval;
                }

                case SimpleSelectorType::PseudoClass: // Pseudo-class test (:class)
                {
                        bool retval;
                        if (name == "first-child"sv)
                            retval = TestFirst(context, node, true, nullptr);
                        else if (name == "last-child"sv)
                            retval = TestFirst(context, node, false, nullptr);
                        else if (name == "only-child"sv)
                            retval = TestFirst(context, node, true, nullptr) && TestFirst(context, node, false, nullptr);
                        else if (name == "first-of-type"sv)
                        {
                                CompoundSelector c;
                                c.tag = reinterpret_cast<const char*>(node->name);
                                retval = TestFirst(context, node, true, &c);
                        }
                        else if (name == "last-of-type"sv)
                        {
                                CompoundSelector c;
                                c.tag = reinterpret_cast<const char*>(node->name);
                                retval = TestFirst(context, node, false, &c);
                        }
                        else if (name == "only-of-type"sv)
                        {
                                CompoundSelector c;
                                c.tag = reinterpret_cast<const char*>(node->name);
                                retval = TestFirst(context, node, true, &c) && TestFirst(context, node, false, &c);
                        }
                        else if (name == "root"sv)
                            retval = node == context.root;
                        else if (name == "scope"sv)
                            retval = node == context.scope;
                        else if (name == "empty"sv)
                        {
                                xmlNodePtr child = node->children;
                                retval = true;
                                while (child)
                                {
                                        if (child->type == 1 || child->type == 3 || child->type == 4)
                                        {
                                                retval = false;
                                                break;
                                        }
                                        child = child->next;
                                }
                        }
                        else
                        {
                                throw std::runtime_error(("unknown pseudo-class: " + Blex::AnyToJSON(name)).c_str());
                        }
                        return retval;
                }
        }

        return false;
}

/** Returns the index of a node counted from the start or end (optionally only counting elements matching a selector)
    @param context
    @param node Node to test
    @param fromstart `true` to count from the start, `false` to count from the end
    @param compoundselector If set, selector to test the element against before counting them
    @return 1-based index of the node.
*/
int32_t SimpleSelector::GetIndex(EngineContext const &context, xmlNodePtr node, bool fromstart, CompoundSelector *compoundselector) const
{
        int32_t idx = 1;
        while (true)
        {
                // Find all previous elements to count from the start (and all next elements to count from the end)
                do
                {
                        node = fromstart ? node->prev : node->next;
                } while (node && node->type != 1);

                // None found, done counting
                if (!node)
                    break;

                // Count the element if it matches the selector
                if (!compoundselector || compoundselector->Test(context, node))
                    ++idx;
        }
        return idx;
}

/** Test if a node is the first element that matches a selector (or the first element if no selector is passed)
    @param context
    @param node Node to test
    @param fromstart `true` to test for the first element, `false` to test for that last.
    @param compoundselector If set, selector to test the element against before counting them
    @return Returns if this is the first/last node
*/
bool SimpleSelector::TestFirst(EngineContext const &context, xmlNodePtr node, bool fromstart, CompoundSelector *compoundselector) const
{
        while (true)
        {
                do
                {
                  node = fromstart ? node->prev : node->next;
                } while (node && node->type != 1);
                if (!node)
                    break;

                // Found an element. If it matches the selector, our original node is not the first
                if (!compoundselector || compoundselector->Test(context, node))
                    return false;
        }
        return true;
}

/** Test an index-based function (nth-child of)
    @param node Node
    @param ishtml Whether the node is from a HTML document
    @param fromstart If TRUE, get the index from the start, else from the end
    @param sc Test data
    @cell(integer) sc.factor A from An+B expression
    @cell(integer) sc.ofs B from An+B expression
    @cell sc.compoundselector Compound selector @includecelldef #CSSSelectorParser::ParseCompoundSelector.return
    @param context Query context
    @cell(object) context.root Root node
    @cell(object) context.scope Scope node
    @return Whether the node matches the index-based functions
*/
bool SimpleSelector::TestIndex(EngineContext const &context, xmlNodePtr node, bool fromstart, CompoundSelector *compoundselector) const
{
        int32_t idx = GetIndex(context, node, fromstart, compoundselector);
        int32_t todiv = idx - ofs;
        bool ismatch = factor == 0
              ? todiv == 0
              : (todiv / factor >= 0) && (todiv % factor == 0);

        return ismatch;
}

/** Test if a node matches this selector
    @param context Engine context
    @param node Node to test
    @return `true` if this node matches this selector
*/
bool CompoundSelector::Test(EngineContext const &context, xmlNodePtr node) const
{
        // If the tag is non-empty, compare with the nodename
        if (!tag.empty())
        {
                auto nodename = std::string_view(reinterpret_cast<const char*>(node->name));
                std::string_view compareto = tag;

                // HTML matches the tag name case-insensitive
                bool tagmatch = context.ishtml
                        ? Blex::StrCaseCompare(nodename.begin(), nodename.end(), compareto.begin(), compareto.end()) == 0
                        : Blex::StrCompare(nodename.begin(), nodename.end(), compareto.begin(), compareto.end()) == 0;

                if (!tagmatch)
                    return false;
        }

        // Test all simple selectors
        for (auto &itr: selectors)
            if (!itr.Test(context, node))
                return false;

        return true;
}

/** Get the element path to the root (including the node itself). First returned node is the root node
    @param node Node to get the path from
    @param scopepath Filled with the scope path (should be empty when calling this function)
*/
void GetScopePath(xmlNodePtr node, Blex::SemiStaticPodVector< xmlNodePtr, 256 > *scopepath)
{
        while (node && node->type == 1)
        {
                scopepath->push_back(node);
                node = node->parent;
        }
        std::reverse(scopepath->begin(), scopepath->end());
}

/// Returns first next sibling node that has type 1 (element)
xmlNodePtr nextElementSibling(xmlNodePtr node)
{
        do
        {
                node = node->next;
        }
        while (node && node->type != 1);
        return node;
}

/// Returns first previous sibling node that has type 1 (element)
xmlNodePtr firstElementChild(xmlNodePtr node)
{
        node = node->children;
        while (node && node->type != 1)
            node = node->next;
        return node;
}

/** Evaluation stack item
    Contains a record for every node in the path to the current node
    @cell node Node to test next (is set to nextsibling before recursing into children)
    @cell alwaysactive List of selector parts positions that are always active in the tree
    @cell levelactive List of selector parts positions that are active at this level (children of the current parent). Also
      includes all positions in the alwaysactive list.
    @cell nodeactive List of selectors that are active for the current node (in #node)
*/
struct StackItem
{
        xmlNodePtr node;
        Blex::SemiStaticPodVector< unsigned, 1024 > alwaysactive;
        Blex::SemiStaticPodVector< unsigned, 1024 > levelactive;
        Blex::SemiStaticPodVector< unsigned, 1024 > nodeactive;
};

// delete scopeactive from alwaysactive, scopeactive must be sorted
void DeleteScopeActive(Blex::SemiStaticPodVector< unsigned, 1024 > &alwaysactive, Blex::SemiStaticPodVector< unsigned, 1024 > const &scopeactive)
{
        if (scopeactive.empty())
            return;

        std::sort(alwaysactive.begin(), alwaysactive.end());
        auto si = scopeactive.begin();
        auto insert = alwaysactive.begin();
        for (auto i = alwaysactive.begin(); i != alwaysactive.end(); ++i)
        {
              if (*i > *si)
              {
                      do
                      {
                          if (++si == scopeactive.end())
                              break;
                      }
                      while (*i > *si);
                      if (si == scopeactive.end())
                      {
                              for (; i != alwaysactive.end(); ++i)
                                  *(insert++) = *i;
                              break;
                      }
              }
              if (*i != *si)
                  *(insert++) = *i;
        }
        alwaysactive.erase(insert, alwaysactive.end());
}

void EvaluateSelectors(EngineContext const &context, std::vector< ComplexSelectorPart > const &selectors, xmlNodePtr scope, EvaluateMode mode, std::vector< EvaluateResult > *results)
{
        Blex::SemiStaticPodVector< unsigned, 1024 > alwaysactive, rootactive, scopeactive;
        Blex::SemiStaticPodVector< xmlNodePtr, 256 > scopepath;

        // The scope path is the path from the document root to the scope node, including the scope node.
        GetScopePath(scope, &scopepath);

        /* Inspect all complexselectorparts, identify the first part of a complex selector
           and record those as starting points (in the context they should start in)
           Selectors with :root or :scope are recorded in rootactive and scopeactive
           respectively, other selectors in alwaysactive.
        */
        Combinator lastcombinator = Combinator::Done;
        unsigned pos = 0;
        for (auto &itr: selectors)
        {
                if (lastcombinator == Combinator::Done)
                {
                        bool added = false;
                        for (auto &selector: itr.compoundselector.selectors)
                            if (selector.type == SimpleSelectorType::PseudoClass)
                            {
                                    if (selector.name == "root"sv)
                                        rootactive.push_back(pos);
                                    else if (selector.name == "scope"sv)
                                        scopeactive.push_back(pos);
                                    else
                                        continue;
                                    added = true;
                                    break;
                            }
                        if (!added)
                            alwaysactive.push_back(pos);
                }
                ++pos;
                lastcombinator = itr.combinator;
        }

        // Current depth in nodes, :root is depth 0
        unsigned depth = 0;
        xmlNodePtr startnode = context.root;

        // No need to run when where are no active rules, the invariant that levelactive is never empty will then hold
        if (alwaysactive.empty() && rootactive.empty())
        {
                if (scopeactive.empty())
                    return;

                // There are rules starting with a :scope selector. We can start evaluation at the scope node in that case.
                startnode = scope;
                scopepath.clear();
                scopepath.push_back(scope);
        }

        // When mode is 'closest' or 'match', don't allow recursing outside of scope path
        unsigned maxdepth = 0;
        unsigned min_return_depth = 0;

        if (mode == EvaluateMode::QS || mode == EvaluateMode::QSA)
        {
                // qS(A) may not return stuff in the scope path, needs to recurse into children of the scope
                maxdepth = std::numeric_limits< unsigned >::max();
                min_return_depth = scopepath.size();
        }
        else
        {
                // match may only return the scope element, closest all items in the scope path (and we'll return the last)
                maxdepth = scopepath.size() - 1;
                min_return_depth = mode == EvaluateMode::Closest || scopepath.empty() ? 0 : scopepath.size() - 1;
        }

        // Reworking the algorithm to only run scoperules at the :scope node is too much work for now, so just add them to the alwaysactive rules
        // they are removed when processing the :scope node, so they are only tested in the scope path anyway.
        std::vector< StackItem > stack;
        stack.reserve(256);
        StackItem &rootitem = stack.emplace_back();
        rootitem.node = startnode;
        rootitem.alwaysactive = alwaysactive;
        rootitem.alwaysactive.insert(rootitem.alwaysactive.end(), scopeactive.begin(), scopeactive.end());
        rootitem.levelactive = rootitem.alwaysactive;
        rootitem.levelactive.insert(rootitem.levelactive.end(), rootactive.begin(), rootactive.end());

        while (true)
        {
                StackItem &elt = stack[depth];

                xmlNodePtr testnode = elt.node;

                // for children, all items that are always active at this point are active, active at its level is filled by '>' combinators.
                Blex::SemiStaticPodVector< unsigned, 1024 > childalwaysactive = elt.alwaysactive, childlevelactive;

                // Is this node a match?
                bool ismatch = false;
                std::vector< HSVM_VariableId > selectordata;

                // List of rules active at the next node, filled by "+" combinators
                Blex::SemiStaticPodVector< unsigned, 1024 > newnodeactive;

                // Is the current node in the path to the current :scope element?
                bool inscopepath = depth < scopepath.size() && testnode == scopepath[depth];
                if (inscopepath ? depth == scopepath.size() - 1 : depth == 0)
                {
                        // delete scoperules from childalwaysactive
                        DeleteScopeActive(childalwaysactive, scopeactive);
                }

                // INV: elt.levelaction is always filled, so nosiblingcombinatoractive can only remain TRUE when depth < scopepath.pathlen
                bool nosiblingcombinatoractive = true;

                // iterate over both levelactive and nodeactive (don't want the codeduplication)
                for (auto i = elt.levelactive.empty() ? elt.nodeactive.begin() : elt.levelactive.begin(); i != elt.nodeactive.end(); i = ((i + 1 == elt.levelactive.end()) ? elt.nodeactive.begin() : i + 1))
                {
                        ComplexSelectorPart const &rec = selectors[*i];

                        // If we're in the scope path at the depth, we can jump directly to the scope node of this level if no sibling combinators are active
                        if ((rec.combinator != Combinator::NextSibling && rec.combinator != Combinator::Following) && depth < scopepath.size())
                        {
                                  if (!inscopepath)
                                      continue;
                        }
                        else
                            nosiblingcombinatoractive = false;

                        // Skip final rule parts when the current node may not be given back
                        if (rec.combinator == Combinator::Done && depth < min_return_depth)
                            continue;

                        // Test the rule part
                        bool testresult = rec.compoundselector.Test(context, testnode);
                        if (!testresult)
                            continue;

                        switch (rec.combinator)
                        {
                        case Combinator::DirectDescendent:
                              {
                                      childlevelactive.push_back(*i + 1);
                              } break;
                        case Combinator::Descendent:
                              {
                                      if (std::find(childalwaysactive.begin(), childalwaysactive.end(), *i + 1) == childalwaysactive.end())
                                          childalwaysactive.push_back(*i + 1);

                                      // no need to check for this rule anymore
                                      auto pos = std::find(childalwaysactive.begin(), childalwaysactive.end(), *i);
                                      if (pos != childalwaysactive.end())
                                          childalwaysactive.erase(pos);
                              } break;
                        case Combinator::NextSibling:
                              {
                                      newnodeactive.push_back(*i + 1);
                              } break;
                        case Combinator::Following:
                              {
                                      if (std::find(elt.levelactive.begin(), elt.levelactive.end(), *i + 1) == elt.levelactive.end())
                                          elt.levelactive.push_back(*i + 1);

                                      // no need to check for this rule anymore in this level
                                      auto pos = std::find(elt.levelactive.begin(), elt.levelactive.end(), *i);
                                      if (pos != elt.levelactive.end())
                                          elt.levelactive.erase(pos);
                              } break;
                        case Combinator::Done:
                              {
                                      // last part of a selector, it's a match
                                      ismatch = true;
                                      selectordata.push_back(rec.selectordata);
                              } break;
                        }
                }

                if (ismatch)
                {
                        auto &res = results->emplace_back();
                        res.node = testnode;
                        std::swap(res.selectordata, selectordata);
                        if (mode == EvaluateMode::QS)
                            return;
                }

                /* prepare for processing the next node at this level
                  If there is a scope path node at this depth, all results must be in the
                  scope path. If there are no '+' or '~' rules active at this level, we
                  can just jump to the scope path node. And if we have just visited that
                  node, we can stop at this depth.
                */
                elt.nodeactive = newnodeactive;
                elt.node = inscopepath
                    ? nullptr
                    : nosiblingcombinatoractive ? scopepath[depth] : nextElementSibling(testnode);

                // Any rules are active at the children, we can try to recurse into them
                // We need to be in the scope path, or if we're allowed to recurse into childen of the scope
                if ((!childalwaysactive.empty() || !childlevelactive.empty()) && depth < maxdepth && (depth >= scopepath.size() || inscopepath))
                {
                        // fill the levelactive with the childalwaysactive and childlevelactive, so less need to concatenate in the next level
                        auto firstelementchild = firstElementChild(testnode);
                        if (firstelementchild)
                        {
                                auto &newelt = stack.emplace_back();
                                ++depth;
                                newelt.node = firstelementchild;
                                newelt.alwaysactive = childalwaysactive;
                                newelt.levelactive = childalwaysactive;
                                newelt.levelactive.insert(newelt.levelactive.end(), childlevelactive.begin(), childlevelactive.end());
                                continue;
                        }
                }

                if (!elt.node)
                {
                        // Don't allow depth to go negative
                        do
                        {
                                stack.pop_back();
                                if (!depth)
                                    break;
                                --depth;
                        }
                        while (!stack[depth].node);

                        // If the stack is empty, evaluation is complete
                        if (stack.empty())
                            break;
                }
        }

        // In mode closest, return the last match
        if (mode == EvaluateMode::Closest && !results->empty())
            results->erase(results->begin(), results->end() - 1);
}

std::pair< bool, EvaluateMode > ParseEvaluateMode(HSVM *vm, std::string_view str_mode)
{
        if (str_mode == "closest"sv)
            return std::make_pair(true, EvaluateMode::Closest);
        else if (str_mode == "qS"sv)
            return std::make_pair(true, EvaluateMode::QS);
        else if (str_mode == "qSA"sv)
            return std::make_pair(true, EvaluateMode::QSA);
        else if (str_mode == "match"sv)
            return std::make_pair(true, EvaluateMode::Match);
        HSVM_ThrowException(vm, "Illegal evaluate mode");
        return std::make_pair(false, EvaluateMode::QS);
}

std::pair< bool, Combinator > ParseCombinator(HSVM *vm, std::string_view str_mode)
{
        if (str_mode == ""sv)
            return std::make_pair(true, Combinator::Done);
        else if (str_mode == " "sv)
            return std::make_pair(true, Combinator::Descendent);
        else if (str_mode == ">"sv)
            return std::make_pair(true, Combinator::DirectDescendent);
        else if (str_mode == "~"sv)
            return std::make_pair(true, Combinator::Following);
        else if (str_mode == "+"sv)
            return std::make_pair(true, Combinator::NextSibling);
        HSVM_ThrowException(vm, "Illegal combinator");
        return std::make_pair(false, Combinator::Done);
}

bool ParseCompoundSelector(HSVM *vm, HSVM_VariableId var_compoundselector, CompoundSelector *cs)
{
        HSVM_ColumnId col_tag = HSVM_GetColumnId(vm, "TAG");
        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_ColumnId col_name = HSVM_GetColumnId(vm, "NAME");
        HSVM_ColumnId col_value = HSVM_GetColumnId(vm, "VALUE");
        HSVM_ColumnId col_attr = HSVM_GetColumnId(vm, "ATTR");
        HSVM_ColumnId col_attrns = HSVM_GetColumnId(vm, "ATTRNS");
        HSVM_ColumnId col_selectors = HSVM_GetColumnId(vm, "SELECTORS");
        HSVM_ColumnId col_matcher = HSVM_GetColumnId(vm, "MATCHER");
        HSVM_ColumnId col_compoundselector = HSVM_GetColumnId(vm, "COMPOUNDSELECTOR");
        HSVM_ColumnId col_casesensitive = HSVM_GetColumnId(vm, "CASESENSITIVE");
        HSVM_ColumnId col_factor = HSVM_GetColumnId(vm, "FACTOR");
        HSVM_ColumnId col_ofs = HSVM_GetColumnId(vm, "OFS");

        HSVM_VariableId var_tag = HSVM_RecordGetRequiredTypedRef(vm, var_compoundselector, col_tag, HSVM_VAR_String);
        if (!var_tag)
            return false;

        HSVM_VariableId var_selectors = HSVM_RecordGetRequiredTypedRef(vm, var_compoundselector, col_selectors, HSVM_VAR_RecordArray);
        if (!var_selectors)
            return false;

        cs->tag = HSVM_StringGetSTD(vm, var_tag);
        if (cs->tag == "*"sv)
            cs->tag.clear();

        unsigned len = HSVM_ArrayLength(vm, var_selectors);
        for (unsigned i = 0; i < len; ++i)
        {
                HSVM_VariableId elt = HSVM_ArrayGetRef(vm, var_selectors, i);
                auto &sel = cs->selectors.emplace_back();

                HSVM_VariableId var_type = HSVM_RecordGetRequiredTypedRef(vm, elt, col_type, HSVM_VAR_String);
                if (!var_type)
                    return false;

                std::string str_type = HSVM_StringGetSTD(vm, var_type);
                if (str_type == "#"sv || str_type == "."sv)
                {
                        sel.type = str_type[0] == '#' ? SimpleSelectorType::Id : SimpleSelectorType::Class;
                        HSVM_VariableId var_value = HSVM_RecordGetRequiredTypedRef(vm, elt, col_value, HSVM_VAR_String);
                        if (!var_value)
                            return false;
                        sel.value = HSVM_StringGetSTD(vm, var_value);
                }
                else if (str_type == "[")
                {
                        HSVM_VariableId var_matcher = HSVM_RecordGetRequiredTypedRef(vm, elt, col_matcher, HSVM_VAR_String);
                        if (!var_matcher)
                            return false;

                        HSVM_VariableId var_attr = HSVM_RecordGetRequiredTypedRef(vm, elt, col_attr, HSVM_VAR_String);
                        if (!var_attr)
                            return false;

                        HSVM_VariableId var_attrns = HSVM_RecordGetRequiredTypedRef(vm, elt, col_attrns, HSVM_VAR_String);
                        if (!var_attrns)
                            return false;

                        sel.type = SimpleSelectorType::Attribute;
                        sel.name = HSVM_StringGetSTD(vm, var_attr);
                        sel.namespaceuri = HSVM_StringGetSTD(vm, var_attrns);

                        std::string matcher = HSVM_StringGetSTD(vm, var_matcher);
                        if (matcher == "has"sv)
                            sel.attributematcher = AttributeMatcher::Existence;
                        else if (matcher == "="sv)
                            sel.attributematcher = AttributeMatcher::Equality;
                        else if (matcher == "~="sv)
                            sel.attributematcher = AttributeMatcher::SpaceSeparatedValue;
                        else if (matcher == "^="sv)
                            sel.attributematcher = AttributeMatcher::Startswith;
                        else if (matcher == "$="sv)
                            sel.attributematcher = AttributeMatcher::EndsWith;
                        else if (matcher == "*="sv)
                            sel.attributematcher = AttributeMatcher::Contains;
                        else if (matcher == "|="sv)
                            sel.attributematcher = AttributeMatcher::HyphenSeparatedValue;
                        else if (matcher == "nomatch"sv)
                            sel.attributematcher = AttributeMatcher::NoMatch;
                        else
                        {
                                HSVM_ThrowException(vm, "Illegal attribute matcher");
                        }

                        if (sel.attributematcher != AttributeMatcher::Existence)
                        {
                                HSVM_VariableId var_casesensitive = HSVM_RecordGetRequiredTypedRef(vm, elt, col_casesensitive, HSVM_VAR_Boolean);
                                if (!var_casesensitive)
                                    return false;
                                sel.casesensitive = HSVM_BooleanGet(vm, var_casesensitive);

                                HSVM_VariableId var_value = HSVM_RecordGetRequiredTypedRef(vm, elt, col_value, HSVM_VAR_String);
                                if (!var_value)
                                    return false;
                                sel.value = HSVM_StringGetSTD(vm, var_value);

                                if (sel.casesensitive)
                                    Blex::ToLowercase(sel.value.begin(), sel.value.end());
                        }
                }
                else if (str_type == "(")
                {
                        HSVM_VariableId var_name = HSVM_RecordGetRequiredTypedRef(vm, elt, col_name, HSVM_VAR_String);
                        if (!var_name)
                            return false;

                        sel.type = SimpleSelectorType::Function;
                        sel.name = HSVM_StringGetSTD(vm, var_name);
                        if (sel.name == "not"sv)
                        {
                                sel.compoundselector.reset(new CompoundSelector);

                                HSVM_VariableId var_sub_compoundselector = HSVM_RecordGetRequiredTypedRef(vm, elt, col_compoundselector, HSVM_VAR_Record);
                                if (!var_sub_compoundselector)
                                    return false;

                                if (!ParseCompoundSelector(vm, var_sub_compoundselector, sel.compoundselector.get()))
                                    return false;
                        }
                        else if (sel.name == "nth-child"sv || sel.name == "nth-last-child"sv)
                        {
                                HSVM_VariableId var_factor = HSVM_RecordGetRequiredTypedRef(vm, elt, col_factor, HSVM_VAR_Integer);
                                if (!var_factor)
                                    return false;
                                HSVM_VariableId var_ofs = HSVM_RecordGetRequiredTypedRef(vm, elt, col_ofs, HSVM_VAR_Integer);
                                if (!var_ofs)
                                    return false;
                                HSVM_VariableId var_sub_compoundselector = HSVM_RecordGetRequiredTypedRef(vm, elt, col_compoundselector, HSVM_VAR_Record);
                                if (!var_sub_compoundselector)
                                    return false;

                                sel.factor = HSVM_IntegerGet(vm, var_factor);
                                sel.ofs = HSVM_IntegerGet(vm, var_ofs);

                                if (HSVM_RecordExists(vm, var_sub_compoundselector))
                                {
                                        sel.compoundselector.reset(new CompoundSelector);
                                        if (!ParseCompoundSelector(vm, var_sub_compoundselector, sel.compoundselector.get()))
                                            return false;
                                }

                        }
                        else if (sel.name == "nth-of-type"sv || sel.name == "nth-last-of-type"sv)
                        {
                                HSVM_VariableId var_factor = HSVM_RecordGetRequiredTypedRef(vm, elt, col_factor, HSVM_VAR_Integer);
                                if (!var_factor)
                                    return false;
                                HSVM_VariableId var_ofs = HSVM_RecordGetRequiredTypedRef(vm, elt, col_ofs, HSVM_VAR_Integer);
                                if (!var_ofs)
                                    return false;

                                sel.factor = HSVM_IntegerGet(vm, var_factor);
                                sel.ofs = HSVM_IntegerGet(vm, var_ofs);
                        }
                        else
                        {
                                HSVM_ThrowException(vm, "Illegal function name");
                                return false;
                        }
                }
                else if (str_type == ":")
                {
                        HSVM_VariableId var_name = HSVM_RecordGetRequiredTypedRef(vm, elt, col_name, HSVM_VAR_String);
                        if (!var_name)
                            return false;

                        sel.type = SimpleSelectorType::PseudoClass;
                        sel.name = HSVM_StringGetSTD(vm, var_name);
                        if (sel.name != "root"sv && sel.name == "scope"sv && sel.name == "empty"sv)
                        {
                                HSVM_ThrowException(vm, "Illegal pseudo-class name");
                                return false;
                        }
                }
        }
        return true;
}

bool ParseComplexSelectorParts(HSVM *vm, HSVM_VariableId var, ComplexSelectorParts *result)
{

        HSVM_ColumnId col_combinator = HSVM_GetColumnId(vm, "COMBINATOR");
        HSVM_ColumnId col_compoundselector = HSVM_GetColumnId(vm, "COMPOUNDSELECTOR");
        HSVM_ColumnId col_selector = HSVM_GetColumnId(vm, "SELECTOR");

        Combinator lastcombinator = Combinator::Done;

        unsigned len = HSVM_ArrayLength(vm, var);
        for (unsigned i = 0; i < len; ++i)
        {
                auto &part = result->emplace_back();

                HSVM_VariableId elt = HSVM_ArrayGetRef(vm, var, i);
                HSVM_VariableId var_combinator = HSVM_RecordGetRequiredTypedRef(vm, elt, col_combinator, HSVM_VAR_String);
                if (!var_combinator)
                    return false;
                HSVM_VariableId var_compoundselector = HSVM_RecordGetRequiredTypedRef(vm, elt, col_compoundselector, HSVM_VAR_Record);
                if (!var_compoundselector)
                    return false;

                auto combinator = ParseCombinator(vm, HSVM_StringGetSTD(vm, var_combinator));
                if (!combinator.first)
                    return false;

                part.combinator = combinator.second;
                lastcombinator = combinator.second;

                if (!ParseCompoundSelector(vm, var_compoundselector, &part.compoundselector))
                    return false;

                if (combinator.second == Combinator::Done)
                    part.selectordata = HSVM_RecordGetRequiredTypedRef(vm, elt, col_selector, HSVM_VAR_Record);
        }
        if (lastcombinator != Combinator::Done)
        {
                HSVM_ThrowException(vm, "Last combinator should be \"\"");
                return false;
        }
        return true;
}

} // CSS
} // Xml
} // HareScript
