import { iterableFirst, mapFilter, iterableSome, iterableReduce } from "collection-utils";

import { PrimitiveType } from "../Type";
import { stringTypesForType } from "../TypeUtils";
import { TypeGraph, TypeRef } from "../TypeGraph";
import { GraphRewriteBuilder } from "../GraphRewriting";
import { assert, defined } from "../support/Support";
import { emptyTypeAttributes } from "../TypeAttributes";
import { StringTypes } from "../StringTypes";
import { RunContext } from "../Run";

const MIN_LENGTH_FOR_ENUM = 10;

function shouldBeEnum(enumCases: ReadonlyMap<string, number>): boolean {
    const keys = Array.from(enumCases.keys());
    assert(keys.length > 0, "How did we end up with zero enum cases?");

    if (keys.length === 1 && keys[0] === "") return false;

    const someCaseIsNotNumber = iterableSome(keys, key => /^(\-|\+)?[0-9]+(\.[0-9]+)?$/.test(key) === false);
    const numValues = iterableReduce(enumCases.values(), 0, (a, b) => a + b);
    return numValues >= MIN_LENGTH_FOR_ENUM && enumCases.size < Math.sqrt(numValues) && someCaseIsNotNumber;
}

export type EnumInference = "none" | "all" | "infer";

export function expandStrings(ctx: RunContext, graph: TypeGraph, inference: EnumInference): TypeGraph {
    const stringTypeMapping = ctx.stringTypeMapping;

    function replaceString(
        group: ReadonlySet<PrimitiveType>,
        builder: GraphRewriteBuilder<PrimitiveType>,
        forwardingRef: TypeRef
    ): TypeRef {
        assert(group.size === 1);
        const t = defined(iterableFirst(group));
        const stringTypes = stringTypesForType(t);
        const attributes = mapFilter(t.getAttributes(), a => a !== stringTypes);
        const mappedStringTypes = stringTypes.applyStringTypeMapping(stringTypeMapping);

        if (!mappedStringTypes.isRestricted) {
            return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
        }

        const types: TypeRef[] = [];
        const cases = defined(mappedStringTypes.cases);
        if (cases.size > 0) {
            if (inference === "all" || (inference === "infer" && shouldBeEnum(cases))) {
                types.push(builder.getEnumType(emptyTypeAttributes, new Set(cases.keys())));
            } else {
                return builder.getStringType(attributes, StringTypes.unrestricted, forwardingRef);
            }
        }
        types.push(...Array.from(mappedStringTypes.transformations).map(k => builder.getPrimitiveType(k)));
        assert(types.length > 0, "We got an empty string type");
        return builder.getUnionType(attributes, new Set(types), forwardingRef);
    }

    const allStrings = Array.from(graph.allTypesUnordered())
        .filter(t => t.kind === "string" && stringTypesForType(t as PrimitiveType).isRestricted)
        .map(t => [t]) as PrimitiveType[][];
    return graph.rewrite(
        "expand strings",
        stringTypeMapping,
        false,
        allStrings,
        ctx.debugPrintReconstitution,
        replaceString
    );
}
