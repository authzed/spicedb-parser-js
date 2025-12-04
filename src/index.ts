export { parse, parseSchema, findReferenceNode } from "./dsl";
export type {
  TextRange,
  ParsedSchema,
  ParsedRelation,
  ParsedPermission,
  ParsedObjectDefinition,
  ParsedArrowExpression,
  ParsedBinaryExpression,
  ParsedExpression,
  ParsedRelationRefExpression,
  TypeRef,
} from "./dsl";
export { ResolvedDefinition, Resolver } from "./resolution";
export type { ResolvedReference, ResolvedCaveatDefinition } from "./resolution";
