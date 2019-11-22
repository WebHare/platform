#ifndef blex_webhare_compiler_debugprints
#define blex_webhare_compiler_debugprints
//---------------------------------------------------------------------------

#include "il.h"
#include "ilgenerator.h"
#include "codegenerator.h"
#include "symboltable.h"
#include "../vm/hsvm_constants.h"

/** This file contains numerous printing functions, for use in debugging etc.
    It also defines templated printers for sets, maps, and vectors.

    Current printing abilities: (A and B are template classes)

    IL::Constant
    IL::Variable
    IL::Variable *
    IL::SSAVariable
    IL::SSAVariable *
    IL::AssignSSAVariable
    IL::AssignSSAVariable *

    Code::Instruction
    IL::ILInstruction
    IL::Block

    ILGenerator::ILFlowState
    ILGenerator::LoopStackElement
    CodeGenerator::CodeBlock

    Symbol
    Symbol *

    LineColumn

    std::set<A>
    std::vector<A>
    std::pair<A, B>
    std::map<A, B>

    composites:
    Iterator range: MakeRange(A begin, A end)

    */

namespace Debug
{

template <class S, class Itr>
 void StreamRange(S &ostr, Itr begin, Itr end)
{
        bool first=true;
        ostr << "{";
        for (Itr it = begin; it != end; ++it)
        {
                if (first)
                    first=false;
                else
                    ostr << ", ";

                ostr << *it;
        }
        ostr << "}";
}

template <class S, class Container>
 void StreamContainer(S &ostr, Container const &data)
{
        StreamRange(ostr,data.begin(),data.end());
}

} //end namespace Debug


namespace HareScript
{
namespace Compiler
{

struct VariableWrapper
{
        inline VariableWrapper(CompilerContext &_context, VarId _var) : context(_context), var(_var) {}
        CompilerContext &context;
        VarId var;
};

inline VariableWrapper WrapVar(CompilerContext &context, VarId var) { return VariableWrapper(context, var); }

template <class Iterator>
 struct PrintableRange
{
        Iterator begin;
        Iterator end;
        PrintableRange(Iterator _begin, Iterator _end) : begin(_begin), end(_end) {}

};
template <class Iterator>
 PrintableRange<Iterator> MakeRange(Iterator a, Iterator b) { return PrintableRange<Iterator>(a, b); }
template <class Container>
 struct PrintWithNLWrapper
{
        PrintWithNLWrapper(Container const &_container) : container(_container) {}
        Container const & container;
};
template <class Container>
 PrintWithNLWrapper<Container> PrintWithNL(Container const &container)
{
        return PrintWithNLWrapper<Container>(container);
}

// Declarations first (need to be visible in a template definition if it is to be used at instantiation)
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintableRange<A> const &rhs);
template <class A>
 std::ostream & operator <<(std::ostream &out, std::set<A> const &rhs);
template <class A, class B>
 std::ostream & operator <<(std::ostream &out, std::map<A, B> const &rhs);
template <class A>
 std::ostream & operator <<(std::ostream &out, std::vector<A> const &rhs);
template <class A, class B>
 std::ostream & operator <<(std::ostream &out, std::pair<A, B> const &rhs);
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper<A> const &rhs);
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper< std::vector< A > > const &rhs);
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper< std::set< A > > const &rhs);
template <class A, class B>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper< std::map< A, B > > const &rhs);

template <class A>
 CCostream & operator <<(CCostream &out, PrintableRange<A> const &rhs);
template <class A>
 CCostream & operator <<(CCostream &out, std::set<A> const &rhs);
template <class A, class B>
 CCostream & operator <<(CCostream &out, std::map<A, B> const &rhs);
template <class A>
 CCostream & operator <<(CCostream &out, std::vector<A> const &rhs);
template <class A, class B>
 CCostream & operator <<(CCostream &out, std::pair<A, B> const &rhs);
template <class A>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper<A> const &rhs);
template <class A>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper< std::vector< A > > const &rhs);
template <class A>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper< std::set< A > > const &rhs);
template <class A, class B>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper< std::map< A, B > > const &rhs);


std::ostream & operator <<(std::ostream &out, Symbol const &rhs);

std::ostream & operator <<(std::ostream &out, Symbol * const rhs);

CCostream & operator <<(CCostream &out, DBTypeInfo const &rhs);

CCostream & operator <<(CCostream &out, CodeGenerator::CodeBlock const &block);

CCostream & operator <<(CCostream &out, Code::Instruction const &rhs);

//std::ostream & operator <<(std::ostream &out, CodeGenerator::CodeBlock const &block);

std::ostream & operator <<(std::ostream &out, VariableWrapper const &vars);

CCostream & operator <<(CCostream &out, IL::Constant const &constant);

// Definitions
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintableRange<A> const &rhs)
{
        out << "[";
        for (A it = rhs.begin; it != rhs.end; ++it)
        {
                if (it != rhs.begin) out << ", ";
                out << *it;
        }
        return out << "]";
}

template <class A>
 std::ostream & operator <<(std::ostream &out, std::set<A> const &rhs)
{
        out << "{";
        for (typename std::set<A>::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin()) out << ", ";
                out << *it;
        }
        return out << "}";
}
template <class A, class B>
 std::ostream & operator <<(std::ostream &out, std::map<A, B> const &rhs)
{
        out << "{";
        for (typename std::map<A, B>::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin()) out << ", ";
                out << *it;
        }
        return out << "}";
}
template <class A>
 std::ostream & operator <<(std::ostream &out, std::vector<A> const &rhs)
{
        out << "[";
        for (typename std::vector<A>::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin()) out << ", ";
                out << *it;
        }
        return out << "]";
}
template <class A, class B>
 std::ostream & operator <<(std::ostream &out, std::pair<A, B> const &rhs)
{
        return out << "(" << rhs.first << ", " << rhs.second << ")";
}
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper<A> const &rhs)
{
        return out << rhs.container;
}

template <class A>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper< std::vector< A > > const &rhs)
{
        out << "[ ";
        for (typename std::vector< A >::const_iterator it = rhs.container.begin(); it != rhs.container.end(); ++it)
        {
                if (it != rhs.container.begin()) out << "\n, ";
                out << *it;
        }
        return out << "\n]";
}
template <class A>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper< std::set< A > > const &rhs)
{
        out << "{ ";
        for (typename std::set< A >::const_iterator it = rhs.container.begin(); it != rhs.container.end(); ++it)
        {
                if (it != rhs.container.begin()) out << "\n, ";
                out << *it;
        }
        return out << "\n}";
}
template <class A, class B>
 std::ostream & operator <<(std::ostream &out, PrintWithNLWrapper< std::map< A, B > > const &rhs)
{
        out << "[ ";
        for (typename std::map< A, B >::const_iterator it = rhs.container.begin(); it != rhs.container.end(); ++it)
        {
                if (it != rhs.container.begin()) out << "\n, ";
                out << *it;
        }
        return out << "\n]";
}

// Definitions
template <class A>
 CCostream & operator <<(CCostream &out, PrintableRange<A> const &rhs)
{
        out << "[";
        for (A it = rhs.begin; it != rhs.end; ++it)
        {
                if (it != rhs.begin) out << ", ";
                out << *it;
        }
        return out << "]";
}

template <class A>
 CCostream & operator <<(CCostream &out, std::set<A> const &rhs)
{
        out << "{";
        for (typename std::set<A>::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin()) out << ", ";
                out << *it;
        }
        return out << "}";
}
template <class A, class B>
 CCostream & operator <<(CCostream &out, std::map<A, B> const &rhs)
{
        out << "{";
        for (typename std::map<A, B>::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin()) out << ", ";
                out << *it;
        }
        return out << "}";
}
template <class A>
 CCostream & operator <<(CCostream &out, std::vector<A> const &rhs)
{
        out << "[";
        for (typename std::vector<A>::const_iterator it = rhs.begin(); it != rhs.end(); ++it)
        {
                if (it != rhs.begin()) out << ", ";
                out << *it;
        }
        return out << "]";
}
template <class A, class B>
 CCostream & operator <<(CCostream &out, std::pair<A, B> const &rhs)
{
        return out << "(" << rhs.first << ", " << rhs.second << ")";
}
template <class A>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper<A> const &rhs)
{
        return out << rhs.container;
}

template <class A>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper< std::vector< A > > const &rhs)
{
        out << "[ ";
        for (typename std::vector< A >::const_iterator it = rhs.container.begin(); it != rhs.container.end(); ++it)
        {
                if (it != rhs.container.begin()) out << "\n, ";
                out << *it;
        }
        return out << "\n]";
}
template <class A>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper< std::set< A > > const &rhs)
{
        out << "{ ";
        for (typename std::set< A >::const_iterator it = rhs.container.begin(); it != rhs.container.end(); ++it)
        {
                if (it != rhs.container.begin()) out << "\n, ";
                out << *it;
        }
        return out << "\n}";
}
template <class A, class B>
 CCostream & operator <<(CCostream &out, PrintWithNLWrapper< std::map< A, B > > const &rhs)
{
        out << "[ ";
        for (typename std::map< A, B >::const_iterator it = rhs.container.begin(); it != rhs.container.end(); ++it)
        {
                if (it != rhs.container.begin()) out << "\n, ";
                out << *it;
        }
        return out << "\n]";
}



std::string EncodeString(const std::string &str);
std::string EncodeVariable(CompilerContext &context, VarId var, bool in_code);
std::string EncodeConstant(CompilerContext *context, IL::Constant const &constant);

} // end of namespace Compiler
} // end of namespace HareScript

// Borland needs this.
//using HareScript::Compiler::operator <<;


#endif
