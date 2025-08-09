import type { Linter } from "npm:eslint";

/**
 * Deno-friendly ESLint configuration.
 *
 * The original Node.js-specific plugins ('node', 'promise') and environment
 * settings have been removed, as the goal is to produce standard ECMAScript
 * modules that are portable across environments like Deno and modern browsers.
 */
const eslintConfig: Linter.Config = {
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["import"],
  extends: ["eslint:recommended", "plugin:import/recommended"],
  rules: {
    "one-var": ["error", "never"],
    "no-var": "error",
    "prefer-const": [
      "error",
      {
        destructuring: "any",
        ignoreReadBeforeAssign: true,
      },
    ],
    "prefer-arrow-callback": [
      "error",
      {
        allowNamedFunctions: false,
        allowUnboundThis: true,
      },
    ],
    eqeqeq: ["error", "always", { null: "ignore" }],
    semi: ["error", "always"],
    "arrow-body-style": [
      "error",
      "as-needed",
      {
        requireReturnForObjectLiteral: false,
      },
    ],
    "no-confusing-arrow": [
      "error",
      {
        allowParens: true,
      },
    ],
    "eol-last": ["error", "always"],
    indent: [
      "error",
      2,
      {
        SwitchCase: 1,
        VariableDeclarator: 1,
        outerIIFEBody: 1,
        FunctionDeclaration: {
          parameters: 1,
          body: 1,
        },
        FunctionExpression: {
          parameters: 1,
          body: 1,
        },
        CallExpression: {
          arguments: 1,
        },
        ArrayExpression: 1,
        ObjectExpression: 1,
        ImportDeclaration: 1,
        flatTernaryExpressions: false,
        ignoreComments: false,
      },
    ],
    "object-shorthand": [
      "error",
      "always",
      {
        ignoreConstructors: false,
        avoidQuotes: true,
      },
    ],
    "comma-dangle": [
      "error",
      {
        arrays: "always-multiline",
        objects: "always-multiline",
        imports: "always-multiline",
        exports: "always-multiline",
        functions: "always-multiline",
      },
    ],
    "space-before-function-paren": [
      "error",
      {
        anonymous: "always",
        named: "never",
        asyncArrow: "always",
      },
    ],
    curly: ["error", "all"],
    "block-spacing": ["error", "always"],
    "brace-style": ["error", "1tbs", { allowSingleLine: true }],
    yoda: "error",
    "no-trailing-spaces": [
      "error",
      {
        skipBlankLines: false,
        ignoreComments: false,
      },
    ],
    "prefer-template": "error",
    "template-curly-spacing": "error",
    "no-else-return": "error",
    "no-undef-init": "error",
    "prefer-object-spread": "error",
    "import/newline-after-import": "error",
    "import/first": "error",
    quotes: ["error", "single"],
    "no-console": "off",
    "no-unused-vars": "warn",
      "import/order": [
      "error",
      {
        groups: ["builtin", "external", "internal"],
        "newlines-between": "always",
      },
    ],
    // The following node-specific rules are turned off as they are not relevant.
    "node/no-unsupported-features/es-syntax": "off",
    "node/no-missing-import": "off",
  },
};

export default eslintConfig;