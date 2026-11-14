// The positions of a read's output marked with `fileRef()` (ADR 0028): a download serves only a file the read
// returned at one of them. The output schema is walked beside the value it validated, through objects, arrays,
// optional, nullable, defaulted and read-only values; any other shape is not walked, and a file inside it is not
// found.
import { isFileRef } from "@domus/module-sdk/contracts";

/** The part of a zod schema's definition this walk reads. */
interface Definition {
	readonly type?: string;
	readonly shape?: Readonly<Record<string, unknown>>;
	readonly element?: unknown;
	readonly innerType?: unknown;
}

/** The ids of the files `value`, a read's validated output, holds at positions `schema` marks with `fileRef()`. */
export function markedFiles(schema: unknown, value: unknown): string[] {
	const found: string[] = [];
	walk(schema, value, found);
	return found;
}

function walk(schema: unknown, value: unknown, found: string[]): void {
	if (value === undefined || value === null) return;
	if (isFileRef(schema)) {
		const { id } = value as { readonly id?: unknown };
		if (typeof id === "string") found.push(id);
		return;
	}
	const definition = definitionOf(schema);
	switch (definition?.type) {
		case "object":
			if (typeof value !== "object") return;
			for (const [key, inner] of Object.entries(definition.shape ?? {}))
				walk(inner, (value as Record<string, unknown>)[key], found);
			return;
		case "array":
			if (!Array.isArray(value)) return;
			for (const item of value) walk(definition.element, item, found);
			return;
		case "optional":
		case "nullable":
		case "default":
		case "readonly":
			walk(definition.innerType, value, found);
			return;
		default:
	}
}

function definitionOf(schema: unknown): Definition | undefined {
	if (typeof schema !== "object" || schema === null || !("_zod" in schema)) return undefined;
	return (schema as { readonly _zod: { readonly def: Definition } })._zod.def;
}
