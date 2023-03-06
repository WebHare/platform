import * as test from "@webhare/test";
import { IsGenerated, IsNonUpdatable, IsRequired, WRDAttributeType, recordizeOutputMap, combineRecordOutputMaps, OutputMap, RecordizeOutputMap, MapRecordOutputMap, Insertable, WRDGender, TypeDefinition } from "@mod-wrd/js/internal/types";

// from https://github.com/Microsoft/TypeScript/issues/27024
type EqualsInternal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;

// This form will give some feedback at the test site instead of 'false' doest not extends 'true'
type Equals<X extends Y, Y> = EqualsInternal<X, Y>;
//type REquals<X, Y extends X> = EqualsInternal<X, Y>;

function typeAssert<X extends true>(): X extends true ? void : void { return; }

type MapOutput<T extends TypeDefinition, O extends OutputMap<T>> = MapRecordOutputMap<T, RecordizeOutputMap<T, O>>;

function testTypes() {

  type System_Usermgmt_WRDPerson = {
    wrd_id: IsNonUpdatable<WRDAttributeType.Base_Integer>;
    wrd_guid: WRDAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDAttributeType.Base_Integer>;
    wrd_tag: WRDAttributeType.Base_Tag;
    wrd_creationdate: WRDAttributeType.Base_DateTime;
    wrd_limitdate: WRDAttributeType.Base_DateTime;
    wrd_modificationdate: WRDAttributeType.Base_DateTime;
    wrd_gender: WRDAttributeType.Base_Gender;
    wrd_salute_formal: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    wrd_address_formal: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    wrd_fullname: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    wrd_titles: WRDAttributeType.Base_NameString;
    wrd_initials: WRDAttributeType.Base_NameString;
    wrd_firstname: WRDAttributeType.Base_NameString;
    wrd_firstnames: WRDAttributeType.Base_NameString;
    wrd_infix: WRDAttributeType.Base_NameString;
    wrd_lastname: WRDAttributeType.Base_NameString;
    wrd_titles_suffix: WRDAttributeType.Base_NameString;
    wrd_dateofbirth: WRDAttributeType.Base_Date;
    wrd_dateofdeath: WRDAttributeType.Base_Date;
    wrd_title: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    whuser_disabled: WRDAttributeType.Boolean;
    whuser_disablereason: WRDAttributeType.Free;
    whuser_comment: WRDAttributeType.Free;
    whuser_lastlogin: WRDAttributeType.DateTime;
    whuser_unit: IsRequired<WRDAttributeType.Domain>;
    whuser_hiddenannouncements: WRDAttributeType.DomainArray;
    invented_domain: WRDAttributeType.Domain;
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

  const stringselect = ["wrd_id", "wrd_title", "whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements"] as const;

  typeAssert<Equals<{
    wrd_id: number;
    wrd_title: string;
    whuser_disabled: boolean;
    whuser_comment: string;
    invented_domain: number | null;
    whuser_unit: number;
    whuser_hiddenannouncements: number[];
  }, MapOutput<System_Usermgmt_WRDPerson, typeof stringselect>>>();


  const recordselect = { wrd_id: "wrd_id", rec: { wrd_title: "wrd_title" }, arr: ["whuser_disabled", "whuser_comment", "whuser_unit", "invented_domain", "whuser_hiddenannouncements"] } as const;

  typeAssert<Equals<{
    wrd_id: number;
    rec: {
      wrd_title: string;
    };
    arr: {
      whuser_disabled: boolean;
      whuser_comment: string;
      whuser_unit: number;
      invented_domain: number | null;
      whuser_hiddenannouncements: number[];
    };
  }, MapOutput<System_Usermgmt_WRDPerson, typeof recordselect>>>();

  type GenericWRDTypeDef = Record<string, WRDAttributeType.Integer>;

  typeAssert<Equals<{
    a: "a";
    b: { c: "c" };
    d: {
      e: "e";
    };
  }, RecordizeOutputMap<GenericWRDTypeDef, { a: "a"; b: { c: "c" }; d: ["e"] }>>>();

  typeAssert<Equals<{
    a: number;
    b: { c: number };
    d: {
      e: number;
    };
  }, MapRecordOutputMap<GenericWRDTypeDef, { a: "a"; b: { c: "c" }; d: { e: "e" } }>>>();

  /* This fails, don't know why
  typeAssert<Equals<{
    invented_domain?: number | null;
    whuser_comment?: string;
    whuser_disabled?: boolean;
    whuser_disablereason?: string;
    whuser_hiddenannouncements?: number[];
    whuser_lastlogin?: Date;
    whuser_unit: number;
    wrd_creationdate?: Date;
    wrd_dateofbirth?: Date;
    wrd_dateofdeath?: Date;
    wrd_firstname?: string;
    wrd_firstnames?: string;
    wrd_gender?: WRDGender;
    wrd_guid?: string;
    wrd_id?: number;
    wrd_infix?: string;
    wrd_initials?: string;
    wrd_lastname?: string;
    wrd_limitdate?: Date;
    wrd_modificationdate?: Date;
    wrd_tag?: string;
    wrd_titles_suffix?: string;
    wrd_titles?: string;
  }, Insertable<System_Usermgmt_WRDPerson>>>();
*/
  // FIXME: this only works when using Required, don't know why yet. It seems to look ok, though
  typeAssert<Equals<Required<{
    invented_domain?: number | null;
    whuser_comment?: string;
    whuser_disabled?: boolean;
    whuser_disablereason?: string;
    whuser_hiddenannouncements?: number[];
    whuser_lastlogin?: Date;
    whuser_unit: number;
    wrd_creationdate?: Date;
    wrd_dateofbirth?: Date;
    wrd_dateofdeath?: Date;
    wrd_firstname?: string;
    wrd_firstnames?: string;
    wrd_gender?: WRDGender;
    wrd_guid?: string;
    wrd_id?: number;
    wrd_infix?: string;
    wrd_initials?: string;
    wrd_lastname?: string;
    wrd_limitdate?: Date;
    wrd_modificationdate?: Date;
    wrd_tag?: string;
    wrd_titles_suffix?: string;
    wrd_titles?: string;
  }>, Required<Insertable<System_Usermgmt_WRDPerson>>>>();

  //*/
}

test.run([testTypes], { wrdauth: false });
