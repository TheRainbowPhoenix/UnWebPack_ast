import type { NodePath } from "npm:@babel/traverse";
import type { FunctionExpression } from "npm:@babel/types";

export default interface Module {
  file: any; // FIXME !!
  element: NodePath<FunctionExpression>;
  i: number;
  deps: number[];
}