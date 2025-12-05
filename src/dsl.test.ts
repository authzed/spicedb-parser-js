import { describe, expect, it } from "vitest";
import { parseSchema } from "./dsl";

// Takes an expression as an argument and throws if that assertion fails.
// This primarily exists to provide typescript narrowing in a statement,
// rather than needing to narrow with an if/switch
export function assert(val: unknown, msg = "Assertion failed"): asserts val {
  if (!val) throw new Error(msg);
}

describe("parsing", () => {
  it("parses empty schema", () => {
    const schema = ``;
    const parsed = parseSchema(schema);

    expect(parsed?.definitions.length).toEqual(0);
  });

  describe("use flags", () => {
    it("parses use flag", () => {
      const schema = `use expiration`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);
      const useFlag = parsed?.definitions[0];
      assert(useFlag);
      assert(useFlag.kind === "use");
      expect(useFlag.featureName).toEqual("expiration");
    });

    it("parses use flag and definition", () => {
      const schema = `use expiration

definition foo {}
`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(2);
    });
  });

  describe("definitions", () => {
    it("parses empty definition", () => {
      const schema = `definition foo {}`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.name).toEqual("foo");
    });

    it("parses empty definition with multiple path segements", () => {
      const schema = `definition foo/bar/baz {}`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.name).toEqual("foo/bar/baz");
    });

    it("parses basic caveat", () => {
      const schema = `caveat foo (someParam string, anotherParam int) { someParam == 42 }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);
      const caveat = parsed?.definitions[0];
      assert(caveat);
      assert(caveat.kind === "caveatDef");
      expect(caveat.name).toEqual("foo");

      expect(caveat.parameters.map((p) => p.name)).toEqual([
        "someParam",
        "anotherParam",
      ]);
    });

    it("parses caveat with generic parameter type", () => {
      const schema = `caveat foo (someParam string, anotherParam map<int>) {
      someParam == 'hi' 
    }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);
      const caveat = parsed?.definitions[0];
      assert(caveat);
      assert(caveat.kind === "caveatDef");
      expect(caveat.name).toEqual("foo");
      expect(caveat.parameters.map((p) => p.name)).toEqual([
        "someParam",
        "anotherParam",
      ]);
    });

    it("parses empty definition with path", () => {
      const schema = `definition foo/bar {}`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.name).toEqual("foo/bar");
    });

    it("parses multiple definitions", () => {
      const schema = `definition foo {}
        
        definition bar {}`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions).toHaveLength(2);
      const definitionOne = parsed?.definitions[0];
      assert(definitionOne);
      assert(definitionOne.kind === "objectDef");

      expect(definitionOne.name).toEqual("foo");

      const definitionTwo = parsed.definitions[1];
      assert(definitionTwo);
      assert(definitionTwo.kind === "objectDef");
      expect(definitionTwo.name).toEqual("bar");
    });

    it("parses relation with expiration", () => {
      const schema = `
    use expiration

    definition foo {
      relation viewer: user with expiration
    }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(2);
    });

    it("parses relation with caveat and expiration", () => {
      const schema = `
    use expiration

    definition foo {
      relation viewer: user with somecaveat and expiration
    }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(2);
    });

    it("parses definition with relation", () => {
      const schema = `definition foo {
            relation barrel: something;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(1);

      const relation = definition.relations[0];
      assert(relation);
      expect(relation.name).toEqual("barrel");
      expect(relation.allowedTypes.types.length).toEqual(1);
      assert(relation.allowedTypes.types[0]);
      expect(relation.allowedTypes.types[0].path).toEqual("something");
    });

    it("parses definition with caveated relation", () => {
      const schema = `definition foo {
            relation barrel: something with somecaveat;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(1);

      const relation = definition.relations[0];
      assert(relation);
      expect(relation.name).toEqual("barrel");
      expect(relation.allowedTypes.types.length).toEqual(1);
      assert(relation.allowedTypes.types[0]);
      expect(relation.allowedTypes.types[0].path).toEqual("something");

      expect(relation.allowedTypes.types[0].withCaveat?.path).toEqual(
        "somecaveat",
      );
    });

    it("parses definition with prefixed caveated relation", () => {
      const schema = `definition foo {
            relation barrel: something with test/somecaveat;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(1);

      const relation = definition.relations[0];
      assert(relation);
      expect(relation.name).toEqual("barrel");
      expect(relation.allowedTypes.types.length).toEqual(1);
      assert(relation.allowedTypes.types[0]);
      expect(relation.allowedTypes.types[0].path).toEqual("something");

      expect(relation.allowedTypes.types[0].withCaveat?.path).toEqual(
        "test/somecaveat",
      );
    });

    it("parses definition with subject wildcard type", () => {
      const schema = `definition foo {
            relation barrel: something:*;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(1);

      const relation = definition.relations[0];
      assert(relation);
      expect(relation.name).toEqual("barrel");
      expect(relation.allowedTypes.types.length).toEqual(1);
      assert(relation.allowedTypes.types[0]);
      expect(relation.allowedTypes.types[0].path).toEqual("something");
      expect(relation.allowedTypes.types[0].relationName).toEqual(undefined);
      expect(relation.allowedTypes.types[0].wildcard).toEqual(true);
    });

    it("parses definition with subject rel type", () => {
      const schema = `definition foo {
            relation barrel: something#foo;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(1);

      const relation = definition.relations[0];
      assert(relation);
      expect(relation.name).toEqual("barrel");
      expect(relation.allowedTypes.types.length).toEqual(1);
      assert(relation.allowedTypes.types[0]);
      expect(relation.allowedTypes.types[0].path).toEqual("something");
      expect(relation.allowedTypes.types[0].relationName).toEqual("foo");
    });

    it("parses definition with relation with multiple types", () => {
      const schema = `definition foo {
            relation barrel: something | somethingelse | thirdtype;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(1);

      const relation = definition.relations[0];
      assert(relation);
      expect(relation.name).toEqual("barrel");
      expect(relation.allowedTypes.types.length).toEqual(3);
      assert(relation.allowedTypes.types[0]);
      expect(relation.allowedTypes.types[0].path).toEqual("something");
      assert(relation.allowedTypes.types[1]);
      expect(relation.allowedTypes.types[1].path).toEqual("somethingelse");
      assert(relation.allowedTypes.types[2]);
      expect(relation.allowedTypes.types[2].path).toEqual("thirdtype");
    });

    it("parses definition with multiple relations", () => {
      const schema = `definition foo {
            relation first: something
            relation second: somethingelse
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(2);

      const first = definition.relations[0];
      assert(first);
      expect(first.name).toEqual("first");
      expect(first.allowedTypes.types.length).toEqual(1);
      assert(first.allowedTypes.types[0]);
      expect(first.allowedTypes.types[0].path).toEqual("something");

      const second = definition.relations[1];
      assert(second);
      expect(second.name).toEqual("second");
      expect(second.allowedTypes.types.length).toEqual(1);
      assert(second.allowedTypes.types[0]);
      expect(second.allowedTypes.types[0].path).toEqual("somethingelse");
    });

    it("parses definition with a permission", () => {
      const schema = `definition foo {
          permission first = someexpr;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(0);
      expect(definition.permissions.length).toEqual(1);

      const permission = definition.permissions[0];
      assert(permission);
      expect(permission.name).toEqual("first");
    });

    it("parses definition with associativity matching the schema parser in Go", () => {
      const schema = `definition foo {
          permission first = a - b + c
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(0);
      expect(definition.permissions.length).toEqual(1);

      const permission = definition.permissions[0];
      assert(permission);
      expect(permission.name).toEqual("first");

      const binExpr = permission.expr;
      assert(binExpr.kind === "binary");
      expect(binExpr.operator).toEqual("exclusion");

      const leftExpr = binExpr.left;
      assert(leftExpr.kind === "relationref");
      expect(leftExpr.relationName).toEqual("a");
    });

    it("parses definition with a complex permission", () => {
      const schema = `definition foo {
          permission first = ((a - b) + nil) & d;
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("foo");
      expect(definition.relations.length).toEqual(0);
      expect(definition.permissions.length).toEqual(1);

      const permission = definition.permissions[0];
      assert(permission);
      expect(permission.name).toEqual("first");

      // TODO: refactor these to use assertions..
      const binExpr = permission.expr;
      assert(binExpr.kind === "binary");
      expect(binExpr.operator).toEqual("intersection");

      const leftExpr = binExpr.left;
      assert(leftExpr.kind === "binary");
      expect(leftExpr.operator).toEqual("union");

      const leftLeftExpr = leftExpr.left;
      assert(leftLeftExpr.kind === "binary");

      const leftLeftLeftExpr = leftLeftExpr.left;
      assert(leftLeftLeftExpr.kind === "relationref");
      expect(leftLeftLeftExpr.relationName).toEqual("a");

      const rightLeftLeftExpr = leftLeftExpr.right;
      assert(rightLeftLeftExpr.kind === "relationref");
      expect(rightLeftLeftExpr.relationName).toEqual("b");

      const rightLeftExpr = leftExpr.right;
      assert(rightLeftExpr.kind === "nil");
      expect(rightLeftExpr.isNil).toEqual(true);

      const rightExpr = binExpr.right;
      assert(rightExpr.kind === "relationref");
      expect(rightExpr.relationName).toEqual("d");
    });

    it("parses definition with multiple permissions", () => {
      const schema = `definition foo {
          permission first = firstrel
          permission second = secondrel
        }`;
      const parsed = parseSchema(schema);

      expect(parsed?.definitions.length).toEqual(1);

      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef")
      expect(definition.name).toEqual("foo");
      expect(definition.relations).toHaveLength(0);
      expect(definition.permissions).toHaveLength(2);

      const first = definition.permissions[0];
      assert(first);
      expect(first.name).toEqual("first");

      const firstExpr = first.expr;
      assert(firstExpr.kind === "relationref");
      expect(firstExpr.relationName).toEqual("firstrel");

      const second = definition.permissions[1];
      assert(second);
      expect(second.name).toEqual("second");

      const secondExpr = second.expr;
      assert(secondExpr.kind === "relationref");
      expect(secondExpr.relationName).toEqual("secondrel");
    });
  });

  describe("partial syntax", () => {
    it("parses a basic partial", () => {
    const schema = `partial thing {
relation user: user
permission view = user
}`
    const parsed = parseSchema(schema)
    expect(parsed?.definitions).toHaveLength(1)
      const partial = parsed?.definitions[0];
      assert(partial);
    assert(partial.kind === "partial")
    expect(partial.name).toEqual("thing")
    expect(partial.relations).toHaveLength(1)
    expect(partial.permissions).toHaveLength(1)

    const relation = partial.relations[0]
    assert(relation)
    expect(relation.name).toEqual("user")

    const permission = partial.permissions[0]
    assert(permission)
    expect(permission.name).toEqual("view")
    })
    it("parses a basic partial reference", () => {
    const schema = `definition thing {
...some_partial
}`
    const parsed = parseSchema(schema)
    expect(parsed?.definitions).toHaveLength(1)
      const definition = parsed?.definitions[0];
      assert(definition);
    assert(definition.kind === "objectDef")
      expect(definition.partialReferences).toHaveLength(1)
      assert(definition.partialReferences[0])
      expect(definition.partialReferences[0].name).toEqual("some_partial")
    })
    // TODO: more tests here
  })

  describe("full schemas", () => {
    it("full", () => {
      const schema = `use expiration    
        definition user {}

        caveat somecaveat(somecondition int) {
          somecondition == 42
        }    

        /**
         * a document
         */
        definition document {
          relation writer: user
          relation reader: user | user with somecaveat | user with expiration | user with somecaveat and expiration

          permission writer = writer
          permission read = reader + writer // has both
        }`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(4);
    });

    it("full with wildcard", () => {
      const schema = `definition user {}
        
        /**
         * a document
         */
        definition document {
          relation writer: user
          relation reader: user:*

          permission writer = writer
          permission read = reader + writer // has both
        }`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
      const documentDef = parsed?.definitions.find(
        (def) => def.kind === "objectDef" && def.name === "document",
      );
      assert(documentDef);
      assert(documentDef.kind === "objectDef");
      expect(documentDef.relations.length).toEqual(2);
      expect(documentDef.permissions.length).toEqual(2);
    });

    it("full with more comments", () => {
      const schema = `definition user {}
        
        /**
         * a document
         */


        definition document {
          relation writer: user
          relation reader: user

          permission writer = writer
          permission read = reader + writer // has both
        }`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
    });

    it("parses a real example", () => {
      const schema = `definition user {}

        definition collection {
            relation curator: user
            relation editor: user
            relation reader: user
        
            permission delete = curator
            permission rename = curator
            permission read = curator + editor + reader
            permission add_paper = curator + editor
            permission delete_paper = curator
            permission add_comment = curator + editor + reader
            permission share = curator
        }`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
    });

    it("parses an arrow expression", () => {
      const schema = `definition user {}

        definition organization {
            relation admin: user;
        }

        definition document {
            relation reader: user
            relation org: organization

            permission read = reader + org->admin
        }`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(3);

      const definition = parsed?.definitions[2];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("document");
      expect(definition.relations.length).toEqual(2);
      expect(definition.permissions.length).toEqual(1);

      const read = definition.permissions[0];
      assert(read);
      expect(read.name).toEqual("read");

      const expr = read.expr;
      assert(expr.kind === "binary");
      const leftExpr = expr.left;
      assert(leftExpr.kind === "relationref");
      expect(leftExpr.relationName).toEqual("reader");

      const rightExpr = expr.right;
      assert(rightExpr.kind === "arrow");
      expect(rightExpr.sourceRelation.relationName).toEqual("org");
      expect(rightExpr.targetRelationOrPermission).toEqual("admin");
    });

    it("parses a named arrow expression", () => {
      const schema = `definition user {}

        definition organization {
            relation admin: user;
        }

        definition document {
            relation reader: user
            relation org: organization

            permission read = reader + org.any(admin)
        }`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(3);

      const definition = parsed?.definitions[2];
      assert(definition);
      assert("relations" in definition);
      expect(definition.name).toEqual("document");
      expect(definition.relations.length).toEqual(2);
      expect(definition.permissions.length).toEqual(1);

      const read = definition.permissions[0];
      assert(read);
      expect(read.name).toEqual("read");

      const expr = read.expr;
      assert(expr.kind === "binary");
      const leftExpr = expr.left;
      assert(leftExpr.kind === "relationref");
      expect(leftExpr.relationName).toEqual("reader");

      const rightExpr = expr.right;
      assert(rightExpr.kind === "namedarrow");
      expect(rightExpr.sourceRelation.relationName).toEqual("org");
      expect(rightExpr.functionName).toEqual("any");
      expect(rightExpr.targetRelationOrPermission).toEqual("admin");
    });

    it("parses an example with multiple comments", () => {
      const schema = `
       /**
        * This is a user definition
        */
       definition user {}

       /** doc */
       definition document {}`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
    });

    it("parses correctly with synthetic semicolon", () => {
      const schema = `
       definition document {
           permission foo = (first + second)
           permission bar = third
       }
       
       definition user {}
       `;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.permissions.length).toEqual(2);
    });

    it("parses correctly with synthetic semicolon and comment after", () => {
      const schema = `
            definition document {
                relation foo: user
                permission resolve = foo + (bar)   
                // a comment
            }
            
            definition user {}
        `;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions).toHaveLength(2);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.permissions).toHaveLength(1);
      expect(definition.relations).toHaveLength(1);
    });

    it("parses wildcard relation correctly with synthetic semicolon and comment after", () => {
      const schema = `
            definition document {
                relation foo: user:*
                permission resolve = foo + (bar)   
                // a comment
            }
            
            definition user {}
        `;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.permissions.length).toEqual(1);
      expect(definition.relations.length).toEqual(1);
    });

    it("parses correctly with synthetic semicolon and comment before", () => {
      const schema = `
            definition document {
                permission resolve = foo + (bar)   
                // a comment
                permission anotherthing = somethingelse
            }
            
            definition user {}
        `;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
      const definition = parsed?.definitions[0];
      assert(definition);
      assert(definition.kind === "objectDef");
      expect(definition.permissions.length).toEqual(2);
    });

    it("succeeds parsing a valid schema with caveat", () => {
      const schema = `caveat somecaveat(somearg any) {
      somearg.foo().bar
    }

    definition user {}`;

      const parsed = parseSchema(schema);
      expect(parsed?.definitions.length).toEqual(2);
    });
  });
});

describe("parsing fails when", () => {
  it("is missing a definition name", () => {
    const schema = `definition `;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("is missing a definition close", () => {
    const schema = `definition foo {`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("is missing a relation type", () => {
    const schema = `definition foo {
            relation foo
        }`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("is a typeless wildcard", () => {
    const schema = `definition foo {
            relation *
        }`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("is missing a second relation type", () => {
    const schema = `definition foo {
            relation foo: bar |
        }`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("is missing a permission expression", () => {
    const schema = `definition foo {
            relation foo: bar
            permission meh
        }`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("has an empty permission expression", () => {
    const schema = `definition foo {
            relation foo: bar
            permission meh =
        }`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("has an incomplete permission expression", () => {
    const schema = `definition foo {
            relation foo: bar
            permission meh = a +
        }`;
    const parsed = parseSchema(schema);
    expect(parsed).toEqual(undefined);
  });

  it("fails if caveat contains unterminated backtick", () => {
    const schema =
      "caveat foo (someParam string, anotherParam int) { someParam == 42` }";
    const parsed = parseSchema(schema);
    expect(parsed).toBeUndefined();
  });
});
