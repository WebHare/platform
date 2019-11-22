#include <harescript/vm/allincludes.h>

#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hs_lexer.h>
#include <harescript/vm/hsvm_context.h>
#include <regex>

namespace HareScript
{
namespace Baselibs
{

struct RegexContextData
{
        class CachedRegex
        {
            public:
                CachedRegex(std::string const &regex_str, std::regex_constants::syntax_option_type syntax_option)
                : regex_str(regex_str)
                , syntax_option(syntax_option)
                , regex(regex_str, syntax_option)
                {
                }

                std::string regex_str;
                std::regex_constants::syntax_option_type syntax_option;
                std::regex regex;
        };


        typedef std::list< CachedRegex > RegexCache;
        RegexCache regex_cache;
};

const int RegexContextId = 22;
typedef Blex::Context< RegexContextData, RegexContextId, void> RegexContext;


void HandleRegexErrorMessage(VirtualMachine *vm, std::regex_error const &e)
{
        std::string code;
        switch (e.code())
        {
            case std::regex_constants::error_collate:        code = "the expression contains an invalid collating element name"; break;
            case std::regex_constants::error_ctype:          code = "the expression contains an invalid character class name"; break;
            case std::regex_constants::error_escape:         code = "the expression contains an invalid escaped character or a trailing escape"; break;
            case std::regex_constants::error_backref:        code = "the expression contains an invalid back reference"; break;
            case std::regex_constants::error_brack:          code = "the expression contains mismatched square brackets ('[' and ']')"; break;
            case std::regex_constants::error_paren:          code = "the expression contains mismatched parentheses ('(' and ')')"; break;
            case std::regex_constants::error_brace:          code = "the expression contains mismatched curly braces ('{' and '}')"; break;
            case std::regex_constants::error_badbrace:       code = "the expression contains an invalid range in a {} expression"; break;
            case std::regex_constants::error_range:          code = "the expression contains an invalid character range (e.g. [b-a])"; break;
            case std::regex_constants::error_space:          code = "there was not enough memory to convert the expression into a finite state machine"; break;
            case std::regex_constants::error_badrepeat:      code = "one of *?+{ was not preceded by a valid regular expression"; break;
            case std::regex_constants::error_complexity:     code = "the complexity of an attempted match exceeded a predefined level"; break;
            case std::regex_constants::error_stack:          code = "there was not enough memory to perform a match"; break;
            default:                                         code = "there was an unspecified error parsing your expression (code: " + Blex::AnyToString(static_cast< int >(e.code())) + ")"; break;
        }

        std::string what = e.what();

        if (what == "regex_error")
            HSVM_ThrowException(*vm, (what + ": " + code).c_str());
        else
            HSVM_ThrowException(*vm, (what + " (" + code + ")").c_str());
}

std::regex_constants::syntax_option_type ParseSyntaxOptions(HSVM_VariableId opts, VirtualMachine *vm)
{
        int32_t len = HSVM_ArrayLength(*vm, opts);
        if (len == 0)
            return std::regex_constants::ECMAScript;

        std::regex_constants::syntax_option_type result;
        std::string type = HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, opts, 0));

        if ("normal" == type || "ecmascript" == type || "JavaScript" == type || "JScript" == type || "perl" == type)
            result = std::regex_constants::ECMAScript;
        else if ("basic" == type || "sed" == type)
            result = std::regex_constants::basic;
        else if ("extended" == type)
            result = std::regex_constants::extended;
        else if ("awk" == type)
            result = std::regex_constants::awk;
        else if ("grep" == type)
            result = std::regex_constants::grep;
        else if ("egrep" == type)
            result = std::regex_constants::egrep;
        else
            throw std::runtime_error(("Unrecognized first syntax option: '" + type + "'").c_str());

        std::regex_constants::syntax_option_type basetype = result;

        for (int32_t idx = 1, e = HSVM_ArrayLength(*vm, opts); idx != e; ++idx)
        {
                std::string value = HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, opts, idx));
                bool negate = false;
                if (!value.empty() && (value[0] == '-' || value[0] == '!'))
                {
                        value.erase(0, 1);
                        negate = true;
                }

                std::regex_constants::syntax_option_type elt = std::regex_constants::ECMAScript;

                if ("icase" == value) // all types
                    elt = std::regex_constants::icase;
                else if ("optimize" == value) // all types
                    elt = std::regex_constants::optimize;
                else if (true /* FIXME basetype != std::regex_constants::literal */)
                {
                        if ("nosubs" == value)
                            elt = std::regex_constants::nosubs;
                        else if ("collate" == value)
                            elt = std::regex_constants::collate;
        //                else if ("newline_alt" == value)
        //                    elt = std::regex_constants::newline_alt;
                        else if ("no_except" == value)
                            (void)0;//FIXME elt = std::regex_constants::no_except;
                        else if ("save_subexpression_location" == value)
                            (void)0;//FIXME elt = std::regex_constants:: save_subexpression_location;
                        else if (basetype == std::regex_constants::ECMAScript) //FIXME was ::normal
                        {
                                if ("no_mod_m" == value)
                                    (void)0;//FIXME elt = std::regex_constants::no_mod_m;
                                else if ("no_mod_s" == value)
                                    (void)0;//FIXME elt = std::regex_constants::no_mod_s;
                                else if ("mod_s" == value)
                                    (void)0;//FIXME elt = std::regex_constants::mod_s;
                                else if ("mod_x" == value)
                                    (void)0;//FIXME elt = std::regex_constants::mod_x;
                                else if ("no_empty_expressions" == value)
                                    (void)0;//FIXME elt = std::regex_constants::no_empty_expressions;
                                else
                                    throw std::runtime_error(("Syntax option unknown or not allowed here: '" + value + "'").c_str());
                        }
                        else if ("no_escape_in_lists" == value)
                            (void)0;//FIXME elt = std::regex_constants::no_escape_in_lists;
                        else if (basetype == std::regex_constants::basic)
                        {
                                if ("no_char_classes" == value)
                                    (void)0;//FIXME elt = std::regex_constants::no_char_classes;
                                else if ("no_intervals" == value)
                                    (void)0;//FIXME elt = std::regex_constants::no_intervals;
                                else if ("bk_plus_qm" == value)
                                    (void)0;//FIXME elt = std::regex_constants::bk_plus_qm;
                                else if ("bk_vbar" == value)
                                    (void)0;//FIXME elt = std::regex_constants::bk_vbar;
                                else
                                    throw std::runtime_error(("Syntax option unknown or not allowed here: '" + value + "'").c_str());
                        }
//                        else if ("no_bk_refs" == value)
//                            elt = std::regex_constants::no_bk_refs;
                        else
                            throw std::runtime_error(("Syntax option unknown or not allowed here: '" + value + "'").c_str());
                }
                else
                    throw std::runtime_error(("Syntax option unknown or not allowed here: '" + value + "'").c_str());

                if (negate)
                    result = result & ~elt;
                else
                    result = result | elt;
        }

        return result;
/*
        std::regex_constants::syntax_option_type result = std::regex_constants::normal;

        for (int32_t idx = 0, e = HSVM_ArrayLength(*vm, opts); idx != e; ++idx)
        {
                std::regex_constants::syntax_option_type elt;

                std::string value = HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, opts, idx));
                Blex::ToLowercase(value.begin(), value.end());
                if ("normal" == value)
                    elt = std::regex_constants::normal;
                else if ("ecmascript" == value)
                    elt = std::regex_constants::ECMAScript;
                else if ("JavaScript" == value)
                    elt = std::regex_constants::JavaScript;
                else if ("JScript" == value)
                    elt = std::regex_constants::JScript;
                else if ("perl" == value)
                    elt = std::regex_constants::perl;
                else if ("basic" == value)
                    elt = std::regex_constants::basic;
                else if ("sed" == value)
                    elt = std::regex_constants::sed;
                else if ("extended" == value)
                    elt = std::regex_constants::extended;
                else if ("awk" == value)
                    elt = std::regex_constants::awk;
                else if ("grep" == value)
                    elt = std::regex_constants::grep;
                else if ("egrep" == value)
                    elt = std::regex_constants::egrep;
                else if ("icase" == value)
                    elt = std::regex_constants::icase;
                else if ("nosubs" == value)
                    elt = std::regex_constants::nosubs;
                else if ("optimize" == value)
                    elt = std::regex_constants::optimize;
                else if ("collate" == value)
                    elt = std::regex_constants::collate;
//                else if ("newline_alt" == value)
//                    elt = std::regex_constants::newline_alt;
                else if ("no_except" == value)
                    elt = std::regex_constants::no_except;
                else if ("save_subexpression_location" == value)
                    elt = std::regex_constants:: save_subexpression_location;
                else if ("no_mod_m" == value)
                    elt = std::regex_constants::no_mod_m;
                else if ("no_mod_s" == value)
                    elt = std::regex_constants::no_mod_s;
                else if ("mod_s" == value)
                    elt = std::regex_constants::mod_s;
                else if ("mod_x" == value)
                    elt = std::regex_constants::mod_x;
                else if ("no_empty_expressions" == value)
                    elt = std::regex_constants::no_empty_expressions;
//                else if ("no_bk_refs" == value)
//                    elt = std::regex_constants::no_bk_refs;
                else if ("no_escape_in_lists" == value)
                    elt = std::regex_constants::no_escape_in_lists;
                else if ("no_char_classes" == value)
                    elt = std::regex_constants::no_char_classes;
                else if ("no_intervals" == value)
                    elt = std::regex_constants::no_intervals;
                else if ("bk_plus_qm" == value)
                    elt = std::regex_constants::bk_plus_qm;
                else if ("bk_vbar" == value)
                    elt = std::regex_constants::bk_vbar;
                else
                    throw std::runtime_error(("Unrecognized syntax type '" + value + "'").c_str());

                if (idx == 0)
                    result = elt;
                else
                    result = result | elt;
        }
        return result;
*/
}

std::regex_constants::match_flag_type ParseMatchFlags(HSVM_VariableId opts, VirtualMachine *vm, bool allow_prev_avail)
{
        std::regex_constants::match_flag_type result = std::regex_constants::match_default;

        for (int32_t idx = 0, e = HSVM_ArrayLength(*vm, opts); idx != e; ++idx)
        {
                std::string value = HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, opts, idx));
                Blex::ToLowercase(value.begin(), value.end());

/*                if ("match_not_bob" == value)
                    result |= std::regex_constants::match_not_bob;
                else if ("match_not_eob" == value)
                    result |= std::regex_constants::match_not_eob;*/
                if ("match_not_bol" == value)
                    result |= std::regex_constants::match_not_bol;
                else if ("match_not_eol" == value)
                    result |= std::regex_constants::match_not_eol;
                else if ("match_not_bow" == value)
                    result |= std::regex_constants::match_not_bow;
                else if ("match_not_eow" == value)
                    result |= std::regex_constants::match_not_eow;
                else if ("match_any" == value)
                    result |= std::regex_constants::match_any;
                else if ("match_not_null" == value)
                    result |= std::regex_constants::match_not_null;
                else if ("match_continuous" == value)
                    result |= std::regex_constants::match_continuous;
                /*else if ("match_partial" == value)
                    result |= std::regex_constants::match_partial;
                else if ("match_single_line" == value)
                    result |= std::regex_constants::match_single_line;*/
                else if ("match_prev_avail" == value)
                {
                        result |= std::regex_constants::match_prev_avail;
                        if (!allow_prev_avail)
                            throw std::runtime_error("Match flag 'match_prev_avail' only allowed when using an offset");
                }
                else if ("match_not_dot_newline" == value)
                    (void)0; //FIXME result |= std::regex_constants::match_not_dot_newline;
                /*else if ("match_not_dot_null" == value)
                    result |= std::regex_constants::match_not_dot_null;
                else if ("match_posix" == value)
                    result |= std::regex_constants::match_posix;
                else if ("match_perl" == value)
                    result |= std::regex_constants::match_perl;
                else if ("match_nosubs" == value)
                    result |= std::regex_constants::match_nosubs;
                else if ("match_extra" == value)
                    result |= std::regex_constants::match_extra;*/
                else if ("format_default" == value)
                    result |= std::regex_constants::format_default;
                else if ("format_sed" == value)
                    result |= std::regex_constants::format_sed;
                /*else if ("format_perl" == value)
                    result |= std::regex_constants::format_perl;
                else if ("format_literal" == value)
                    result |= std::regex_constants::format_literal;
                else if ("format_no_copy" == value)
                    result |= std::regex_constants::format_no_copy;*/
                else if ("format_first_only" == value)
                    result |= std::regex_constants::format_first_only;
                /*else if ("format_all" == value)
                    result |= std::regex_constants::format_all;*/
                else
                    throw std::runtime_error(("Unrecognized match flag '" + value + "'").c_str());
        }
        return result;
}

namespace
{

std::regex & GetCachedRegex(VirtualMachine *vm, std::string const &regex_str, std::regex_constants::syntax_option_type syntax_option)
{
        RegexContext context(vm->GetContextKeeper());

        for (auto it = context->regex_cache.begin(); it != context->regex_cache.end(); ++it)
            if (it->regex_str == regex_str && it->syntax_option == syntax_option)
            {
                    // Move item to begin
                    context->regex_cache.splice(context->regex_cache.begin(), context->regex_cache, it);
                    return context->regex_cache.begin()->regex;
            }

        if (context->regex_cache.size() >= 256) // max 256 cached regexes
        {
                auto itr = context->regex_cache.end();
                context->regex_cache.erase(--itr);
        }

        auto insert_it = context->regex_cache.insert(context->regex_cache.begin(), RegexContextData::CachedRegex(regex_str, syntax_option));
        return insert_it->regex;
}

} // End of anonymous namespace

void RegExSearchOrMatch(HSVM_VariableId id_set, VirtualMachine *vm, bool is_match)
{
        try
        {
                std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
                int32_t offset = HSVM_IntegerGet(*vm, HSVM_Arg(1));
                if (offset < 0)
                    offset = 0;
                else if (offset > static_cast< int32_t >(data.size()))
                    offset = data.size();

                std::string regex_str = HSVM_StringGetSTD(*vm, HSVM_Arg(2));
                std::regex_constants::syntax_option_type syntax_option = ParseSyntaxOptions(HSVM_Arg(3), vm);
                std::regex_constants::match_flag_type match_flags = ParseMatchFlags(HSVM_Arg(4), vm, offset != 0);

                std::string::const_iterator start = data.begin() + offset, limit = data.end();

                std::regex &regex = GetCachedRegex(vm, regex_str, syntax_option);
                std::match_results< std::string::const_iterator > what;
                bool result = is_match
                    ? std::regex_match< std::string::const_iterator >(start, limit, what, regex, match_flags)
                    : std::regex_search< std::string::const_iterator >(start, limit, what, regex, match_flags);

                HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
                if (result)
                {
                        HSVM_VariableId matches = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "MATCHES"));
                        HSVM_SetDefault(*vm, matches, HSVM_VAR_RecordArray);

                        for (std::smatch::const_iterator it = what.begin(); it != what.end(); ++it)
                        {
                                HSVM_VariableId elt = HSVM_ArrayAppend(*vm, matches);

                                int32_t startpos = it->first == limit ? -1 : std::distance< std::string::const_iterator >(data.begin(), it->first);
                                int32_t len = std::distance(it->first, it->second);

                                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, elt, HSVM_GetColumnId(*vm, "MATCHED")), it->matched);
                                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, elt, HSVM_GetColumnId(*vm, "START")), startpos);
                                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, elt, HSVM_GetColumnId(*vm, "LEN")), len);
                                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, elt, HSVM_GetColumnId(*vm, "VALUE")), it->str());
                        }
                }
        }
        catch (const std::regex_error& e)
        {
                HandleRegexErrorMessage(vm, e);
        }
        catch (std::exception &e)
        {
                HSVM_ThrowException(*vm, e.what());
        }
}

void RegExMatch(HSVM_VariableId id_set, VirtualMachine *vm)
{
        RegExSearchOrMatch(id_set, vm, true);
}

void RegExSearch(HSVM_VariableId id_set, VirtualMachine *vm)
{
        RegExSearchOrMatch(id_set, vm, false);
}

void RegExReplace(HSVM_VariableId id_set, VirtualMachine *vm)
{
        try
        {
                std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
                int32_t offset = HSVM_IntegerGet(*vm, HSVM_Arg(1));
                if (offset < 0)
                    offset = 0;
                else if (offset > static_cast< int32_t >(data.size()))
                    offset = data.size();

                std::string regex_str = HSVM_StringGetSTD(*vm, HSVM_Arg(2));
                std::string format = HSVM_StringGetSTD(*vm, HSVM_Arg(3));
                std::regex_constants::syntax_option_type syntax_option = ParseSyntaxOptions(HSVM_Arg(4), vm);
                std::regex_constants::match_flag_type match_flags = ParseMatchFlags(HSVM_Arg(5), vm, offset != 0);

                std::string::const_iterator start = data.begin() + offset, limit = data.end();

                std::string result;
                if (offset && (match_flags & std::regex_constants::format_no_copy) != 0)
                    result.assign< std::string::const_iterator >(data.begin(), start);

                std::regex &regex = GetCachedRegex(vm, regex_str, syntax_option);
                std::regex_replace(std::back_inserter(result), start, limit, regex, format, match_flags);

                HSVM_StringSetSTD(*vm, id_set, result);
        }
        catch (const std::regex_error& e)
        {
                HandleRegexErrorMessage(vm, e);
        }
        catch (std::exception &e)
        {
                HSVM_ThrowException(*vm, e.what());
        }
}

void RegExReplaceCallback(HSVM_VariableId id_set, VirtualMachine *vm)
{
        try
        {
                std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
                int32_t offset = HSVM_IntegerGet(*vm, HSVM_Arg(1));
                if (offset < 0)
                    offset = 0;
                else if (offset > static_cast< int32_t >(data.size()))
                    offset = data.size();

                std::string regex_str = HSVM_StringGetSTD(*vm, HSVM_Arg(2));
                HSVM_VariableId callback = HSVM_Arg(3);
                std::regex_constants::syntax_option_type syntax_option = ParseSyntaxOptions(HSVM_Arg(4), vm);
                std::regex_constants::match_flag_type match_flags = ParseMatchFlags(HSVM_Arg(5), vm, offset != 0);

                std::string::const_iterator start = data.begin() + offset, limit = data.end();

                std::string result;
                if (offset && (match_flags & std::regex_constants::format_no_copy) != 0)
                    result.assign< std::string::const_iterator >(data.begin(), start);

                std::regex &regex = GetCachedRegex(vm, regex_str, syntax_option);
                std::regex_iterator<std::string::const_iterator> a(start, limit, regex, match_flags), b;
                std::string::const_iterator last_end = start;
                while (a != b)
                {
                        // Append the string up to this match
                        result.append(a->prefix());

                        if (HSVM_FunctionPtrExists(*vm, callback))
                        {
                                int32_t matchpos = std::distance< std::string::const_iterator >(data.begin(), (*a)[0].first);

                                HSVM_OpenFunctionCall(*vm, 4);
                                HSVM_SetDefault(*vm, HSVM_CallParam(*vm, 1), HSVM_VAR_StringArray);
                                HSVM_IntegerSet(*vm, HSVM_CallParam(*vm, 2), matchpos);
                                HSVM_StringSetSTD(*vm, HSVM_CallParam(*vm, 3), data);

                                // Add match as first parameter and submatches as second parameter elements
                                for (std::smatch::const_iterator it = a->begin(); it != a->end(); ++it)
                                {
                                        if (it == a->begin())
                                            HSVM_StringSetSTD(*vm, HSVM_CallParam(*vm, 0), it->str());
                                        else
                                            HSVM_StringSetSTD(*vm, HSVM_ArrayAppend(*vm, HSVM_CallParam(*vm, 1)), it->str());
                                }

                                // Call the callback, append the resulting string
                                HSVM_VariableId replaced = HSVM_CallFunctionPtr(*vm, callback, true);

                                // If we have a result, append it, otherwise check if we should abort
                                if (replaced && HSVM_GetType(*vm, replaced) == HSVM_VAR_String)
                                    result.append(HSVM_StringGetSTD(*vm, replaced));
                                else if (HSVM_TestMustAbort(*vm))
                                    return;
                                else
                                    result.append(a->str()); // Not replaced (callback was a macro), append original text

                                HSVM_CloseFunctionCall(*vm);
                        }
                        last_end = (*a)[0].second;
                        ++a;

                        // If not replacing globally, we're done
                        if ((match_flags & std::regex_constants::format_first_only) != 0)
                            break;
                }

                // Append remaining data
                result.append(last_end, limit);

                HSVM_StringSetSTD(*vm, id_set, result);
        }
        catch (const std::regex_error& e)
        {
                HandleRegexErrorMessage(vm, e);
        }
        catch (std::exception &e)
        {
                HSVM_ThrowException(*vm, e.what());
        }
}

void InitRegex(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg)
{
        RegexContext::Register(creg);

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGEX_MATCH::R:SISSASA", RegExMatch));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGEX_SEARCH::R:SISSASA", RegExSearch));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGEX_REPLACE::S:SISSSASA", RegExReplace));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGEX_REPLACE_CALLBACK::S:SISPSASA", RegExReplaceCallback));
}

} // End of namespace Baselibs
} // End of namespace HareScript

