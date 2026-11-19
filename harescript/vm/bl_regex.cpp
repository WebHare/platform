#include <harescript/vm/allincludes.h>

#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hs_lexer.h>
#include <harescript/vm/hsvm_context.h>

#define PCRE2_CODE_UNIT_WIDTH 8
#include <pcre2.h>

#if PCRE2_MAJOR < 10 || (PCRE2_MAJOR == 10 && PCRE2_MINOR < 43)
#error PCRE2 10.43 or newer is required
#endif

/* Regular expressions closely following ECMAScript, implemented using PCRE2. These builtins are used by
   wh::regex.whlib. The WASM engine implements the same builtins using JavaScript's RegExp (see
   jssdk/harescript/src/wasm-regex.ts), so the semantics of both implementations must match that of JavaScript.

   ECMAScript patterns are translated to PCRE2 patterns (see PatternTranslator), so constructs that have a different
   meaning in PCRE2 (eg \v, \s, ".", "[[:alpha:]]", \Q, \A) get their ECMAScript meaning, and constructs that are invalid
   in ECMAScript are rejected.

   All positions are UTF-8 byte offsets.
*/

namespace HareScript
{
namespace Baselibs
{

namespace
{

struct RegexFlags
{
        bool global = false;
        bool ignorecase = false;
        bool multiline = false;
        bool unicode = false;
};

struct PCRE2CodeDeleter
{
        void operator()(pcre2_code *code) const { pcre2_code_free(code); }
};
struct PCRE2MatchDataDeleter
{
        void operator()(pcre2_match_data *data) const { pcre2_match_data_free(data); }
};
struct PCRE2CompileContextDeleter
{
        void operator()(pcre2_compile_context *ctx) const { pcre2_compile_context_free(ctx); }
};

typedef std::unique_ptr< pcre2_code, PCRE2CodeDeleter > PCRE2CodePtr;
typedef std::unique_ptr< pcre2_match_data, PCRE2MatchDataDeleter > PCRE2MatchDataPtr;

class RegexError : public std::runtime_error
{
    public:
        RegexError(std::string const &pattern, std::string const &flags, std::string const &msg)
        : std::runtime_error("Invalid regular expression: /" + pattern + "/" + flags + ": " + msg)
        {
        }
};

} // End of anonymous namespace

struct RegexContextData
{
        struct CachedRegex
        {
                std::string pattern;
                std::string flags;
                RegexFlags parsedflags;
                PCRE2CodePtr code;
        };

        typedef std::list< CachedRegex > RegexCache;
        RegexCache regex_cache;
};

const int RegexContextId = 22;
typedef Blex::Context< RegexContextData, RegexContextId, void> RegexContext;

namespace
{

RegexFlags ParseFlags(std::string const &flags)
{
        RegexFlags result;
        for (std::size_t i = 0; i < flags.size(); ++i)
        {
                char flag = flags[i];
                if (flags.find(flag, i + 1) != std::string::npos)
                    throw std::runtime_error("Invalid regular expression flags '" + flags + "': flag '" + std::string(1, flag) + "' is specified more than once");

                switch (flag)
                {
                case 'g': result.global = true; break;
                case 'i': result.ignorecase = true; break;
                case 'm': result.multiline = true; break;
                case 'u': result.unicode = true; break;
                default:  throw std::runtime_error("Invalid regular expression flags '" + flags + "': flag '" + std::string(1, flag) + "' is not allowed");
                }
        }
        return result;
}

std::string CodePointEscape(uint32_t codepoint)
{
        char buf[16];
        snprintf(buf, sizeof(buf), "\\x{%x}", codepoint);
        return buf;
}

// ECMAScript WhiteSpace and LineTerminator characters (the definition of \s), without surrounding brackets
const char *const ECMAScriptWhitespace = "\\t\\n\\x{0B}\\f\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}";

/** Returns whether a character is the letter of a class escape (\d, \s, \w and their negations) */
bool IsClassEscapeLetter(char c)
{
        return c && strchr("dDsSwW", c);
}

/** Translates ECMAScript patterns to PCRE2 patterns */
class PatternTranslator
{
    public:
        PatternTranslator(std::string const &pattern, std::string const &flags, RegexFlags const &parsedflags)
        : pattern(pattern)
        , flags(flags)
        , unicode(parsedflags.unicode)
        {
        }

        std::string Translate();

    private:
        [[noreturn]] void Fail(std::string const &msg) { throw RegexError(pattern, flags, msg); }

        bool ParseHexDigits(std::size_t count, uint32_t *value);
        bool ParseQuantifierBraces(std::size_t *end);
        uint32_t ParseUnicodeEscapeValue(bool *valid);
        void TranslateLegacyOctalEscape();
        void TranslateEscape(bool inclass);
        bool TranslateClassAtom();
        void TranslateClass();
        void TranslateGroupOpen();
        void CheckAfterQuantifier();

        std::string const &pattern;
        std::string const &flags;
        bool unicode;
        unsigned numgroups = 0; // number of capture groups in the pattern
        std::size_t pos = 0;
        std::string out;
};

bool PatternTranslator::ParseHexDigits(std::size_t count, uint32_t *value)
{
        if (pos + count > pattern.size())
            return false;
        uint32_t result = 0;
        for (std::size_t i = 0; i < count; ++i)
        {
                char c = pattern[pos + i];
                if (!Blex::IsHexDigit(c))
                    return false;
                result = result * 16 + (Blex::IsDigit(c) ? c - '0' : (c | 0x20) - 'a' + 10);
        }
        pos += count;
        *value = result;
        return true;
}

/** Parses a \u escape (pos is just after the 'u'). Combines surrogate pairs. Returns the codepoint, sets valid to false
    if this isn't a valid escape (pos is not moved in that case)
*/
uint32_t PatternTranslator::ParseUnicodeEscapeValue(bool *valid)
{
        *valid = true;
        if (unicode && pos < pattern.size() && pattern[pos] == '{')
        {
                std::size_t end = pattern.find('}', pos + 1);
                if (end != std::string::npos && end > pos + 1)
                {
                        uint64_t value = 0;
                        bool ok = true;
                        for (std::size_t i = pos + 1; i < end && ok; ++i)
                        {
                                ok = Blex::IsHexDigit(pattern[i]);
                                value = value * 16 + (Blex::IsDigit(pattern[i]) ? pattern[i] - '0' : (pattern[i] | 0x20) - 'a' + 10);
                                if (value > 0x10FFFF)
                                    ok = false;
                        }
                        if (ok)
                        {
                                pos = end + 1;
                                return static_cast< uint32_t >(value);
                        }
                }
                *valid = false;
                return 0;
        }

        uint32_t value;
        *valid = ParseHexDigits(4, &value);
        if (!*valid)
            return 0;

        // Combine surrogate pairs (in UTF-8 these can only be matched as a single codepoint)
        if (value >= 0xD800 && value <= 0xDBFF && pos + 6 <= pattern.size() && pattern[pos] == '\\' && pattern[pos + 1] == 'u')
        {
                std::size_t save = pos;
                pos += 2;
                uint32_t low;
                if (ParseHexDigits(4, &low) && low >= 0xDC00 && low <= 0xDFFF)
                    return 0x10000 + ((value - 0xD800) << 10) + (low - 0xDC00);
                pos = save;
        }
        return value;
}

/** Parses a {n}, {n,} or {n,m} quantifier at pos. Returns whether it is one, and its end position */
bool PatternTranslator::ParseQuantifierBraces(std::size_t *end)
{
        std::size_t i = pos + 1;
        std::size_t digitstart = i;
        while (i < pattern.size() && Blex::IsDigit(pattern[i]))
            ++i;
        if (i == digitstart || i >= pattern.size())
            return false;
        if (pattern[i] == ',')
        {
                ++i;
                while (i < pattern.size() && Blex::IsDigit(pattern[i]))
                    ++i;
        }
        if (i >= pattern.size() || pattern[i] != '}')
            return false;
        *end = i + 1;
        return true;
}

/** Rejects a '+' directly after a quantifier (a PCRE2 possessive quantifier), allows a lazy '?' */
void PatternTranslator::CheckAfterQuantifier()
{
        if (pos < pattern.size() && pattern[pos] == '?')
        {
                out += '?';
                ++pos;
        }
        if (pos < pattern.size() && (pattern[pos] == '+' || pattern[pos] == '*' || pattern[pos] == '?' || pattern[pos] == '{'))
        {
                std::size_t end;
                if (pattern[pos] != '{' || ParseQuantifierBraces(&end))
                    Fail("Nothing to repeat");
        }
}

/** Translates an Annex B legacy octal escape (pos is just after the first digit): up to 3 digits if the first digit is
    0-3, up to 2 otherwise
*/
void PatternTranslator::TranslateLegacyOctalEscape()
{
        std::size_t start = pos - 1;
        std::size_t maxend = start + (pattern[start] <= '3' ? 3 : 2);
        uint32_t value = 0;
        for (pos = start; pos < maxend && pos < pattern.size() && pattern[pos] >= '0' && pattern[pos] <= '7'; ++pos)
            value = value * 8 + (pattern[pos] - '0');
        out += CodePointEscape(value);
}

void PatternTranslator::TranslateEscape(bool inclass)
{
        // pos is at the backslash
        if (pos + 1 >= pattern.size())
            Fail("\\ at end of pattern");

        char c = pattern[pos + 1];
        pos += 2;

        switch (c)
        {
        // Escapes with the same meaning in PCRE2
        case 'd': case 'D': case 'w': case 'W': case 't': case 'n': case 'r': case 'f':
            out += '\\';
            out += c;
            return;

        case 'b':
            out += inclass ? "\\x{8}" : "\\b";
            return;
        case 'B':
            if (inclass && unicode)
                Fail("Invalid class escape");
            out += inclass ? "B" : "\\B";
            return;

        case 'v': // vertical tab in ECMAScript, vertical whitespace in PCRE2
            out += "\\x{B}";
            return;

        case 's':
            if (inclass)
                out += ECMAScriptWhitespace;
            else
            {
                    out += '[';
                    out += ECMAScriptWhitespace;
                    out += ']';
            }
            return;
        case 'S':
            if (inclass)
                out += "\\S"; // FIXME: PCRE2's \S doesn't consider the non-ASCII ECMAScript whitespace characters as whitespace
            else
            {
                    out += "[^";
                    out += ECMAScriptWhitespace;
                    out += ']';
            }
            return;

        case 'c':
            // Annex B also allows \c0-\c9 and \c_ in classes
            if (pos < pattern.size() && (Blex::IsAlpha(pattern[pos]) || (inclass && !unicode && (Blex::IsDigit(pattern[pos]) || pattern[pos] == '_'))))
            {
                    out += CodePointEscape(pattern[pos] % 32);
                    ++pos;
                    return;
            }
            if (unicode)
                Fail("Invalid unicode escape");
            out += "\\\\c"; // Annex B: a literal backslash followed by 'c'
            return;

        case 'x':
        {
                uint32_t value;
                if (ParseHexDigits(2, &value))
                {
                        out += CodePointEscape(value);
                        return;
                }
                if (unicode)
                    Fail("Invalid escape");
                out += 'x';
                return;
        }

        case 'u':
        {
                bool valid;
                uint32_t value = ParseUnicodeEscapeValue(&valid);
                if (!valid)
                {
                        if (unicode)
                            Fail("Invalid Unicode escape");
                        out += 'u';
                        return;
                }
                out += CodePointEscape(value); // Lone surrogates are allowed (PCRE2_EXTRA_ALLOW_SURROGATE_ESCAPES) but never match
                return;
        }

        case 'p': case 'P':
            if (unicode)
            {
                    if (pos >= pattern.size() || pattern[pos] != '{')
                        Fail("Invalid property name");
                    std::size_t end = pattern.find('}', pos);
                    if (end == std::string::npos)
                        Fail("Invalid property name");
                    out += '\\';
                    out += c;
                    out.append(pattern, pos, end + 1 - pos);
                    pos = end + 1;
            }
            else
                out += c;
            return;

        case '0':
            if (pos >= pattern.size() || !Blex::IsDigit(pattern[pos]))
            {
                    out += "\\x{0}";
                    return;
            }
            if (unicode)
                Fail("Invalid decimal escape");
            TranslateLegacyOctalEscape();
            return;

        case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
        {
                if (inclass && unicode)
                    Fail("Invalid class escape");

                std::size_t end = pos;
                while (end < pattern.size() && Blex::IsDigit(pattern[end]))
                    ++end;
                // A backreference if the group exists (in unicode mode PCRE2 reports a missing group)
                if (!inclass && (unicode || std::stoul(pattern.substr(pos - 1, std::min< std::size_t >(end - pos + 1, 9))) <= numgroups))
                {
                        out += "\\g{";
                        out.append(pattern, pos - 1, end - pos + 1);
                        out += '}';
                        pos = end;
                        return;
                }
                if (c >= '8') // Annex B identity escape
                    out += c;
                else
                    TranslateLegacyOctalEscape();
                return;
        }

        case '-':
            if (unicode && !inclass)
                Fail("Invalid escape");
            out += "\\-";
            return;
        }

        if (static_cast< unsigned char >(c) >= 0x80 || Blex::IsAlpha(c) || c == '_')
        {
                // Annex B identity escape, not allowed in unicode mode. Emit the literal character (as PCRE2 might assign
                // a special meaning to escaped letters, eg \A, \Q, \h)
                if (unicode)
                    Fail("Invalid escape");
                out += c;
                return;
        }

        // Escaped syntax/punctuation character
        if (unicode && !strchr("^$\\.*+?()[]{}|/", c))
            Fail("Invalid escape");
        out += '\\';
        out += c;
}

bool PatternTranslator::TranslateClassAtom()
{
        if (pos >= pattern.size())
            Fail("Unterminated character class");

        char c = pattern[pos];
        if (c == '\\')
        {
                char escaped = pos + 1 < pattern.size() ? pattern[pos + 1] : 0;
                TranslateEscape(true);
                return IsClassEscapeLetter(escaped) || (unicode && (escaped == 'p' || escaped == 'P'));
        }

        if (c == '[') // Not a POSIX class in ECMAScript
            out += "\\[";
        else if (c == '-') // A literal '-' (a range operator is added by TranslateClass)
            out += "\\-";
        else
        {
                out += c;
                while (pos + 1 < pattern.size() && (static_cast< unsigned char >(pattern[pos + 1]) & 0xC0) == 0x80) // UTF-8 continuation bytes
                    out += pattern[++pos];
        }
        ++pos;
        return false;
}

void PatternTranslator::TranslateClass()
{
        // pos is at the '['
        ++pos;
        out += '[';
        if (pos < pattern.size() && pattern[pos] == '^')
        {
                out += '^';
                ++pos;
        }

        // An ECMAScript class is closed by the first unescaped ']' (so '[]' and '[^]' are valid, handled by
        // PCRE2_ALLOW_EMPTY_CLASS). Its contents are atoms and ranges of two atoms, a '-' that is not part of a range is
        // an atom itself (eg at the start or end of the class, or directly after a range).
        while (pos >= pattern.size() || pattern[pos] != ']')
        {
                bool startisclassescape = TranslateClassAtom();
                if (pos + 1 < pattern.size() && pattern[pos] == '-' && pattern[pos + 1] != ']')
                {
                        ++pos;
                        std::size_t rangeoperatorpos = out.size();
                        out += '-';
                        bool endisclassescape = TranslateClassAtom();
                        // A class escape (eg \w, or \s which is expanded) can't be the start or end of a range. Without
                        // 'u' the '-' is a literal (Annex B)
                        if (startisclassescape || endisclassescape)
                        {
                                if (unicode)
                                    Fail("Invalid character class");
                                out.insert(rangeoperatorpos, 1, '\\');
                        }
                }
        }
        out += ']';
        ++pos;
}

void PatternTranslator::TranslateGroupOpen()
{
        // pos is at the '('
        if (pos + 1 < pattern.size() && pattern[pos + 1] == '*')
            Fail("Nothing to repeat");
        if (pos + 1 >= pattern.size() || pattern[pos + 1] != '?')
        {
                out += '(';
                ++pos;
                return;
        }

        char c = pos + 2 < pattern.size() ? pattern[pos + 2] : 0;
        if (c == ':' || c == '=' || c == '!')
        {
                out.append(pattern, pos, 3);
                pos += 3;
                return;
        }
        // Not supported: lookbehind assertions, named groups and modifiers. PCRE-only groups are invalid in ECMAScript
        if (c == '<')
            Fail(pos + 3 < pattern.size() && (pattern[pos + 3] == '=' || pattern[pos + 3] == '!') ? "Lookbehind assertions are not supported" : "Named capture groups are not supported");
        if (c == 'i' || c == 'm' || c == 's' || c == '-')
            Fail("Modifiers are not supported");
        Fail("Invalid group");
}

std::string PatternTranslator::Translate()
{
        out.reserve(pattern.size() + 16);

        // Count the capture groups, needed to decide whether \N is a backreference or a legacy octal escape
        bool inclass = false;
        for (std::size_t i = 0; i < pattern.size(); ++i)
        {
                if (pattern[i] == '\\')
                    ++i;
                else if (inclass)
                    inclass = pattern[i] != ']';
                else if (pattern[i] == '[')
                    inclass = true;
                else if (pattern[i] == '(' && (i + 1 >= pattern.size() || pattern[i + 1] != '?'))
                    ++numgroups;
        }

        while (pos < pattern.size())
        {
                char c = pattern[pos];
                switch (c)
                {
                case '\\':
                    TranslateEscape(false);
                    break;
                case '[':
                    TranslateClass();
                    break;
                case '(':
                    TranslateGroupOpen();
                    break;
                case '.':
                    out += "[^\\n\\r\\x{2028}\\x{2029}]";
                    ++pos;
                    break;
                case '*': case '+': case '?':
                    out += c;
                    ++pos;
                    CheckAfterQuantifier();
                    break;
                case '{':
                {
                        std::size_t end;
                        if (ParseQuantifierBraces(&end))
                        {
                                out.append(pattern, pos, end - pos);
                                pos = end;
                                CheckAfterQuantifier();
                        }
                        else
                        {
                                if (unicode)
                                    Fail("Lone quantifier brackets");
                                out += "\\{"; // Annex B: literal '{' (and PCRE2 might see a quantifier, eg '{,5}')
                                ++pos;
                        }
                } break;
                case '}': case ']':
                    if (unicode)
                        Fail("Lone quantifier brackets");
                    out += '\\';
                    out += c;
                    ++pos;
                    break;
                default:
                    out += c;
                    ++pos;
                }
        }
        return out;
}

RegexContextData::CachedRegex const & GetCachedRegex(VirtualMachine *vm, std::string const &pattern, std::string const &flags)
{
        RegexContext context(vm->GetContextKeeper());

        for (auto it = context->regex_cache.begin(); it != context->regex_cache.end(); ++it)
            if (it->pattern == pattern && it->flags == flags)
            {
                    // Move item to begin
                    context->regex_cache.splice(context->regex_cache.begin(), context->regex_cache, it);
                    return context->regex_cache.front();
            }

        RegexContextData::CachedRegex entry;
        entry.pattern = pattern;
        entry.flags = flags;
        entry.parsedflags = ParseFlags(flags);

        PatternTranslator translator(pattern, flags, entry.parsedflags);
        std::string translated = translator.Translate();

        uint32_t options = PCRE2_UTF | PCRE2_MATCH_INVALID_UTF | PCRE2_DOLLAR_ENDONLY | PCRE2_MATCH_UNSET_BACKREF
                | PCRE2_ALLOW_EMPTY_CLASS;
        // Case folding is always done like ECMAScript in 'u' mode (so eg U+017F LATIN SMALL LETTER LONG S matches 's'), as
        // the WASM engine also always uses 'u' mode
        if (entry.parsedflags.ignorecase)
            options |= PCRE2_CASELESS;
        if (entry.parsedflags.multiline) // ALT_CIRCUMFLEX: '^' also matches after a newline at the end of the input
            options |= PCRE2_MULTILINE | PCRE2_ALT_CIRCUMFLEX;

        std::unique_ptr< pcre2_compile_context, PCRE2CompileContextDeleter > ccontext(pcre2_compile_context_create(nullptr));
        if (!ccontext)
            throw std::bad_alloc();
        pcre2_set_newline(ccontext.get(), PCRE2_NEWLINE_ANYCRLF);
        // Allow lone surrogates (eg \uD800) like ECMAScript. They can't occur in the (UTF-8) input, but can be part of ranges
        pcre2_set_compile_extra_options(ccontext.get(), PCRE2_EXTRA_ALLOW_SURROGATE_ESCAPES);

        int errorcode;
        PCRE2_SIZE erroroffset;
        entry.code.reset(pcre2_compile(reinterpret_cast< PCRE2_SPTR >(translated.data()), translated.size(), options, &errorcode, &erroroffset, ccontext.get()));
        if (!entry.code)
        {
                PCRE2_UCHAR buffer[256];
                pcre2_get_error_message(errorcode, buffer, sizeof(buffer));
                throw RegexError(pattern, flags, reinterpret_cast< char const * >(buffer));
        }

        if (context->regex_cache.size() >= 256) // max 256 cached regexes
            context->regex_cache.pop_back();

        context->regex_cache.push_front(std::move(entry));
        return context->regex_cache.front();
}

/** Returns the number of bytes of the UTF-8 character starting at a specific position */
std::size_t UTF8CharLength(std::string const &data, std::size_t pos)
{
        unsigned char lead = data[pos];
        return lead < 0xC0 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
}

/** Executes the regex at a specific position (like RegExpBuiltinExec, pos is lastIndex). Returns whether a match was found */
bool ExecAt(RegexContextData::CachedRegex const &regex, std::string const &data, std::size_t pos, pcre2_match_data *matchdata)
{
        if (pos > data.size())
            return false;

        // Don't start in the middle of a UTF-8 character
        while (pos < data.size() && (static_cast< unsigned char >(data[pos]) & 0xC0) == 0x80)
            ++pos;

        int rc = pcre2_match(regex.code.get(), reinterpret_cast< PCRE2_SPTR >(data.data()), data.size(), pos, 0, matchdata, nullptr);
        if (rc == PCRE2_ERROR_NOMATCH)
            return false;
        if (rc < 0)
        {
                PCRE2_UCHAR buffer[256];
                pcre2_get_error_message(rc, buffer, sizeof(buffer));
                throw std::runtime_error(std::string("Regular expression match failed: ") + reinterpret_cast< char const * >(buffer));
        }
        return true;
}

PCRE2MatchDataPtr CreateMatchData(RegexContextData::CachedRegex const &regex)
{
        PCRE2MatchDataPtr matchdata(pcre2_match_data_create_from_pattern(regex.code.get(), nullptr));
        if (!matchdata)
            throw std::bad_alloc();
        return matchdata;
}

/** Appends the replacement for a match, implementing ECMAScript's GetSubstitution */
void ExpandReplacement(std::string *result, RegexContextData::CachedRegex const &regex, std::string const &data, pcre2_match_data *matchdata, std::string const &replacement)
{
        PCRE2_SIZE *ovector = pcre2_get_ovector_pointer(matchdata);
        uint32_t capturecount = 0;
        pcre2_pattern_info(regex.code.get(), PCRE2_INFO_CAPTURECOUNT, &capturecount);

        auto appendgroup = [&](uint32_t idx)
        {
                if (ovector[2 * idx] != PCRE2_UNSET)
                    result->append(data, ovector[2 * idx], ovector[2 * idx + 1] - ovector[2 * idx]);
        };

        for (std::size_t i = 0; i < replacement.size(); ++i)
        {
                char c = replacement[i];
                if (c != '$' || i + 1 >= replacement.size())
                {
                        *result += c;
                        continue;
                }

                char next = replacement[i + 1];
                if (next == '$')
                {
                        *result += '$';
                        ++i;
                }
                else if (next == '&')
                {
                        appendgroup(0);
                        ++i;
                }
                else if (next == '`')
                {
                        result->append(data, 0, ovector[0]);
                        ++i;
                }
                else if (next == '\'')
                {
                        if (ovector[1] < data.size())
                            result->append(data, ovector[1], std::string::npos);
                        ++i;
                }
                else if (Blex::IsDigit(next))
                {
                        uint32_t idx = next - '0';
                        std::size_t digits = 1;
                        if (i + 2 < replacement.size() && Blex::IsDigit(replacement[i + 2]))
                        {
                                uint32_t idx2 = idx * 10 + (replacement[i + 2] - '0');
                                if (idx2 >= 1 && idx2 <= capturecount)
                                {
                                        idx = idx2;
                                        digits = 2;
                                }
                        }
                        if (idx >= 1 && idx <= capturecount)
                        {
                                appendgroup(idx);
                                i += digits;
                        }
                        else
                            *result += '$';
                }
                else
                    *result += '$';
        }
}

} // End of anonymous namespace

void RegExExec(HSVM_VariableId id_set, VirtualMachine *vm)
{
        try
        {
                std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
                int32_t lastindex = HSVM_IntegerGet(*vm, HSVM_Arg(1));
                std::string pattern = HSVM_StringGetSTD(*vm, HSVM_Arg(2));
                std::string flags = HSVM_StringGetSTD(*vm, HSVM_Arg(3));

                RegexContextData::CachedRegex const &regex = GetCachedRegex(vm, pattern, flags);
                std::size_t startpos = regex.parsedflags.global ? std::max< int32_t >(lastindex, 0) : 0;

                PCRE2MatchDataPtr matchdata = CreateMatchData(regex);
                HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
                if (!ExecAt(regex, data, startpos, matchdata.get()))
                    return;

                uint32_t capturecount = 0;
                pcre2_pattern_info(regex.code.get(), PCRE2_INFO_CAPTURECOUNT, &capturecount);
                PCRE2_SIZE *ovector = pcre2_get_ovector_pointer(matchdata.get());

                HSVM_VariableId matches = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "MATCHES"));
                HSVM_SetDefault(*vm, matches, HSVM_VAR_RecordArray);

                HSVM_ColumnId col_matched = HSVM_GetColumnId(*vm, "MATCHED");
                HSVM_ColumnId col_start = HSVM_GetColumnId(*vm, "START");
                HSVM_ColumnId col_len = HSVM_GetColumnId(*vm, "LEN");
                HSVM_ColumnId col_value = HSVM_GetColumnId(*vm, "VALUE");

                for (uint32_t idx = 0; idx <= capturecount; ++idx)
                {
                        HSVM_VariableId elt = HSVM_ArrayAppend(*vm, matches);
                        bool matched = ovector[2 * idx] != PCRE2_UNSET;
                        PCRE2_SIZE start = ovector[2 * idx], end = ovector[2 * idx + 1];

                        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, elt, col_matched), matched);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, elt, col_start), matched ? static_cast< int32_t >(start) : -1);
                        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, elt, col_len), matched ? static_cast< int32_t >(end - start) : 0);
                        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, elt, col_value), matched ? data.substr(start, end - start) : std::string());
                }
        }
        catch (std::exception &e)
        {
                HSVM_ThrowException(*vm, e.what());
        }
}

void RegExReplace(HSVM_VariableId id_set, VirtualMachine *vm)
{
        try
        {
                std::string data = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
                std::string pattern = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
                std::string flags = HSVM_StringGetSTD(*vm, HSVM_Arg(2));
                std::string replacement = HSVM_StringGetSTD(*vm, HSVM_Arg(3));

                RegexContextData::CachedRegex const &regex = GetCachedRegex(vm, pattern, flags);
                PCRE2MatchDataPtr matchdata = CreateMatchData(regex);
                PCRE2_SIZE *ovector = pcre2_get_ovector_pointer(matchdata.get());

                std::size_t pos = 0;

                std::string result;
                std::size_t copiedupto = 0;
                while (ExecAt(regex, data, pos, matchdata.get()))
                {
                        std::size_t matchstart = ovector[0], matchend = ovector[1];
                        result.append(data, copiedupto, matchstart - copiedupto);
                        ExpandReplacement(&result, regex, data, matchdata.get(), replacement);
                        copiedupto = matchend;

                        if (!regex.parsedflags.global)
                            break;

                        pos = matchend;
                        if (matchstart == matchend) // Advance past empty matches
                        {
                                if (pos >= data.size())
                                    break;
                                pos += UTF8CharLength(data, pos);
                        }
                }
                if (copiedupto < data.size())
                    result.append(data, copiedupto, std::string::npos);

                HSVM_StringSetSTD(*vm, id_set, result);
        }
        catch (std::exception &e)
        {
                HSVM_ThrowException(*vm, e.what());
        }
}

void InitRegex(Blex::ContextRegistrator &creg, BuiltinFunctionsRegistrator &bifreg)
{
        RegexContext::Register(creg);

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGEX_EXEC::R:SISS", RegExExec));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGEX_REPLACE::S:SSSS", RegExReplace));
}

} // End of namespace Baselibs
} // End of namespace HareScript
