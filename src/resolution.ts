import type {
  ParsedCaveatDefinition,
  ParsedCaveatParameter,
  ParsedExpression,
  ParsedObjectDefinition,
  ParsedPermission,
  ParsedRelation,
  ParsedRelationRefExpression,
  ParsedSchema,
  TopLevelDefinition,
  TypeRef,
  TextRange,
} from "./dsl";
import { flatMapExpression } from "./dsl";

/**
 * TypeRefResolution is the result of resolving a type reference.
 */
export type TypeRefResolution = {
  /**
   * definition is the definition which is referred by this type reference.
   */
  definition: ParsedObjectDefinition | undefined;

  /**
   * relation is the (optional) relation which is referred by this type reference. For refs
   * without relations, this will be undefined. This will *also* be undefined for unresolvable
   * refs, so make sure to check the expression to see if it has a relation reference.
   */
  relation: ParsedRelation | undefined;

  /**
   * permission is the (optional) permission which is referred by this type reference. For refs
   * without relations, this will be undefined. This will *also* be undefined for unresolvable
   * refs, so make sure to check the expression to see if it has a relation reference.
   */
  permission: ParsedPermission | undefined;
};

/**
 * ExpressionResolution is the resolution of a reference in a permission expression.
 */
export type ExpressionResolution = ParsedRelation | ParsedPermission;

/**
 * ResolvedTypeReference is a type reference found in the schema, with resolution attempted.
 */
export type ResolvedTypeReference = {
  kind: "type";
  reference: TypeRef;
  referencedTypeAndRelation: TypeRefResolution | undefined;
};

/**
 * ResolvedExprReference is a relation reference expression found in the schema, with resolution attempted.
 */
export type ResolvedExprReference = {
  kind: "expression";
  reference: ParsedRelationRefExpression;
  resolvedRelationOrPermission: ExpressionResolution | undefined;
};

/**
 * ResolvedReference is a found and resolution performed type reference or expression.
 */
export type ResolvedReference = ResolvedTypeReference | ResolvedExprReference;

/**
 * Resolver is a helper class for easily resolving information in a parsed schema.
 */
export class Resolver {
  private definitionsByName: Record<string, ResolvedDefinition> = {};
  private caveatsByName: Record<string, ResolvedCaveatDefinition> = {};
  private populated = false;
  public schema: ParsedSchema = {
    kind: "schema",
    stringValue: "",
    definitions: [],
  };

  constructor(schema: ParsedSchema) {
    this.schema = schema;
  }

  private populate() {
    if (this.populated) {
      return;
    }

    this.schema.definitions.forEach((def: TopLevelDefinition) => {
      if (def.kind === "objectDef") {
        this.definitionsByName[def.name] = new ResolvedDefinition(def);
        return;
      }

      if (def.kind === "caveatDef") {
        this.caveatsByName[def.name] = new ResolvedCaveatDefinition(def);
        return;
      }
    });
    this.populated = true;
  }

  /**
   * listDefinitions lists all definitions in the resolver.
   */
  public listDefinitions(): Array<ResolvedDefinition> {
    this.populate();
    return Object.values(this.definitionsByName);
  }

  /**
   * lookupDefinition returns the definition with the given name, if any, or undefined
   * if none.
   */
  public lookupDefinition(name: string): ResolvedDefinition | undefined {
    this.populate();

    if (!(name in this.definitionsByName)) {
      return undefined;
    }

    return this.definitionsByName[name];
  }

  /**
   * listCaveats returns all resolved caveat definitions in the schema.
   */
  public listCaveats(): Array<ResolvedCaveatDefinition> {
    this.populate();
    return Object.values(this.caveatsByName);
  }

  /**
   * resolvedReferences returns all the resolved type and expression references in the schema.
   */
  public resolvedReferences(): Array<ResolvedReference> {
    this.populate();

    const refs = [
      ...this.lookupAndResolveTypeReferences(),
      ...this.lookupAndResolveExprReferences(),
    ];
    refs.sort((a: ResolvedReference, b: ResolvedReference) => {
      return (
        a.reference.range.startIndex.offset -
        b.reference.range.startIndex.offset
      );
    });
    return refs;
  }

  /**
   * resolveTypeReference attempts to resolve a type reference.
   */
  public resolveTypeReference(typeRef: TypeRef): TypeRefResolution | undefined {
    this.populate();

    if (!(typeRef.path in this.definitionsByName)) {
      return undefined;
    }

    const definition = this.definitionsByName[typeRef.path];
    if (!definition) {
      return undefined;
    }
    if (!typeRef.relationName) {
      return {
        definition: definition.definition,
        relation: undefined,
        permission: undefined,
      };
    }

    return {
      definition: definition.definition,
      relation: definition.lookupRelation(typeRef.relationName),
      permission: definition.lookupPermission(typeRef.relationName),
    };
  }

  /**
   * resolveRelationOrPermission attempts to resolve a relation reference expression.
   */
  public resolveRelationOrPermission(
    current: ParsedRelationRefExpression,
    def: TopLevelDefinition,
  ): ExpressionResolution | undefined {
    this.populate();
    if (def.kind === "use" || def.kind === "import") {
      return undefined;
    }

    const definition = this.definitionsByName[def.name];
    if (!definition) {
      return undefined;
    }
    return definition.lookupRelationOrPermission(current.relationName);
  }

  private lookupAndResolveTypeReferences(): Array<ResolvedTypeReference> {
    this.populate();
    return this.schema.definitions.flatMap((def: TopLevelDefinition) => {
      if (def.kind !== "objectDef") {
        return [];
      }

      return def.relations.flatMap((rel: ParsedRelation) => {
        return rel.allowedTypes.types.map((typeRef: TypeRef) => {
          return {
            kind: "type",
            reference: typeRef,
            referencedTypeAndRelation: this.resolveTypeReference(typeRef),
          };
        });
      });
    });
  }

  private lookupAndResolveExprReferences(): Array<ResolvedExprReference> {
    this.populate();
    return this.schema.definitions.flatMap((def: TopLevelDefinition) => {
      if (def.kind !== "objectDef") {
        return [];
      }

      return def.permissions.flatMap((perm: ParsedPermission) => {
        return flatMapExpression<ResolvedExprReference>(
          perm.expr,
          (current: ParsedExpression) => {
            switch (current.kind) {
              case "relationref":
                return {
                  kind: "expression",
                  reference: current,
                  resolvedRelationOrPermission:
                    this.resolveRelationOrPermission(current, def),
                };

              default:
                return undefined;
            }
          },
        );
      });
    });
  }
}

export class ResolvedDefinition {
  private relationsByName: Record<string, ParsedRelation> = {};
  private permissionByName: Record<string, ParsedPermission> = {};
  public definition: ParsedObjectDefinition = {
    kind: "objectDef",
    name: "",
    relations: [],
    permissions: [],
    partialReferences: [],
    range: emptyRange,
  };

  constructor(definition: ParsedObjectDefinition) {
    definition.permissions.forEach((perm: ParsedPermission) => {
      this.permissionByName[perm.name] = perm;
    });
    definition.relations.forEach((rel: ParsedRelation) => {
      this.relationsByName[rel.name] = rel;
    });
    this.definition = definition;
  }

  public listRelationNames(): Array<string> {
    return Object.keys(this.relationsByName);
  }

  public listRelations(): Array<ParsedRelation> {
    return Object.values(this.relationsByName);
  }

  public listRelationsAndPermissions(): Array<
    ParsedRelation | ParsedPermission
  > {
    return [
      ...Object.values(this.relationsByName),
      ...Object.values(this.permissionByName),
    ];
  }

  public listRelationsAndPermissionNames(): Array<string> {
    return Array.from(
      new Set<string>([
        ...Object.keys(this.relationsByName),
        ...Object.keys(this.permissionByName),
      ]),
    );
  }

  public listWithCaveatNames(): Array<string> {
    const withCaveats = Object.values(this.relationsByName).filter((rel) => {
      return rel.allowedTypes.types.find((ref) => ref.withCaveat);
    });

    const names: Array<string> = [];
    withCaveats.forEach((rel) => {
      rel.allowedTypes.types.forEach((ref) => {
        if (ref.withCaveat) {
          names.push(ref.withCaveat.path);
        }
      });
    });
    return names;
  }

  public lookupRelation(name: string): ParsedRelation | undefined {
    if (!(name in this.relationsByName)) {
      return undefined;
    }

    return this.relationsByName[name];
  }

  public lookupPermission(name: string): ParsedPermission | undefined {
    if (!(name in this.permissionByName)) {
      return undefined;
    }

    return this.permissionByName[name];
  }

  public lookupRelationOrPermission(
    name: string,
  ): ParsedRelation | ParsedPermission | undefined {
    const rel = this.lookupRelation(name);
    if (rel) {
      return rel;
    }

    return this.lookupPermission(name);
  }
}

export class ResolvedCaveatDefinition {
  private paramsByName: Record<string, ParsedCaveatParameter> = {};
  private name: string;
  public definition: ParsedCaveatDefinition = {
    kind: "caveatDef",
    name: "",
    parameters: [],
    expression: {
      kind: "caveatExpr",
      range: emptyRange,
    },
    range: emptyRange,
  };

  constructor(definition: ParsedCaveatDefinition) {
    definition.parameters.forEach((param: ParsedCaveatParameter) => {
      this.paramsByName[param.name] = param;
    });
    this.name = definition.name;
  }

  public getName(): string {
    return this.name;
  }

  public listParameterNames(): Array<string> {
    return Object.keys(this.paramsByName);
  }
}

const emptyRange: TextRange = {
  startIndex: {
    offset: 0,
    line: 0,
    column: 0,
  },
  endIndex: {
    offset: 0,
    line: 0,
    column: 0,
  },
};
