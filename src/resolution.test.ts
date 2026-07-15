import { describe, expect, it } from "vitest";
import { parse } from "./dsl";
import { Resolver } from "./resolution";

// Takes an expression as an argument and throws if that assertion fails, providing
// typescript narrowing in a statement.
function assert(val: unknown, msg = "Assertion failed"): asserts val {
  if (!val) throw new Error(msg);
}

describe("resolution", () => {
  it("resolves a permission type annotation as a type reference", () => {
    const schema = `definition user {}
definition document {
  relation viewer: user
  permission view: user = viewer
}`;
    const result = parse(schema);
    assert(!result.error);
    assert(result.schema);

    const resolver = new Resolver(result.schema);
    const refs = resolver.resolvedReferences();

    // Two type references: the relation's `user` and the annotation's `user`.
    const typeRefs = refs.filter((r) => r.kind === "type");
    expect(typeRefs).toHaveLength(2);
    for (const ref of typeRefs) {
      expect(ref.reference.path).toEqual("user");
      assert(ref.referencedTypeAndRelation);
      expect(ref.referencedTypeAndRelation.definition?.name).toEqual("user");
    }

    // The compute expression reference `viewer` still resolves to the relation.
    const exprRefs = refs.filter((r) => r.kind === "expression");
    expect(exprRefs).toHaveLength(1);
    const exprRef = exprRefs[0];
    assert(exprRef);
    expect(exprRef.reference.relationName).toEqual("viewer");
    expect(exprRef.resolvedRelationOrPermission?.kind).toEqual("relation");
  });

  it("marks an unknown annotation type as unresolved", () => {
    const schema = `definition document {
  permission view: nonexistent = editor
}`;
    const result = parse(schema);
    assert(!result.error);
    assert(result.schema);

    const resolver = new Resolver(result.schema);
    const typeRefs = resolver
      .resolvedReferences()
      .filter((r) => r.kind === "type");
    expect(typeRefs).toHaveLength(1);

    const ref = typeRefs[0];
    assert(ref);
    expect(ref.reference.path).toEqual("nonexistent");
    expect(ref.referencedTypeAndRelation).toBeUndefined();
  });
});
