import type { Parser } from "parsimmon";
import {
  formatError,
  index,
  regex,
  lazy,
  optWhitespace,
  string,
  seqMap,
  newline,
  seq,
  takeWhile,
} from "parsimmon";
import { celExpression } from "./cel";

/**
 * ParseResult is the result of a direct parse.
 */
export type ParseResult = {
  /**
   * error is the parsing error found, if any.
   */
  error: ParseError | undefined;

  /**
   * schema is the fully parsed schema, if no error.
   */
  schema: ParsedSchema | undefined;
};

/**
 * ParseError represents an error raised by the parser.
 */
export type ParseError = {
  /**
   * message is the human-readable error message.
   */
  message: string;

  /**
   * index is the location of the parse error.
   */
  index: Index;

  /**
   * expected is the set of expected regular expression(s) at the index.
   */
  expected: Array<string>;
};

/**
 * parseSchema parses a DSL schema, returning relevant semantic information
 * or undefined if the parse failed.
 */
export const parseSchema = (value: string): ParsedSchema | undefined => {
  const parsed = parse(value);
  if (parsed.error) {
    return undefined;
  }

  return parsed.schema;
};

/**
 * TopLevelDefinition are the types of definitions found at the root of a schema.
 */
export type TopLevelDefinition =
  | ParsedObjectDefinition
  | ParsedCaveatDefinition
  | ParsedPartialDefinition
  | ParsedImportExpression
  | ParsedUseFlag;

/**
 * parse performs a parse on the schema string, returning the full parse result.
 */
export function parse(input: string): ParseResult {
  const result = whitespace.then(topLevel.atLeast(0)).parse(input);
  return {
    error: !result.status
      ? {
          message: formatError(input, result),
          index: result.index,
          expected: result.expected,
        }
      : undefined,
    schema: result.status
      ? {
          kind: "schema",
          stringValue: input,
          definitions: result.value,
        }
      : undefined,
  };
}

/**
 * getCaveatExpression returns the string form of the caveat expression for a particular parsed
 * caveat expression within a schema.
 */
export function getCaveatExpression(
  expr: ParsedCaveatExpression,
  parsed: ParsedSchema,
): string {
  return parsed.stringValue.substring(
    expr.range.startIndex.offset,
    expr.range.endIndex.offset,
  );
}

/**
 * flatMapExpression runs a flat mapping operation over an expression tree, returning any found results.
 */
export function flatMapExpression<T>(
  expr: ParsedExpression,
  walker: ExprWalker<T>,
): Array<T> {
  switch (expr.kind) {
    case "namedarrow":
    // fallthrough

    case "arrow": {
      const arrowResult = walker(expr);
      const childResults = flatMapExpression<T>(expr.sourceRelation, walker);
      return arrowResult ? [...childResults, arrowResult] : childResults;
    }

    case "nil": {
      const nilResult = walker(expr);
      return nilResult ? [nilResult] : [];
    }

    case "relationref": {
      const result = walker(expr);
      return result ? [result] : [];
    }

    case "binary": {
      const binResult = walker(expr);
      const leftResults = flatMapExpression<T>(expr.left, walker);
      const rightResults = flatMapExpression<T>(expr.right, walker);
      return binResult
        ? [...leftResults, ...rightResults, binResult]
        : [...leftResults, ...rightResults];
    }
  }
}

/**
 * ReferenceNode is the node returned by findReferenceNode, along with its parent definition,
 * if any.
 */
export type ReferenceNode = {
  node: ParsedRelationRefExpression | TypeRef | undefined;
  def: TopLevelDefinition;
};

/**
 * findReferenceNode walks the parse tree to find the node matching the given line number and
 * column position.
 */
export function findReferenceNode(
  schema: ParsedSchema,
  lineNumber: number,
  columnPosition: number,
): ReferenceNode | undefined {
  const found = schema.definitions
    .map((def: TopLevelDefinition) => {
      if (!rangeContains(def, lineNumber, columnPosition)) {
        return undefined;
      }

      if (def.kind === "objectDef") {
        return findReferenceNodeInDef(def, lineNumber, columnPosition);
      }
      return undefined;
    })
    .filter((f: ReferenceNode | undefined) => !!f);
  return found.length > 0 ? found[0] : undefined;
}

/**
 * mapParsedSchema runs the given mapper function on every node in the parse tree (except the
 * contents of a caveat, which are considered "opaque").
 */
export function mapParsedSchema(
  schema: ParsedSchema | undefined,
  mapper: (node: ParsedNode) => void,
) {
  if (schema === undefined) {
    return;
  }

  schema.definitions.forEach(mapParseNodes(mapper));
}

////////////////////////////////////////////////////////////////////////////////////////////////////
// Parser node types
////////////////////////////////////////////////////////////////////////////////////////////////////

export type ParsedSchema = {
  kind: "schema";
  stringValue: string;
  // TODO: it may make sense to split uses and imports out.
  definitions: Array<TopLevelDefinition>;
};

export type ParsedUseFlag = {
  kind: "use";
  featureName: string;
  range: TextRange;
};

export type ParsedImportExpression = {
  kind: "import";
  path: string;
  range: TextRange;
};

export type ParsedCaveatDefinition = {
  kind: "caveatDef";
  name: string;
  parameters: Array<ParsedCaveatParameter>;
  expression: ParsedCaveatExpression;
  range: TextRange;
};

export type ParsedCaveatExpression = {
  kind: "caveatExpr";
  range: TextRange;
};

export type ParsedCaveatParameter = {
  kind: "caveatParameter";
  name: string;
  type: ParsedCaveatParameterTypeRef;
  range: TextRange;
};

export type ParsedCaveatParameterTypeRef = {
  kind: "caveatParameterTypeExpr";
  name: string;
  generics: Array<ParsedCaveatParameterTypeRef>;
  range: TextRange;
};

export type ParsedObjectDefinition = {
  kind: "objectDef";
  name: string;
  relations: Array<ParsedRelation>;
  permissions: Array<ParsedPermission>;
  partialReferences: Array<PartialReference>;
  range: TextRange;
};

export type ParsedPartialDefinition = {
  kind: "partial";
  name: string;
  relations: Array<ParsedRelation>;
  permissions: Array<ParsedPermission>;
  partialReferences: Array<PartialReference>;
  range: TextRange;
};

type PartialReference = {
  kind: "partialreference";
  name: string;
  range: TextRange;
};

export type ParsedRelation = {
  kind: "relation";
  name: string;
  allowedTypes: TypeExpr;
  range: TextRange;
};

export type ParsedExpression =
  | ParsedBinaryExpression
  | ParsedRelationRefExpression
  | ParsedArrowExpression
  | ParsedNamedArrowExpression
  | ParsedNilExpression;

export type ParsedArrowExpression = {
  kind: "arrow";
  sourceRelation: ParsedRelationRefExpression;
  targetRelationOrPermission: string;
  range: TextRange;
};

export type ParsedNamedArrowExpression = {
  kind: "namedarrow";
  sourceRelation: ParsedRelationRefExpression;
  functionName: string;
  targetRelationOrPermission: string;
  range: TextRange;
};

export type ParsedRelationRefExpression = {
  kind: "relationref";
  relationName: string;
  range: TextRange;
};

export type ParsedNilExpression = {
  kind: "nil";
  isNil: true;
  range: TextRange;
};

export type ParsedBinaryExpression = {
  kind: "binary";
  operator: "union" | "intersection" | "exclusion";
  left: ParsedExpression;
  right: ParsedExpression;
  range: TextRange;
};

export type ParsedPermission = {
  kind: "permission";
  name: string;
  expr: ParsedExpression;
  range: TextRange;
};

export type DefinitionMember =
  | ParsedRelation
  | ParsedPermission
  | PartialReference;

export type TypeRef = {
  kind: "typeref";
  path: string;
  relationName: string | undefined;
  wildcard: boolean;
  withCaveat: WithCaveat | undefined;
  withExpiration: WithExpiration | undefined;
  range: TextRange;
};

export type WithExpiration = {
  kind: "withexpiration";
  range: TextRange;
};

export type WithCaveat = {
  kind: "withcaveat";
  path: string;
  range: TextRange;
};

export type TypeExpr = {
  kind: "typeexpr";
  types: Array<TypeRef>;
  range: TextRange;
};

export type ParsedNode =
  | ParsedUseFlag
  | ParsedImportExpression
  | ParsedCaveatDefinition
  | ParsedCaveatParameter
  | ParsedCaveatParameterTypeRef
  | ParsedCaveatExpression
  | ParsedObjectDefinition
  | ParsedPartialDefinition
  | ParsedRelation
  | ParsedPermission
  | ParsedExpression
  | TypeRef
  | TypeExpr
  | WithCaveat;

export type Index = {
  offset: number;
  line: number;
  column: number;
};

export type TextRange = {
  startIndex: Index;
  endIndex: Index;
};

export type ExprWalker<T> = (expr: ParsedExpression) => T | undefined;

////////////////////////////////////////////////////////////////////////////////////////////////////
// Parser and utility methods below
////////////////////////////////////////////////////////////////////////////////////////////////////

const singleLineComment = regex(/\/\/.*/).then(optWhitespace.atMost(1));
const multiLineComment = regex(/\/\*((((?!\*\/).)|\r|\n)*)\*\//).then(
  optWhitespace.atMost(1),
);

const comment = singleLineComment.or(multiLineComment);
const whitespace = optWhitespace.then(comment.atLeast(0));
const lexeme = function (p: Parser<string>) {
  return p.skip(whitespace);
};

const identifier = lexeme(regex(/[a-zA-Z_][0-9a-zA-Z_+]*/));
const path = lexeme(
  regex(/([a-zA-Z_][0-9a-zA-Z_+-]*\/)*[a-zA-Z_][0-9a-zA-Z_+-]*/),
);
const colon = lexeme(string(":"));
const equal = lexeme(string("="));
const semicolon = lexeme(string(";"));
const pipe = lexeme(string("|"));

const lbrace = lexeme(string("{"));
const rbrace = lexeme(string("}"));
const lparen = lexeme(string("("));
const rparen = lexeme(string(")"));
const lcaret = lexeme(string("<"));
const rcaret = lexeme(string(">"));
const arrow = lexeme(string("->"));
const hash = lexeme(string("#"));
const comma = lexeme(string(","));
const dot = lexeme(string("."));
const ellipsis = lexeme(string("..."));

const terminator = newline.or(semicolon);

// Take a single or a doublequote,
// consume while the next character isn't that first delimiter,
// then skip that last delimiter
export const stringLiteral = string("'")
  .or(string('"'))
  .chain((delimiter) =>
    takeWhile((c) => c !== delimiter).skip(string(delimiter)),
  );

// Type reference and expression.

const andExpiration = seqMap(
  index,
  seq(lexeme(string("and")), lexeme(string("expiration"))),
  index,
  function (startIndex, _data, endIndex) {
    return {
      kind: "withexpiration",
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const withCaveat: Parser<WithCaveat> = seqMap(
  index,
  seq(lexeme(string("with")), path, andExpiration.atMost(1)),
  index,
  function (startIndex, data, endIndex) {
    return {
      kind: "withcaveat",
      path: data[1],
      withExpiration: data[2],
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const withExpiration: Parser<WithExpiration> = seqMap(
  index,
  seq(lexeme(string("with")), lexeme(string("expiration"))),
  index,
  function (startIndex, _data, endIndex) {
    return {
      kind: "withexpiration",
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const typeRef: Parser<TypeRef> = seqMap(
  index,
  seq(
    seq(path, colon, lexeme(string("*"))).or(
      seq(path, hash.then(identifier).atMost(1)),
    ),
    withCaveat.or(withExpiration).atMost(1),
  ),
  index,
  function (startIndex, data, endIndex) {
    const isWildcard = data[0][2] === "*";
    const withCaveat = data[1].find((trait) => trait.kind === "withcaveat");
    const withExpiration = data[1].find(
      (trait) => trait.kind === "withexpiration",
    );
    return {
      kind: "typeref",
      path: data[0][0],
      relationName: isWildcard ? undefined : data[0][1][0],
      wildcard: isWildcard,
      withCaveat,
      withExpiration,
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const typeExpr: Parser<TypeExpr> = lazy(() => {
  return seqMap(
    index,
    seq(typeRef, pipedTypeExpr.atLeast(0)),
    index,
    function (startIndex, data, endIndex) {
      const remaining = data[1];
      return {
        kind: "typeexpr",
        types: [data[0], ...remaining],
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const pipedTypeExpr = pipe.then(typeRef);

// Permission expression.
// Based on: https://github.com/jneen/parsimmon/blob/93648e20f40c5c0335ac6506b39b0ca58b87b1d9/examples/math.js#L29
const relationReference: Parser<ParsedRelationRefExpression> = lazy(() => {
  return seqMap(
    index,
    seq(identifier),
    index,
    function (startIndex, data, endIndex) {
      return {
        kind: "relationref",
        relationName: data[0],
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const arrowExpr: Parser<ParsedArrowExpression> = lazy(() => {
  return seqMap(
    index,
    seq(relationReference, arrow, identifier),
    index,
    function (startIndex, data, endIndex) {
      return {
        kind: "arrow",
        sourceRelation: data[0],
        targetRelationOrPermission: data[2],
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const namedArrowExpr: Parser<ParsedNamedArrowExpression> = lazy(() => {
  return seqMap(
    index,
    seq(relationReference, dot, identifier, lparen, identifier, rparen),
    index,
    function (startIndex, data, endIndex) {
      return {
        kind: "namedarrow",
        sourceRelation: data[0],
        functionName: data[2],
        targetRelationOrPermission: data[4],
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const nilExpr: Parser<ParsedNilExpression> = lazy(() => {
  return seqMap(
    index,
    string("nil"),
    index,
    function (startIndex, _data, endIndex) {
      return {
        kind: "nil",
        isNil: true,
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const parensExpr = lazy(() =>
  string("(")
    .then(expr)
    .skip(string(")"))
    .or(arrowExpr)
    .or(namedArrowExpr)
    .or(nilExpr)
    .or(relationReference),
);

function BINARY_LEFT(
  operatorsParser: Parser<OperatorType>,
  nextParser: Parser<ParsedExpression>,
) {
  return seqMap(
    nextParser,
    seq(operatorsParser, nextParser).many(),
    (first, rest) => {
      return rest.reduce((acc, ch): ParsedBinaryExpression => {
        const [operator, another] = ch;
        return {
          kind: "binary",
          operator,
          left: acc,
          right: another,
          range: {
            startIndex: acc.range.startIndex,
            endIndex: another.range.endIndex,
          },
        };
      }, first);
    },
  );
}

type OperatorType = "union" | "intersection" | "exclusion";

function operator(operation: OperatorType, symbol: string) {
  return string(symbol).trim(optWhitespace).result(operation);
}

const table = [
  { type: BINARY_LEFT, ops: operator("union", "+") },
  { type: BINARY_LEFT, ops: operator("intersection", "&") },
  { type: BINARY_LEFT, ops: operator("exclusion", "-") },
] as const;

const tableParser: Parser<ParsedExpression> = table.reduce(
  (acc, level) => level.type(level.ops, acc),
  parensExpr,
);

const expr = tableParser.trim(whitespace);

// Definitions members.
const permission: Parser<ParsedPermission> = seqMap(
  index,
  seq(
    lexeme(string("permission")),
    identifier,
    equal.then(expr).skip(terminator.atMost(1)),
  ),
  index,
  function (startIndex, data, endIndex) {
    return {
      kind: "permission",
      name: data[1],
      expr: data[2],
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const relation: Parser<ParsedRelation> = seqMap(
  index,
  seq(
    lexeme(string("relation")),
    identifier,
    colon.then(typeExpr).skip(terminator.atMost(1)),
  ),
  index,
  function (startIndex, [_, name, allowedTypes], endIndex) {
    return {
      kind: "relation",
      name,
      allowedTypes,
      range: { startIndex, endIndex },
    };
  },
);

const partialReference: Parser<PartialReference> = seqMap(
  index,
  seq(ellipsis, identifier, terminator.atMost(1)),
  index,
  function (startIndex, [_, name, __], endIndex) {
    return {
      kind: "partialreference",
      name,
      range: { startIndex, endIndex },
    };
  },
);

const definitionMember: Parser<DefinitionMember> = relation
  .or(permission)
  .or(partialReference);

// Use flags
const useFlag: Parser<ParsedUseFlag> = seqMap(
  index,
  seq(lexeme(string("use")), identifier, terminator.atMost(1)),
  index,
  function (startIndex, [_, featureName, __], endIndex) {
    return {
      kind: "use",
      featureName,
      range: { startIndex, endIndex },
    };
  },
);

// Import expressions
const importExpression: Parser<ParsedImportExpression> = seqMap(
  index,
  seq(lexeme(string("import")), stringLiteral, terminator.atMost(1)),
  index,
  function (startIndex, [_, path, __], endIndex) {
    return {
      kind: "import",
      path,
      range: { startIndex, endIndex },
    };
  },
);

function isRelation(member: DefinitionMember): member is ParsedRelation {
  return member.kind === "relation";
}

function isPermission(member: DefinitionMember): member is ParsedPermission {
  return member.kind === "permission";
}

function isPartialReference(
  member: DefinitionMember,
): member is PartialReference {
  return member.kind === "partialreference";
}

// Object Definitions.
const definition: Parser<ParsedObjectDefinition> = seqMap(
  index,
  seq(
    lexeme(string("definition")),
    path,
    lbrace.then(definitionMember.atLeast(0)).skip(rbrace),
  ),
  index,
  function (startIndex, data, endIndex) {
    const members = data[2];
    return {
      kind: "objectDef",
      name: data[1],
      relations: members.filter(isRelation),
      permissions: members.filter(isPermission),
      partialReferences: members.filter(isPartialReference),
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

// Partial Definitions.
// NOTE: these are parsed the same as definitions.
// TODO: see if this can be combined with objectDef in a sane way
const partial: Parser<ParsedPartialDefinition> = seqMap(
  index,
  seq(
    lexeme(string("partial")),
    path,
    lbrace.then(definitionMember.atLeast(0)).skip(rbrace),
  ),
  index,
  function (startIndex, data, endIndex) {
    const members = data[2];
    return {
      kind: "partial",
      name: data[1],
      relations: members.filter(isRelation),
      permissions: members.filter(isPermission),
      partialReferences: members.filter(isPartialReference),
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

// Caveats.
const caveatParameterTypeExpr: Parser<ParsedCaveatParameterTypeRef> = lazy(
  () => {
    return seqMap(
      index,
      seq(
        identifier,
        lcaret.then(caveatParameterTypeExpr).skip(rcaret).atMost(1),
      ),
      index,
      function (startIndex, data, endIndex) {
        return {
          kind: "caveatParameterTypeExpr",
          name: data[0],
          generics: data[1],
          range: { startIndex: startIndex, endIndex: endIndex },
        };
      },
    );
  },
);

const caveatParameter: Parser<ParsedCaveatParameter> = lazy(() => {
  return seqMap(
    index,
    seq(identifier, caveatParameterTypeExpr),
    index,
    function (startIndex, data, endIndex) {
      return {
        kind: "caveatParameter",
        name: data[0],
        type: data[1],
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const caveatParameters = lazy(() => {
  return seqMap(
    index,
    seq(lparen, caveatParameter, commaedParameter.atLeast(0), rparen),
    index,
    function (startIndex, data, endIndex) {
      const remaining = data[2];
      return {
        kind: "caveatParameters",
        parameters: [data[1], ...remaining],
        range: { startIndex: startIndex, endIndex: endIndex },
      };
    },
  );
});

const commaedParameter = comma.then(caveatParameter);

const caveatExpression: Parser<ParsedCaveatExpression> = seqMap(
  index,
  seq(celExpression),
  index,
  function (startIndex, _data, endIndex) {
    return {
      kind: "caveatExpr",
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const caveat: Parser<ParsedCaveatDefinition> = seqMap(
  index,
  seq(
    lexeme(string("caveat")),
    path,
    caveatParameters,
    lbrace,
    caveatExpression,
    rbrace,
  ),
  index,
  function (startIndex, data, endIndex) {
    return {
      kind: "caveatDef",
      name: data[1],
      parameters: data[2].parameters,
      expression: data[4],
      range: { startIndex: startIndex, endIndex: endIndex },
    };
  },
);

const topLevel = definition
  .or(partial)
  .or(caveat)
  .or(useFlag)
  .or(importExpression);

function findReferenceNodeInDef(
  def: ParsedObjectDefinition,
  lineNumber: number,
  columnPosition: number,
): ReferenceNode | undefined {
  const pFound = def.permissions
    .map((permission: ParsedPermission) => {
      if (!rangeContains(permission, lineNumber, columnPosition)) {
        return undefined;
      }

      return findReferenceNodeInPermission(
        permission,
        lineNumber,
        columnPosition,
      );
    })
    .filter((f: ParsedRelationRefExpression | TypeRef | undefined) => !!f);

  if (pFound.length > 0) {
    return { node: pFound[0], def: def };
  }

  const rFound = def.relations
    .map((relation: ParsedRelation) => {
      if (!rangeContains(relation, lineNumber, columnPosition)) {
        return undefined;
      }

      return findReferenceNodeInRelation(relation, lineNumber, columnPosition);
    })
    .filter((f: ParsedRelationRefExpression | TypeRef | undefined) => !!f);
  if (rFound.length > 0) {
    return { node: rFound[0], def: def };
  }

  return undefined;
}

function findReferenceNodeInPermission(
  permission: ParsedPermission,
  lineNumber: number,
  columnPosition: number,
): ParsedRelationRefExpression | TypeRef | undefined {
  const found = flatMapExpression(permission.expr, (expr: ParsedExpression) => {
    if (!rangeContains(expr, lineNumber, columnPosition)) {
      return undefined;
    }

    switch (expr.kind) {
      case "relationref":
        return expr;
    }

    return undefined;
  });

  return found.length > 0 ? found[0] : undefined;
}

function findReferenceNodeInRelation(
  relation: ParsedRelation,
  lineNumber: number,
  columnPosition: number,
): ParsedRelationRefExpression | TypeRef | undefined {
  const found = relation.allowedTypes.types
    .map((typeRef: TypeRef) => {
      if (!rangeContains(typeRef, lineNumber, columnPosition)) {
        return undefined;
      }

      return typeRef;
    })
    .filter((f: ParsedRelationRefExpression | TypeRef | undefined) => !!f);

  return found.length > 0 ? found[0] : undefined;
}

const mapParseNodes =
  (mapper: (node: ParsedNode) => void) => (node: ParsedNode | undefined) => {
    if (node === undefined) {
      return;
    }

    mapper(node);

    switch (node.kind) {
      case "objectDef":
        node.relations.forEach(mapParseNodes(mapper));
        node.permissions.forEach(mapParseNodes(mapper));
        break;

      case "partial":
        node.relations.forEach(mapParseNodes(mapper));
        node.permissions.forEach(mapParseNodes(mapper));
        break;

      case "caveatDef":
        node.parameters.forEach(mapParseNodes(mapper));
        mapParseNodes(mapper)(node.expression);
        break;

      case "caveatParameter":
        mapParseNodes(mapper)(node.type);
        break;

      case "caveatParameterTypeExpr":
        node.generics.forEach(mapParseNodes(mapper));
        break;

      case "relation":
        mapParseNodes(mapper)(node.allowedTypes);
        break;

      case "permission":
        flatMapExpression(node.expr, mapper);
        break;

      case "typeexpr":
        node.types.forEach(mapParseNodes(mapper));
        break;

      case "typeref":
        mapParseNodes(mapper)(node.withCaveat);
        break;
    }
  };

function rangeContains(
  withRange: { range: TextRange },
  lineNumber: number,
  columnPosition: number,
): boolean {
  if (
    withRange.range.startIndex.line > lineNumber ||
    withRange.range.endIndex.line < lineNumber
  ) {
    return false;
  }

  if (withRange.range.startIndex.line === lineNumber) {
    if (withRange.range.startIndex.column > columnPosition) {
      return false;
    }
  }

  if (withRange.range.endIndex.line === lineNumber) {
    if (withRange.range.endIndex.column < columnPosition) {
      return false;
    }
  }

  return true;
}
