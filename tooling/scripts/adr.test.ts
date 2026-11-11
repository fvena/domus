// Keeps the ADRs and their index in step: every ADR is listed in the architecture README, closes with
// its date, and an ADR that refines others is named in each of them ("Precisado por el ADR NNNN").
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const architecture = join(import.meta.dirname, "../../docs/architecture");
const adrDir = join(architecture, "adr");
const files = readdirSync(adrDir).filter((file) => /^\d{4}-.+\.md$/.test(file));
const read = (file: string) => readFileSync(join(adrDir, file), "utf8");
const numberOf = (file: string) => file.slice(0, 4);
const fileOf = (number: string) => files.find((file) => numberOf(file) === number);

describe("ADRs", () => {
	it("are numbered without gaps", () => {
		const numbers = files.map(numberOf).sort();
		expect(numbers).toEqual(numbers.map((_, i) => String(i + 1).padStart(4, "0")));
	});

	it.each(files)("%s has a row in the README index", (file) => {
		const readme = readFileSync(join(architecture, "README.md"), "utf8");
		expect(readme).toContain(`(adr/${file})`);
	});

	it.each(files)("%s closes with its date", (file) => {
		expect(read(file)).toMatch(/^Fecha: \d{4}-\d{2}-\d{2}\. /m);
	});

	it.each(files)("%s is named in every ADR it refines", (file) => {
		const refines = read(file).match(/^Precisa (?:el|los) ADR ([\d ,y]+?)(?: sin| y no|:)/m);
		const numbers = refines?.[1]?.match(/\d{4}/g) ?? [];
		for (const number of numbers) {
			const target = fileOf(number);
			expect(target, `ADR ${number} does not exist`).toBeDefined();
			expect(read(target as string)).toContain(`Precisado por el ADR ${numberOf(file)}`);
		}
	});
});
