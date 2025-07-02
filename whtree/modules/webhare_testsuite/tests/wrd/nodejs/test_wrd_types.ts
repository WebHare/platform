import * as test from "@webhare/test";
import { type IsGenerated, type IsNonUpdatable, type IsRequired, type WRDBaseAttributeTypeId, type WRDAttributeTypeId, recordizeOutputMap, combineRecordOutputMaps, type OutputMap, type RecordizeOutputMap, type MapRecordOutputMap, type WRDInsertable, type WRDGender, type TypeDefinition } from "@webhare/wrd/src/types";
import type { ResourceDescriptor } from "@webhare/services";

type MapOutput<T extends TypeDefinition, O extends OutputMap<T>, Export extends boolean> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>, Export>;

function testTypes() {

  type System_Usermgmt_WRDPerson = {
    wrd_id: IsNonUpdatable<WRDBaseAttributeTypeId.Base_Integer>;
    wrd_guid: WRDBaseAttributeTypeId.Base_Guid;
    wrd_type: IsGenerated<WRDBaseAttributeTypeId.Base_Integer>;
    wrdTag: WRDBaseAttributeTypeId.Base_Tag;
    wrdCreationDate: WRDBaseAttributeTypeId.Base_CreationLimitDate;
    wrdLimitDate: WRDBaseAttributeTypeId.Base_CreationLimitDate;
    wrdModificationDate: WRDBaseAttributeTypeId.Base_ModificationDate;
    wrd_gender: WRDBaseAttributeTypeId.Base_Gender;
    wrdSaluteFormal: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    wrdAddressFormal: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    wrdFullName: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    wrd_titles: WRDBaseAttributeTypeId.Base_NameString;
    wrd_initials: WRDBaseAttributeTypeId.Base_NameString;
    wrdFirstName: WRDBaseAttributeTypeId.Base_NameString;
    wrdFirstNames: WRDBaseAttributeTypeId.Base_NameString;
    wrd_infix: WRDBaseAttributeTypeId.Base_NameString;
    wrdLastName: WRDBaseAttributeTypeId.Base_NameString;
    wrdTitlesSuffix: WRDBaseAttributeTypeId.Base_NameString;
    wrdDateOfBirth: WRDBaseAttributeTypeId.Base_Date;
    wrdDateOfDeath: WRDBaseAttributeTypeId.Base_Date;
    wrdTitle: IsGenerated<WRDBaseAttributeTypeId.Base_GeneratedString>;
    whuser_disabled: WRDAttributeTypeId.Boolean;
    whuser_disablereason: WRDAttributeTypeId.String;
    whuser_comment: WRDAttributeTypeId.String;
    whuser_lastlogin: WRDAttributeTypeId.DateTime;
    whuser_unit: IsRequired<WRDAttributeTypeId.Domain>;
    whuser_hiddenannouncements: WRDAttributeTypeId.DomainArray;
    invented_domain: WRDAttributeTypeId.Domain;
    requiredFile: IsRequired<WRDAttributeTypeId.File>;
    requiredImage: IsRequired<WRDAttributeTypeId.File>;
  };



  const sel1a = ["a"] as const;
  const sel1b: Array<"a"> = ["a"];

  test.eq({ a: "a" }, recordizeOutputMap(sel1a));
  test.eq({ a: "a" }, recordizeOutputMap(sel1b));


  test.eq("a", combineRecordOutputMaps(null, "a"));
  test.eq({ a: "a" }, combineRecordOutputMaps(null, { a: "a" }));
  test.throws(/Cannot combine selects, trying to combine a single field with another single field/, () => combineRecordOutputMaps("a", "a"));
  test.throws(/Cannot combine selects, trying to combine a single field with a map/, () => combineRecordOutputMaps("a", { a: "a" }));
  test.throws(/Cannot combine selects, trying to combine a map with another single field/, () => combineRecordOutputMaps({ a: "a" }, "a"));

  const stringselect = ["wrd_id", "wrdTitle", "whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements", "requiredFile", "requiredImage"] as const;
  void stringselect;

  test.typeAssert<test.Equals<{
    wrd_id: number;
    wrdTitle: string;
    whuser_disabled: boolean;
    whuser_comment: string;
    invented_domain: number | null;
    whuser_unit: number;
    whuser_hiddenannouncements: number[];
    requiredFile: ResourceDescriptor;
    requiredImage: ResourceDescriptor;
  }, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, false>>>();


  test.typeAssert<test.Equals<{
    wrd_id: number;
    wrdTitle: string;
    whuser_disabled: boolean;
    whuser_comment: string;
    invented_domain: string | null;
    whuser_unit: string;
    whuser_hiddenannouncements: string[];
    requiredFile: ResourceDescriptor;
    requiredImage: ResourceDescriptor;
  }, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>>>();

  const recordselect = { wrd_id: "wrd_id", rec: { wrdTitle: "wrdTitle" }, arr: ["whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements", "requiredFile", "requiredImage"] } as const;
  void recordselect;

  test.typeAssert<test.Equals<{
    wrd_id: number;
    rec: {
      wrdTitle: string;
    };
    arr: {
      whuser_disabled: boolean;
      whuser_comment: string;
      whuser_unit: number;
      invented_domain: number | null;
      whuser_hiddenannouncements: number[];
      requiredFile: ResourceDescriptor;
      requiredImage: ResourceDescriptor;
    };
  }, MapOutput<System_Usermgmt_WRDPerson, typeof recordselect, false>>>();

  test.typeAssert<test.Equals<{
    wrd_id: number;
    rec: {
      wrdTitle: string;
    };
    arr: {
      whuser_disabled: boolean;
      whuser_comment: string;
      whuser_unit: string;
      invented_domain: string | null;
      whuser_hiddenannouncements: string[];
      requiredFile: ResourceDescriptor;
      requiredImage: ResourceDescriptor;
    };
  }, MapOutput<System_Usermgmt_WRDPerson, typeof recordselect, true>>>();

  type GenericWRDTypeDef = Record<string, WRDAttributeTypeId.Integer>;

  test.typeAssert<test.Equals<{
    a: "a";
    b: { c: "c" };
    d: {
      e: "e";
    };
  }, RecordizeOutputMap<GenericWRDTypeDef, { a: "a"; b: { c: "c" }; d: ["e"] }>>>();

  test.typeAssert<test.Equals<{
    a: number;
    b: { c: number };
    d: {
      e: number;
    };
  }, MapRecordOutputMap<GenericWRDTypeDef, { a: "a"; b: { c: "c" }; d: { e: "e" } }, false | true>>>();

  test.typeAssert<test.Equals<{
    invented_domain?: number | null | undefined;
    whuser_comment?: string | undefined;
    whuser_disabled?: boolean | undefined;
    whuser_disablereason?: string | undefined;
    whuser_hiddenannouncements?: number[] | undefined;
    whuser_lastlogin?: Date | null | undefined;
    wrdCreationDate?: Date | null | undefined;
    wrdDateOfBirth?: Date | null | undefined;
    wrdDateOfDeath?: Date | null | undefined;
    wrdFirstName?: string | undefined;
    wrdFirstNames?: string | undefined;
    wrd_gender?: WRDGender | null | undefined;
    wrd_guid?: string | undefined;
    wrd_id?: number | undefined;
    wrd_infix?: string | undefined;
    wrd_initials?: string | undefined;
    wrdLastName?: string | undefined;
    wrdLimitDate?: Date | null | undefined;
    wrdModificationDate?: Date | undefined;
    wrdTag?: string | undefined;
    wrdTitlesSuffix?: string | undefined;
    wrd_titles?: string | undefined;
    whuser_unit: number;
    requiredFile: ResourceDescriptor | { data: Buffer };
    requiredImage: ResourceDescriptor | { data: Buffer };
  }, WRDInsertable<System_Usermgmt_WRDPerson>>>();
}

test.runTests([testTypes]);
