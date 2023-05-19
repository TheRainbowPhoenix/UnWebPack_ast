import { NodePath } from "@babel/traverse";
import { FunctionExpression } from "@babel/types";

export default interface Module {
  file: any; // FIXME !!
  element: NodePath<FunctionExpression>;
  i: number;
  deps: number[];
}
