#ifndef harescript_modules_xml_xml_cssengine
#define harescript_modules_xml_xml_cssengine

#include <blex/context.h>
#include <blex/path.h>
#include <blex/xml.h>
#include <harescript/vm/hsvm_dllinterface.h>

namespace HareScript
{
namespace Xml
{
namespace CSS
{

enum class Combinator
{
    Done, ///< Complex selector matches when reached
    Descendent, ///< " ": any descendent matches
    DirectDescendent, ///< ">": direct descendent matches
    Following, ///< Following sibling matches
    NextSibling, ///< Next sibling matches
};

enum class SimpleSelectorType
{
    Id, ///< ID test (#id)
    Class, ///< class test (.class)
    Attribute, ///< attribute test ([attr=value])
    Function, ///< Function test (func(...)
    PseudoClass, ///< Pseudo-class test (:class)
};

enum class AttributeMatcher
{
    Existence, ///< - "": only existence check
    Equality, ///< - "=": equality check
    SpaceSeparatedValue, ///< - "~=": value exists in space-separated list
    HyphenSeparatedValue, ///< - "|=": valus is first value in hyphen-separated list
    Startswith, ///< - "^=": attribute value starts with value
    EndsWith, ///< - "$=": attribute value ends with value
    Contains, ///< - "*=": attribute value contains with value
    NoMatch ///< - "nomatch": used for attributepart matches with an empty string - they don't match any element
};

struct CompoundSelector;

struct EngineContext
{
        xmlNodePtr root;
        xmlNodePtr scope;
        bool ishtml;
};

struct SimpleSelector
{
        /// Type of subclass
        SimpleSelectorType type;

        /// Value to compare with (id, class, attribute value). Lowercased for case-insensitive matches.
        std::string value;

        /// Attribute/function/pseudo-class name
        std::string name;

        /// Attribute namespaceuri ("*" for match all)
        std::string namespaceuri;

        /// Attribute matcher
        AttributeMatcher attributematcher;

        /// Case sensitive attribute match
        bool casesensitive;

        /// Factor for An+B tests
        int32_t factor;

        /// Offset for An+B tests
        int32_t ofs;

        /// Compound selectors for :not
        std::unique_ptr< CompoundSelector > compoundselector;

        bool Test(EngineContext const &context, xmlNodePtr node) const;
        int32_t GetIndex(EngineContext const &context, xmlNodePtr node, bool fromstart, CompoundSelector *compoundselector) const;
        bool TestFirst(EngineContext const &context, xmlNodePtr node, bool fromstart, CompoundSelector *compoundselector) const;
        bool TestIndex(EngineContext const &context, xmlNodePtr node, bool fromstart, CompoundSelector *compoundselector) const;
};

struct CompoundSelector
{
        std::string tag;
        std::vector< SimpleSelector > selectors;

        bool Test(EngineContext const &context, xmlNodePtr node) const;
};

struct ComplexSelectorPart
{
        CompoundSelector compoundselector;
        Combinator combinator;
        HSVM_VariableId selectordata;
};

typedef std::vector< ComplexSelectorPart > ComplexSelectorParts;

enum class EvaluateMode
{
        QS,
        QSA,
        Closest,
        Match
};

struct EvaluateResult
{
        xmlNodePtr node;
        std::vector< HSVM_VariableId > selectordata;
};

std::pair< bool, EvaluateMode > ParseEvaluateMode(HSVM *vm, std::string_view mode);
bool ParseComplexSelectorParts(HSVM *vm, HSVM_VariableId var, ComplexSelectorParts *result);
void EvaluateSelectors(EngineContext const &context, ComplexSelectorParts const &selectors, xmlNodePtr scope, EvaluateMode mode, std::vector< EvaluateResult > *results);

} // CSS
} // Xml
} // HareScript

#endif