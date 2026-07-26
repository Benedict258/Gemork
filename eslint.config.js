import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-return-await": "error",
      "consistent-return": "warn",
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/*.js", "**/*.d.ts"],
  },
];
