import { Linter } from "eslint";

const eslintConfig: Linter.Config = {
  env: {
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  plugins: ["import", "node", "promise"],
  extends: [
    "eslint:recommended",
    "plugin:import/recommended",
    "plugin:node/recommended",
    "plugin:promise/recommended",
  ],
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
        // MemberExpression: null,
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
    // "react/jsx-one-expression-per-line": "error",
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
    "node/no-unsupported-features/es-syntax": "off",
    "node/no-missing-import": "off",
    "promise/always-return": "off",
    "promise/no-nesting": "off",
  },
};

export default eslintConfig;
