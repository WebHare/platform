/* TODO If you could do it all over again, what would you do ?

   WRD API:

   onze ^ (hat) bestaat niet echt in JS. het lijkt me niet wijs om het te willen repliceren.

   hoe zou de WRD API er uit moeten zien ?

   1 idee: een subobject types in de wrdschema. en daarin de wrdtypes

   - moeten we *alle* getattributeinfo ook meesturen in de describe call, of moet getattributeinfo een await-able iets worden?

   await wrdschema.types.wrd_person.runQuery(
    { outputcolumns: { n: "WRD_LASTNAME" }
    , filters: [{ field: "CONTACT_EMAIL", value: "test123@example.com", matchcase: false }]
    }));

   - moeten we globale WRDSchema runquery behouden of zeggen "joh, performance gaan we toch niet bijzonder veel beter krijgen, doe maar liever Enrich en neem expliciet de aansturing ter hand"
*/

export { openSchema } from "./schema";
export type { WRDSchema } from "./schema";
