import * as test from "@webhare/test";
import { type IsGenerated, type IsNonUpdatable, type IsRequired, type WRDBaseAttributeTypeId, type WRDAttributeTypeId, recordizeOutputMap, combineRecordOutputMaps, type OutputMap, type RecordizeOutputMap, type MapRecordOutputMap, type WRDInsertable, type WRDGender, type TypeDefinition, type WRDAttr } from "@webhare/wrd/src/types";
import type { ResourceDescriptor } from "@webhare/services";
import type { ExportedResource } from "@webhare/services/src/descriptor";

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
    transitions: WRDAttr<WRDAttributeTypeId.Array, {
      members: {
        condition: WRDAttributeTypeId.Domain;
      };
    }>;
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

  const stringselect = ["wrd_id", "wrdTitle", "whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements", "requiredFile", "requiredImage", "transitions"] as const;
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
    transitions: Array<{ condition: number | null }>;
  }, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, false>>>();

  type Expect_Export_1 = {
    wrd_id: number;
    wrdTitle: string;
    whuser_disabled: boolean;
    whuser_comment: string;
    invented_domain: string | null;
    whuser_unit: string;
    whuser_hiddenannouncements: string[];
    requiredFile: ExportedResource;
    requiredImage: ExportedResource;
    transitions: Array<{ condition?: string | number | null }>;
  };

  test.typeAssert<test.Equals<Expect_Export_1["wrd_id"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["wrd_id"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["wrdTitle"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["wrdTitle"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["whuser_disabled"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["whuser_disabled"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["whuser_comment"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["whuser_comment"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["invented_domain"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["invented_domain"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["whuser_unit"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["whuser_unit"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["whuser_hiddenannouncements"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["whuser_hiddenannouncements"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["requiredFile"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["requiredFile"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["requiredImage"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["requiredImage"]>>();
  test.typeAssert<test.Equals<Expect_Export_1["transitions"], MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>["transitions"]>>();

  test.typeAssert<test.Equals<Expect_Export_1, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect, true>>>();

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
      requiredFile: ExportedResource;
      requiredImage: ExportedResource;
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

  const transitions: WRDInsertable<System_Usermgmt_WRDPerson>["transitions"] = [];
  //verify we're allowed to push a number inside the array in the domain
  transitions.push({ condition: "wrd-uuid" }, { condition: 5 }, { condition: null });

  type ExpectInsertable = {
    invented_domain?: string | number | null | undefined;
    whuser_comment?: string | undefined;
    whuser_disabled?: boolean | undefined;
    whuser_disablereason?: string | undefined;
    whuser_hiddenannouncements?: Array<number | string> | number[] | undefined;
    whuser_lastlogin?: Date | string | null | undefined;
    wrdCreationDate?: Date | string | null | undefined;
    wrdDateOfBirth?: Date | string | null | undefined;
    wrdDateOfDeath?: Date | string | null | undefined;
    wrdFirstName?: string | undefined;
    wrdFirstNames?: string | undefined;
    wrd_gender?: WRDGender | null | undefined;
    wrd_guid?: string | undefined;
    wrd_id?: number | undefined;
    wrd_infix?: string | undefined;
    wrd_initials?: string | undefined;
    wrdLastName?: string | undefined;
    wrdLimitDate?: Date | string | null | undefined;
    wrdModificationDate?: Date | string | undefined;
    wrdTag?: string | undefined;
    wrdTitlesSuffix?: string | undefined;
    wrd_titles?: string | undefined;
    whuser_unit: string | number;
    requiredFile: ResourceDescriptor | ExportedResource;
    requiredImage: ResourceDescriptor | ExportedResource;
    transitions?: Array<{ condition?: string | number | null }>;
  };

  //Test all the individual props first because a failing toplevel compare (expectinsert vs wrdinsertable) won't point out the broken property
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["invented_domain"], ExpectInsertable["invented_domain"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["whuser_comment"], ExpectInsertable["whuser_comment"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["whuser_disabled"], ExpectInsertable["whuser_disabled"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["whuser_disablereason"], ExpectInsertable["whuser_disablereason"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["whuser_hiddenannouncements"], ExpectInsertable["whuser_hiddenannouncements"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["whuser_lastlogin"], ExpectInsertable["whuser_lastlogin"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdCreationDate"], ExpectInsertable["wrdCreationDate"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdDateOfBirth"], ExpectInsertable["wrdDateOfBirth"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdDateOfDeath"], ExpectInsertable["wrdDateOfDeath"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdFirstName"], ExpectInsertable["wrdFirstName"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdFirstNames"], ExpectInsertable["wrdFirstNames"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrd_gender"], ExpectInsertable["wrd_gender"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrd_guid"], ExpectInsertable["wrd_guid"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrd_id"], ExpectInsertable["wrd_id"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrd_infix"], ExpectInsertable["wrd_infix"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrd_initials"], ExpectInsertable["wrd_initials"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdLastName"], ExpectInsertable["wrdLastName"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdLimitDate"], ExpectInsertable["wrdLimitDate"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdModificationDate"], ExpectInsertable["wrdModificationDate"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdTag"], ExpectInsertable["wrdTag"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrdTitlesSuffix"], ExpectInsertable["wrdTitlesSuffix"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["wrd_titles"], ExpectInsertable["wrd_titles"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["whuser_unit"], ExpectInsertable["whuser_unit"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["requiredFile"], ExpectInsertable["requiredFile"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["requiredImage"], ExpectInsertable["requiredImage"]>>();
  test.typeAssert<test.Equals<WRDInsertable<System_Usermgmt_WRDPerson>["transitions"], ExpectInsertable["transitions"]>>();

  test.typeAssert<test.Equals<ExpectInsertable, WRDInsertable<System_Usermgmt_WRDPerson>>>();
}
test.runTests([testTypes]);
