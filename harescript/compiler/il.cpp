//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "il.h"
#include "debugprints.h"

namespace HareScript {
namespace Compiler {
namespace IL {

BaseILVisitor::~BaseILVisitor()
{
}

std::ostream & operator <<(std::ostream &out, Variable const &rhs)
{
        return out << rhs.name;
}
std::ostream & operator <<(std::ostream &out, Variable * const rhs)
{
        if (rhs)
            return out << *rhs;
        else
            return out << "NULL";
}
std::ostream & operator <<(std::ostream &out, SSAVariable const &rhs)
{
        return out << rhs.variable << " " << "(" << rhs.id << ")";
}
std::ostream & operator <<(std::ostream &out, SSAVariable * const rhs)
{
        if (rhs)
            return out << *rhs;
        else
            return out << "NULL";
}
std::ostream & operator <<(std::ostream &out, AssignSSAVariable const &rhs)
{
        return out << rhs.variable << "(" << rhs.id << ")";
}
std::ostream & operator <<(std::ostream &out, AssignSSAVariable * const rhs)
{
        if (rhs)
            return out << *rhs;
        else
            return out << "NULL";
}
/*
std::ostream & operator <<(std::ostream &out, Constant const &rhs)
{
        switch (rhs.type)
        {
        case VariableTypes::String:
        {
                out << "'";
                for (std::string::const_iterator it = rhs.stringvalue.begin(); it != rhs.stringvalue.end(); ++it)
                    if (*it != '\n' && *it != '\r')
                        out << *it;
                    else if (*it != '\r')
                        out << "\\n";
                out << "'";
        }; break;
        case VariableTypes::Integer: out << (Blex::AnyToString(rhs.integervalue)); break;
        case VariableTypes::Boolean: out << (std::string(rhs.booleanvalue?"TRUE":"FALSE")); break;
        default:
            out << (HareScript::GetTypeName(rhs.type));
        }
        return out;
} */

void FlowState::ExportVariables(std::set<Variable *> *vars)
{
        std::transform(visibleassignments.begin(), visibleassignments.end(),
                std::inserter(*vars, vars->begin()),
                Utilities::pair_first<Variable *, SSAVariable *>());
}

void FlowState::FilterByVariables(std::set<Variable *> const &vars)
{
        VisibleAssignmentsMap new_visibleassignments;

        for (std::set<Variable *>::const_iterator it = vars.begin(); it != vars.end(); ++it)
        {
                IL::FlowState::VisibleAssignmentsMap::iterator it2 = visibleassignments.find(*it);
                if (it2 != visibleassignments.end())
                    new_visibleassignments.insert(*it2);
        }
        std::swap(new_visibleassignments, visibleassignments);
}

void UseDefTracker::AddUse(SSAVariable *var)
{
        std::vector< SSAVariable * >::iterator it = std::lower_bound(uses.begin(), uses.end(), var);
        if (it == uses.end() || *it != var)
            uses.insert(it, var);
}

void UseDefTracker::AddDef(AssignSSAVariable *var)
{
        std::vector< AssignSSAVariable * >::iterator it = std::lower_bound(defs.begin(), defs.end(), var);
        if (it == defs.end() || *it != var)
            defs.insert(it, var);
}

void UseDefTracker::ReplaceUses(FlowState const &flowstate)
{
//        DEBUGPRINT("Replacing uses\nfrom: " << uses);

        for (std::vector< SSAVariable * >::iterator it = uses.begin(); it != uses.end(); ++it)
        {
                FlowState::VisibleAssignmentsMap::const_iterator new_var = flowstate.visibleassignments.find((*it)->variable);

                if (new_var == flowstate.visibleassignments.end())
                {
                        // (*it)->variable is used, but not defined...
                        std::string s = "CORRUPT: NULL";
                        DEBUGPRINT("Error, state: " <<flowstate);
                        if ((*it) && (*it)->variable)
                            s = (*it)->variable->name;
                        throw std::logic_error("Strictness error in fixupper, variable "+s+" used without dominating definition!");
                }

                *it = new_var->second;
        }

        std::sort(uses.begin(), uses.end());
        uses.erase(std::unique(uses.begin(), uses.end()), uses.end());

//        DEBUGPRINT("to: " << uses);
}

void UseDefTracker::UpdateFlowState(FlowState &flowstate)
{
        // Update the flowstate with all the defs of this instruction
        for (std::vector<AssignSSAVariable *>::iterator it = defs.begin(); it != defs.end(); ++it)
            flowstate.visibleassignments[(*it)->variable] = *it;
}

void UseDefTracker::AddUsesForDefinedGlobals(FlowState const &flowstate)
{
        for (std::vector<AssignSSAVariable *>::iterator it = defs.begin(); it != defs.end(); ++it)
        {
                if ((*it)->variable->storagetype == Variable::Global)
                {
                        FlowState::VisibleAssignmentsMap::const_iterator new_var = flowstate.visibleassignments.find((*it)->variable);
                        if (new_var == flowstate.visibleassignments.end())
                        {
                                // (*it)->variable is used, but not defined...
                                std::string s = "CORRUPT: NULL";
                                DEBUGPRINT("Error, state: " <<flowstate);
                                if ((*it) && (*it)->variable)
                                    s = (*it)->variable->name;
                                throw std::logic_error("Strictness error, global variable "+s+" used without dominating definition!");
                        }

                        AddUse(new_var->second);
                }
        }
}

bool UseDefTracker::DefinesGlobals() const
{
        for (std::vector<AssignSSAVariable *>::const_iterator it = defs.begin(); it != defs.end(); ++it)
          if ((*it)->variable->storagetype == IL::Variable::Global)
            return true;
        return false;
}

bool UseDefTracker::UsesGlobals() const
{
        for (std::vector<SSAVariable *>::const_iterator it = uses.begin(); it != uses.end(); ++it)
          if ((*it)->variable->storagetype == IL::Variable::Global)
            return true;
        return false;
}

void UseDefTracker::InsertDefined(std::set<SSAVariable*> *varlist) const
{
        std::copy(defs.begin(), defs.end(), std::inserter(*varlist, varlist->begin()));
}

void UseDefTracker::AppendDefined(std::vector<SSAVariable*> *varlist) const
{
        std::copy(defs.begin(), defs.end(), std::back_inserter(*varlist));
}


void UseDefTracker::InsertUsed(std::set<SSAVariable*> *varlist) const
{
        std::copy(uses.begin(), uses.end(), std::inserter(*varlist, varlist->begin()));
}

void UseDefTracker::AppendUsed(std::vector<SSAVariable*> *varlist) const
{
        std::copy(uses.begin(), uses.end(), std::back_inserter(*varlist));
}

void UseDefTracker::DumpObject(CCostream &out) const
{
        out << " (u: ";
        Debug::StreamContainer(out,uses);
        out << ", d: ";
        Debug::StreamContainer(out,defs);
}

ILInstruction::ILInstruction(LineColumn const &_position, const std::set<AssignSSAVariable *> &_defs, const std::set<SSAVariable *> &_uses)
//        : defs(_defs.begin(), _defs.end())
//        , uses(_uses),
: position(_position)
, on_exception(0)
{
        for (std::set<AssignSSAVariable *>::const_iterator it = _defs.begin(); it != _defs.end(); ++it)
          usedefs.AddDef(*it);
        for (std::set<SSAVariable *>::const_iterator it = _uses.begin(); it != _uses.end(); ++it)
          usedefs.AddUse(*it);
}

void ILInstruction::DumpObject(CCostream &out) const
{
        out << "I ";
        {       const IL::ILConstant *obj = dynamic_cast<const IL::ILConstant *>(this);
                if (obj) { out << "V:=C  :" << obj->target << " <- "; Compiler::operator<<(out, obj->constant); } }
        {       const IL::ILAssignment *obj = dynamic_cast<const IL::ILAssignment *>(this);
                if (obj) { out << "V:=V  :" << obj->target << " <- " << obj->rhs; } }
        {       const IL::ILCast *obj = dynamic_cast<const IL::ILCast *>(this);
                if (obj) { out << "V:=V (casted)  :" << obj->target << " <- " << obj->rhs << " to " << HareScript::GetTypeName(obj->to_type); } }
        {       const IL::ILBinaryOperator *obj = dynamic_cast<const IL::ILBinaryOperator *>(this);
                if (obj) { out << "V:=VxV:" << obj->target << " <- " << obj->lhs << " " << ToSTLStr(obj->operation) << " " << obj->rhs; } }
        {       const IL::ILUnaryOperator *obj = dynamic_cast<const IL::ILUnaryOperator *>(this);
                if (obj) { out << "V:=xV :" << obj->target << " <- " << ToSTLStr(obj->operation) << " " << obj->rhs; } }
        {       const IL::ILColumnOperator *obj = dynamic_cast<const IL::ILColumnOperator *>(this);
                if (obj) { out << "V:=V.s:" << obj->target << " <- " << obj->rhs << "." << obj->columnname; } }
        {       const IL::ILFunctionCall *obj = dynamic_cast<const IL::ILFunctionCall *>(this);
                if (obj) { out << "V:=F():" << obj->target << " <- " << obj->function->name << "(";
                for (std::vector<IL::SSAVariable *>::const_iterator it = obj->values.begin(); it != obj->values.end(); ++it)
                { if (it != obj->values.begin()) out << ", "; out << *it; }
                out << ")"; } }
        {       const IL::ILConditionalJump *obj = dynamic_cast<const IL::ILConditionalJump *>(this);
                if (obj) { out << "jmpc  :" << obj->rhs; } }
        {       const IL::ILReturn *obj = dynamic_cast<const IL::ILReturn *>(this);
                if (obj) { out << "return:";
                if (obj->returnvalue)
                  out << *obj->returnvalue;
                out << ")"; } }
        {       const IL::ILMethodCall *obj = dynamic_cast<const IL::ILMethodCall *>(this);
                if (obj) { out << "V:=object->member():" << obj->target << " <- " << obj->object << "->" << obj->membername << "(";
                for (std::vector<IL::SSAVariable *>::const_iterator it = obj->values.begin(); it != obj->values.end(); ++it)
                { if (it != obj->values.begin()) out << ", "; out << *it; }
                out << ")"; } }
        {       const IL::ILRecordCellSet *obj = dynamic_cast<const IL::ILRecordCellSet *>(this);
                if (obj) { out << "V:=recordcellset:" << obj->target << " <- " << obj->rhs << "." << obj->columnname << " := " << obj->value;
                out << " (create:" << (obj->allow_create ? "yes" : "no");
                out << " , typecheck:" << (obj->check_type ? "yes" : "no") << ")"; } }
        {       const IL::ILRecordCellDelete *obj = dynamic_cast<const IL::ILRecordCellDelete *>(this);
                if (obj) { out << "V:=recordcelldelete:" << obj->target << " <- " << obj->rhs << "." << obj->columnname; } }
        {       const IL::ILObjectMemberGet *obj = dynamic_cast<const IL::ILObjectMemberGet *>(this);
                if (obj) { out << "V:=V->s: " << obj->target << " := " << obj->object << "->" << obj->membername << (obj->via_this?" (via THIS)":""); } }
        {       const IL::ILObjectMemberSet *obj = dynamic_cast<const IL::ILObjectMemberSet *>(this);
                if (obj) { out << "V->s:=V: " << obj->object << "->" << obj->membername << " := " << obj->value << (obj->via_this?" (via THIS)":""); } }
        {       const IL::ILObjectMemberDelete *obj = dynamic_cast<const IL::ILObjectMemberDelete *>(this);
                if (obj) { out << "memberdelete:"<< obj->object << "->" << obj->membername << (obj->via_this?" (via THIS)":""); } }
        {       const IL::ILObjectMemberInsert *obj = dynamic_cast<const IL::ILObjectMemberInsert *>(this);
                if (obj) { out << "memberinsert:"<< obj->object << "->" << obj->membername << " := " << obj->value << " " << (obj->is_private?"PRIVATE":"PUBLIC") << (obj->via_this?" (via THIS)":""); } }

        usedefs.DumpObject(out);
}

void ILInstruction::AddTarget(AssignSSAVariable *_target)
{
        usedefs.AddDef(_target);
}

ILFunctionCall::ILFunctionCall(LineColumn const &_position, AssignSSAVariable *_target, Function *_function, std::vector<SSAVariable *> const &_values)
: ILInstruction(_position, std::set<AssignSSAVariable *>(), std::set<SSAVariable *>(_values.begin(), _values.end()))
, target(_target)
, function(_function)
, values(_values)
{
        if (_target)
            AddTarget(_target);
}

ILMethodCall::ILMethodCall(LineColumn const &_position, AssignSSAVariable *_target, SSAVariable *_object, std::string _membername, bool _via_this, std::vector<SSAVariable *> const &_values, bool _allow_macro)
: ILInstruction(_position, std::set<AssignSSAVariable *>(), std::set<SSAVariable *>(_values.begin(), _values.end()))
, target(_target)
, object(_object)
, membername(_membername)
, via_this(_via_this)
, values(_values)
, allow_macro(_allow_macro)
{
        if (_target)
            AddTarget(_target);
}

ILFunctionPtrCall::ILFunctionPtrCall(LineColumn const &_position, AssignSSAVariable *_target, SSAVariable *_functionptr, std::vector<SSAVariable *> const &_values, bool _allow_macro)
: ILInstruction(_position, std::set<AssignSSAVariable *>(), std::set<SSAVariable *>(_values.begin(), _values.end()))
, target(_target)
, functionptr(_functionptr)
, values(_values)
, allow_macro(_allow_macro)
{
        if (_target)
            AddTarget(_target);
}

CCostream & operator <<(CCostream &out, ILInstruction const &rhs)
{
        rhs.DumpObject(out);
        return out;
}

CCostream & operator <<(CCostream &out, BasicBlock const &rhs)
{
        out << "Block " << &rhs << std::endl;
        out << "Predecessors: ";
        Debug::StreamContainer(out,rhs.predecessors);
        out << std::endl;
        out << "Successors: ";
        Debug::StreamContainer(out,rhs.successors);
        out << std::endl;
        out << "Throwcatchers: ";
        Debug::StreamContainer(out,rhs.throwcatchers);
        out << std::endl;
        out << "Dominator: " << rhs.dominator << std::endl;
        out << "Dominees: ";
        Debug::StreamContainer(out,rhs.dominees);
        out << std::endl;
        out << "Throwcatchers: ";
        Debug::StreamContainer(out,rhs.throwcatchers);
        out << std::endl;
        for (std::vector<IL::PhiFunction *>::const_iterator it = rhs.phifunctions.begin(); it != rhs.phifunctions.end(); ++it)
        {
                if (*it != NULL)
                    out << **it << std::endl;
                else
                    out << "NULL" << std::endl;
        }
        for (std::vector<IL::ILInstruction *>::const_iterator it = rhs.instructions.begin(); it != rhs.instructions.end(); ++it)
        {
                out << **it << std::endl;
                if ((*it)->on_exception)
                    out << " (on exception jump to basic block " << (*it)->on_exception << ")" << std::endl;
        }
        return out;
}

std::ostream & operator <<(std::ostream &out, PhiFunction const &rhs)
{
        out << "Phi: " << rhs.variable << " <- ";
        for (std::vector<std::pair<IL::AssignSSAVariable*, BasicBlock *> >::const_iterator it = rhs.params.begin();
                it != rhs.params.end(); ++it)
        {
                if (it != rhs.params.begin()) out << ", ";
                out << it->first << "(from " << it->second << ")";
      }
      return out;
}

std::ostream & operator <<(std::ostream &out, FlowState const &state)
{
        out << "VIS: ";
        for (std::map<IL::Variable *, IL::AssignSSAVariable *>::const_iterator it = state.visibleassignments.begin();
                it != state.visibleassignments.end(); ++it)
        {
                if (it != state.visibleassignments.begin()) out << ", ";
//                const std::pair<IL::Variable * const, IL::AssignSSAVariable *> *x = &*it;
                out << it->first << ":" << static_cast<IL::SSAVariable *>(it->second);
        }
        return out << std::endl;
}

} //end namespace IL
} //end namespace compiler
} //end namespace harescript
