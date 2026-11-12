// What only test-utils takes from platform (ADR 0021): the Drizzle client of a module, behind dbFor. A rule of
// .dependency-cruiser.cjs keeps every other importer out; the main entry does not offer it.
export { type ModuleDatabase, moduleDatabase } from "./module-database";
