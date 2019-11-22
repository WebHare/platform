#include <ap/libwebhare/allincludes.h>


#include "dbase_backend.h"
#include "dbase_transaction.h"
#include "dbase_privileges.h"

namespace Database
{

// -----------------------------------------------------------------------------
//
// Privilege descriptor
//
const unsigned PrivilegeDescriptor::NumPrivileges;

PrivilegeDescriptor::PrivilegeDescriptor()
{
        Clear();
}

void PrivilegeDescriptor::Clear()
{
        memset(descriptor,32,sizeof(descriptor));
}

void PrivilegeDescriptor::GiveAllPrivileges(MetaObjectType::_type object_type, bool with_grant_option)
{
        char p = with_grant_option ? 'C' : 'B';
        switch (object_type)
        {
        case MetaObjectType::Schema:
             //Note: we currently have no schema privs: descriptor[Privilege::Schema_RoleManagement] = p;
             //Fallthrough

        case MetaObjectType::Table:
             descriptor[Privilege::Table_Delete] = p;
             //Fallthrough

        case MetaObjectType::Column:
             descriptor[Privilege::Column_Insert] = p;
             descriptor[Privilege::Column_References] = p;
             descriptor[Privilege::Column_Select] = p;
             descriptor[Privilege::Column_Update] = p;
             break;
        default: ;
        }
}

void PrivilegeDescriptor::AddPrivilege(Privilege::_type priv, bool with_grant_option)
{
        if (with_grant_option)
            descriptor[priv] = 'C';
        else if (descriptor[priv] != 'C')
            descriptor[priv] = 'B';
}

void PrivilegeDescriptor::AddGrantOptions()
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (descriptor[i] == 'B')
                descriptor[i] = 'C';
}

bool PrivilegeDescriptor::HasPrivilege(Privilege::_type priv) const
{
        return descriptor[priv] != ' ';
}

bool PrivilegeDescriptor::CanGrant(Privilege::_type priv) const
{
        return descriptor[priv] == 'C';
}

void PrivilegeDescriptor::ReadFromCell(Cell const &db_cell)
{
        memcpy(descriptor, db_cell.Begin(), std::min(db_cell.Size(), NumPrivileges));
        for(unsigned i=0;i<NumPrivileges;++i)
          if(descriptor[i]==0)
            descriptor[i]=32; //fix bug in v2.39 writing NULs into descriptors. (ADDME: Remove in v2.40)
}

void PrivilegeDescriptor::SetCell(WritableRecord &rec, ColumnId col_id) const
{
        rec.SetColumn(col_id, NumPrivileges, descriptor);
}

void PrivilegeDescriptor::Merge(PrivilegeDescriptor const &rhs)
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (rhs.descriptor[i] != ' ')
                AddPrivilege((Privilege::_type)i, rhs.descriptor[i] == 'C');
}

void PrivilegeDescriptor::Erase(PrivilegeDescriptor const &rhs, bool remove_only_grant_option)
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (rhs.descriptor[i] != ' ')
            {
                    if (remove_only_grant_option && descriptor[i] == 'C')
                        descriptor[i] = 'B';
                    else
                        descriptor[i] = ' ';
            }
}

bool PrivilegeDescriptor::HasPrivileges(PrivilegeDescriptor const &grants) const
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (grants.descriptor[i] != ' ' && descriptor[i] == ' ')
                return false;

        return true;
}

bool PrivilegeDescriptor::CanGrant(PrivilegeDescriptor const &grants) const
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (grants.descriptor[i] != ' ' && descriptor[i] != 'C')
                return false;

        return true;
}

bool PrivilegeDescriptor::IsEmpty() const
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (descriptor[i] != ' ')
                return false;

        return true;
}

void PrivilegeDescriptor::BuildGrantablePrivileges()
{
        for (unsigned i = 0, end = NumPrivileges; i < end; ++i)
            if (descriptor[i] == 'C')
                descriptor[i] = 'B';
            else
                descriptor[i] = ' ';
}

bool PrivilegeDescriptor::CheckForApplicability(MetaObjectType::_type object_type)
{
        switch (object_type)
        {
        case MetaObjectType::Column:
                if (HasPrivilege(Privilege::Table_Delete))
                    return false;

                // Fallthrough
        case MetaObjectType::Table:
                /* Note: we currently have no schema privs
                if (HasPrivilege(Privilege::Schema_RoleManagement) || HasPrivilege(Privilege::Schema_MetadataManagement))
                    return false;
                */

                // Fallthrough
        case MetaObjectType::Schema:
                return true;

        default: //huh? weird type
                return false;
        }
}

// -----------------------------------------------------------------------------
//
// Privilege keeper
//

void PrivilegeChecker::ProcessAndValidateGrantData(bool allow_grant_inconsistencies)
{
        // Warning: this function MUST leave all cached_contained_roles caches valid!!

        /** No initialisation by dbase done: system roles are missing. This causes the checks to fail/crash
            (owner of system and public schema has already been filled in). So, we return, and wait to be
            called again when all system records has been inserted
        if (metadata->roles.empty())
            return true;*/

        ValidateAllRoleGrants(!allow_grant_inconsistencies);
        ValidateAllGrants(!allow_grant_inconsistencies);
        if (!allow_grant_inconsistencies)
            CheckAllRoleGrantsForCycles();
}

void PrivilegeChecker::GetAbandonedRoleGrants(std::vector< unsigned > *grants) const
{
        for (RoleGrants::const_iterator it = role_grants.begin(); it != role_grants.end(); ++it)
            if (!it->second.is_valid)
                grants->push_back(it->second.id);
}

void PrivilegeChecker::GetAbandonedGrants(std::vector< unsigned > *abandoned_grants) const
{
        for (Grants::const_iterator it = grants.begin(); it != grants.end(); ++it)
            if (!it->second.is_valid)
                abandoned_grants->push_back(it->second.id);
}

void PrivilegeChecker::CalculateContainedRoles(RoleDef *role, unsigned gen, bool ignore_cycles)
{
        if (role->cache_cr_gen == gen)
            return;
        role->cached_contained_roles.clear();
        std::vector< RoleDef * > worklist(1, role);
        std::set< RoleDef const * > visited;
        while (!worklist.empty())
        {
                RoleDef *current = worklist.back();
                worklist.pop_back();
                if (visited.insert(current).second)
                {
                        if (current->cache_cr_gen == gen)
                        {
                                for (std::map< RoleDef *, bool >::iterator it = current->cached_contained_roles.begin(); it != current->cached_contained_roles.end(); ++it)
                                {
                                        bool &with_admin = role->cached_contained_roles[it->first];
                                        with_admin = with_admin || it->second;
                                }
                        }
                        else
                        {
                                for (std::map< RoleDef *, bool >::iterator it = current->direct_valid_grants.begin(); it != current->direct_valid_grants.end(); ++it)
                                {
                                        bool &with_admin = role->cached_contained_roles[it->first];
                                        with_admin = with_admin || it->second;
                                        worklist.push_back(it->first);
                                }
                        }
                }
        }
        if (role->cached_contained_roles.find(role) != role->cached_contained_roles.end() && !ignore_cycles)
            throw Exception(ErrorConstraint,"Detected cycle in role grants");

        role->cache_cr_gen = gen;
}

void PrivilegeChecker::CheckAllRoleGrantsForCycles()
{
        for (Roles::iterator it = roles.begin(); it != roles.end(); ++it)
            CalculateApplicableRoles(&it->second, 1, false);
}

void PrivilegeChecker::CalculateApplicableRoles(RoleDef *role, unsigned gen, bool ignore_cycles)
{
        if (role->cache_ar_gen == gen)
            return;

        CalculateContainedRoles(role, gen, ignore_cycles);

        role->cached_applicable_roles = role->cached_contained_roles;

        if (role->role_id != MetaRole_PUBLIC)
        {
                RoleDef *meta_public = GetRoleDef(MetaRole_PUBLIC);
                CalculateContainedRoles(meta_public, gen, ignore_cycles);

                for (std::map< RoleDef *, bool >::const_iterator it = meta_public->cached_contained_roles.begin(); it != meta_public->cached_contained_roles.end(); ++it)
                {
                        bool &with_admin = role->cached_applicable_roles[it->first];
                        with_admin = with_admin || it->second;
                }
        }

        role->cache_ar_gen = gen;
}

void PrivilegeChecker::ValidateAllRoleGrants(bool throw_on_invalid)
{
//        /* Loop through all roles, add them as a direct grant to their schema owner */
//        for (Roles::iterator it = roles.begin(); it != roles.end(); ++it)
//          if (it->second.schema->owner != it->first) //No need to self-grant
//            GetRoleDef(it->second.schema->owner)->direct_valid_grants[&it->second] = true /*admin rights*/;

        unsigned gen = 0;
        while (true)
        {
                ++gen;
                bool any_changed = false;
                bool all_valid = true;

//#ifdef DEBUG
                RoleGrants::iterator invalid_grant;
//#endif

                for (RoleGrants::iterator it = role_grants.begin(); it != role_grants.end(); ++it)
                {
                        if (it->second.is_valid)
                            continue;

                        all_valid = false;
//                        DEBUGONLY(invalid_grant = it);
                        invalid_grant = it;

                        // A role grant is valid when the granted role is granted to the grantor with admin option, or if the grantor is the role itself
                        CalculateApplicableRoles(it->second.grantor, gen, !throw_on_invalid);
                        std::map< RoleDef *, bool >::iterator cit = it->second.grantor->cached_applicable_roles.find(it->second.role);
                        if ((cit != it->second.grantor->cached_applicable_roles.end() && cit->second == true) || (it->second.grantor == it->second.role))
                        {
                                // No need to recalc the caches, the next sweep will regenerate them
                                it->second.is_valid = true;
                                it->second.grantee->direct_valid_grants[it->second.role] = it->second.with_admin_option;

                                any_changed = true;
                        }
                }

                if (!any_changed)
                {
                        // No valid caches are available anymore, reset generations to 0, and then calculate generation 1
                        for (Roles::iterator it = roles.begin(); it != roles.end(); ++it)
                        {
                                it->second.cache_cr_gen = 0;
                                it->second.cache_ar_gen = 0;
                        }
                        for (Roles::iterator it = roles.begin(); it != roles.end(); ++it)
                            CalculateApplicableRoles(&it->second, 1, !throw_on_invalid);

                        if (!all_valid)
                        {
#ifdef DEBUG
                                DEBUGPRINT("Detected invalid grant of role " << invalid_grant->second.role->name << " to " << invalid_grant->second.grantee->name << " by " << invalid_grant->second.grantor->name);
#endif
                                if (throw_on_invalid)
                                    throw Exception(ErrorMetadataBad, "Detected invalid grant of role " + invalid_grant->second.role->name + " to " + invalid_grant->second.grantee->name + " by " + invalid_grant->second.grantor->name);
                        }
                        return;
                }
        }
}

void PrivilegeChecker::GetPrivilegesForObject(RoleDef const *role, ObjectDef const *object, PrivilegeDescriptor *desc) const
{
        desc->Clear();
        /*if (role->role_id == MetaRole_SYSTEM)
        {
                desc->GiveAllPrivileges(object->type, true);
                return;
        }*/

        MergeDirectPrivilegesForObject(role, *object, desc);
        for (std::map< RoleDef *, bool >::const_iterator it = role->cached_applicable_roles.begin(); it != role->cached_applicable_roles.end(); ++it)
            MergeDirectPrivilegesForObject(it->first, *object, desc);

        MergeDirectPrivilegesForObject(GetRoleDef(MetaRole_PUBLIC), *object, desc);
        //because PUBLIC applicable roles are already in our role applicable roles, no need to scan PUBLIC's applicable roles
}

void PrivilegeChecker::ValidateAllGrants(bool throw_on_invalid)
{
        while (true)
        {
//#ifdef DEBUG
                Grants::iterator invalid_grant;
//#endif
                bool any_changed = false;
                bool all_valid = true;
                for (Grants::iterator it = grants.begin(); it != grants.end(); ++it)
                {
                        // No need to check already valid grants
                        if (it->second.is_valid)
                            continue;

                        all_valid = false;
//                        DEBUGONLY(invalid_grant = it);
                        invalid_grant = it;

                        // Don't know if it's valid. Get set of all privileges for this object
                        PrivilegeDescriptor desc;

                        GetPrivilegesForObject(it->second.grantor, it->second.object, &desc);
                        if (desc.CanGrant(it->second.privs))
                        {
                                it->second.is_valid = true;
                                any_changed = true;
                        }
                }
                if (!any_changed)
                {
                        if (!all_valid)
                        {
#ifdef DEBUG
                                DEBUGPRINT("Detected invalid grant of privileges to " << invalid_grant->second.grantee->name << " by " << invalid_grant->second.grantor->name);
#endif
                                if (throw_on_invalid)
                                    throw Exception(ErrorMetadataBad, "Detected invalid grant of privileges to " + invalid_grant->second.grantee->name + " by " + invalid_grant->second.grantor->name);
                        }
                        return;
                }
        }
}

void PrivilegeChecker::MergeDirectPrivilegesForSingleObject(RoleDef const *role, ObjectDef const &object, PrivilegeDescriptor *desc) const
{
        std::pair< Grants::const_iterator, Grants::const_iterator > range = grants.equal_range(std::make_pair(role, &object));
        for (Grants::const_iterator it = range.first; it != range.second; ++it)
            if (it->second.is_valid)
                desc->Merge(it->second.privs);
}
void PrivilegeChecker::MergeDirectPrivilegesForObject(RoleDef const *role, ObjectDef const &object, PrivilegeDescriptor *desc) const
{
        ObjectDef const *objdef=&object;
        for (;objdef;objdef=objdef->parent_object)
            MergeDirectPrivilegesForSingleObject(role, *objdef, desc);
}
//ADDME: Can we remove one of the overloads?
void PrivilegeChecker::GetContainedRoles(std::vector< RoleId > const &source_role_ids, bool need_admin, std::vector< RoleId > *contained_role_ids) const
{
        std::vector< RoleDef const * > source_roles, contained_roles;
        for (std::vector< RoleId >::const_iterator it = source_role_ids.begin(); it != source_role_ids.end(); ++it)
        {
                RoleDef const *role = GetRoleDef(*it);
                if (!role)
                    throw Exception(ErrorInvalidArg, "Role #" + Blex::AnyToString(*it) + " does not exist");
                source_roles.push_back(role);
        }
        GetContainedRoles(source_roles, need_admin, &contained_roles);
        for (std::vector< RoleDef const * >::iterator it = contained_roles.begin(); it != contained_roles.end(); ++it)
            contained_role_ids->push_back((*it)->role_id);
}
void PrivilegeChecker::GetContainedRoles(std::vector< RoleDef const * > const &source_roles, bool need_admin, std::vector< RoleDef const * > *contained_roles) const
{
        // source_roles may NOT point to the same variable as contained_roles, because of the modification to contained_roles, while still reading from source_roles
        assert(&source_roles != contained_roles);

        for (std::vector< RoleDef const * >::const_iterator rit = source_roles.begin(); rit != source_roles.end(); ++rit)
            for (std::map< RoleDef *, bool >::const_iterator it = (*rit)->cached_contained_roles.begin(); it != (*rit)->cached_contained_roles.end(); ++it)
                if (it->second || !need_admin)
                    contained_roles->push_back(it->first);
}

void PrivilegeChecker::Swap(PrivilegeChecker &rhs)
{
        std::swap(roles, rhs.roles);
        std::swap(grants, rhs.grants);
        std::swap(role_grants, rhs.role_grants);
}

bool PrivilegeChecker::AddGrant(GrantDef const &newgrant)
{
//        DEBUGPRINT("GRANT: grantor " << newgrant.grantor->role_id << " grantee " << newgrant.grantee->role_id << " object " << newgrant.object->object_id << " privs " << newgrant.privs.GetRawDescriptorCode());

        std::pair< RoleDef const *, ObjectDef const * > key(std::make_pair(newgrant.grantee, newgrant.object));
        std::pair< Grants::iterator, Grants::iterator > range(grants.equal_range(key));
        for (Grants::iterator itr = range.first; itr != range.second; ++itr)
        {
                if (itr->second.grantor == newgrant.grantor)
                {
                        itr->second.privs.Merge(newgrant.privs);
                        itr->second.is_valid = newgrant.grantor->role_id == MetaRole_DATABASE_SELF;
                        return true;
                }
        }
        Grants::iterator itr = grants.insert(std::make_pair(std::make_pair(newgrant.grantee, newgrant.object), newgrant));
        itr->second.is_valid = newgrant.grantor->role_id == MetaRole_DATABASE_SELF;
        return true;
}
RoleId PrivilegeChecker::GetRoleId(ObjectId schema, std::string const &name) const
{
        for (Roles::const_iterator itr=roles.begin();itr!=roles.end();++itr)
          if (itr->second.schema->object_id==schema && itr->second.name==name)
            return itr->first;
        return 0;
}

bool PrivilegeChecker::AddRole (const RoleDef &role)
{
        if (!role.schema || GetRoleId(role.schema->object_id, role.name) != 0)
            return false;

        roles.insert(std::make_pair(role.role_id, role));
        return true;
}
bool PrivilegeChecker::AddRoleGrant(RoleGrantDef const &role_grant)
{
        std::pair< RoleDef const *, RoleDef const * > key(std::make_pair(role_grant.role, role_grant.grantee));
        std::pair< RoleGrants::iterator, RoleGrants::iterator > range(role_grants.equal_range(key));
        for (RoleGrants::iterator itr = range.first; itr != range.second; ++itr)
        {
                if (itr->second.grantor == role_grant.grantor)
                {
                        itr->second.with_admin_option = itr->second.with_admin_option || role_grant.with_admin_option;

                        // Revoke direct valid grant if upgrading with_admin_option from false to true
                        if (!itr->second.is_valid && role_grant.with_admin_option)
                        {
                                itr->second.grantee->direct_valid_grants.erase(role_grant.role);
                                itr->second.is_valid = role_grant.grantor->role_id == MetaRole_DATABASE_SELF;
                                if (itr->second.is_valid)
                                    itr->second.grantee->direct_valid_grants.insert(std::make_pair(role_grant.role, role_grant.with_admin_option));
                        }
                        return true;
                }
        }
        RoleGrants::iterator itr = role_grants.insert(std::make_pair(std::make_pair(role_grant.role, role_grant.grantee), role_grant));
        itr->second.is_valid = role_grant.grantor->role_id == MetaRole_DATABASE_SELF;
        if (itr->second.is_valid)
            itr->second.grantee->direct_valid_grants.insert(std::make_pair(role_grant.role, role_grant.with_admin_option));

        return true;
}
bool PrivilegeChecker::IsRoleGrantableByRole(RoleId roleid, RoleId grantorid) const
{
        if (grantorid==MetaRole_PUBLIC)
            return false; //PUBLIC itself can never grant a role

        //FIXME: With the code below, a role can never grant itself to other roles. Was that supposed to work that way?
        if (grantorid==roleid)
            return true;

        std::vector< RoleId > sources, grantable_roles;
        sources.reserve(2);
        sources.push_back(grantorid);
        sources.push_back(MetaRole_PUBLIC);
        GetContainedRoles(sources, /*admin=*/true, &grantable_roles);
        return std::find(grantable_roles.begin(), grantable_roles.end(), roleid) != grantable_roles.end();
}

void PrivilegeChecker::GetObjectPrivilegesForSpecificRole(RoleId role, ObjectDef const &object, PrivilegeDescriptor *privs) const
{
        assert(role!=MetaRole_PUBLIC); //you shouldn't request privileges for PUBLIC, as you cannot explicitly have that role
        privs->Clear();

        /*if (role == MetaRole_SYSTEM)
        {
                privs->GiveAllPrivileges(objdef->type, true);
                return;
        }*/


        RoleDef const *roleinfo = GetRoleDef(role);
        if (!roleinfo)
            throw Exception(ErrorInternal,"Illegal role referenced");

        RoleDef::RoleAdminMap const &applicable_roles = roleinfo->cached_applicable_roles;

        // Iterate over all parents, merge all privileges
        RoleDef const *public_role = GetRoleDef(MetaRole_PUBLIC);
        for (ObjectDef const * curobj = &object; curobj; curobj=curobj->parent_object)
        {
                MergeDirectPrivilegesForObject(roleinfo, *curobj, privs);
                for (RoleDef::RoleAdminMap::const_iterator it = applicable_roles.begin(); it != applicable_roles.end(); ++it)
                    MergeDirectPrivilegesForObject(it->first, *curobj, privs);
                MergeDirectPrivilegesForObject(public_role, *curobj, privs);
        }
}

void PrivilegeChecker::GetAllGrantableObjectPrivilegesForRole(RoleId role, ObjectDef const &object, PrivilegeDescriptor *privs) const
{
        GetObjectPrivilegesForSpecificRole(role, object, privs);
        privs->BuildGrantablePrivileges();
}

} //end namespace Database



