// Object names are untrusted, so the viewer never hands a string to the HTML parser.
// eslint-plugin-react's `react/no-danger` would cover the JSX case, but it does not support
// ESLint 10 (see DECISIONS.md D-045), so core `no-restricted-syntax` enforces the same rule.

/** `no-restricted-syntax` options that ban every path from a string to parsed HTML. */
export const NO_RAW_HTML = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      "Render object names as React text; dangerouslySetInnerHTML is banned (react/no-danger).",
  },
  {
    selector:
      "AssignmentExpression > MemberExpression.left:matches([property.name=/^(innerHTML|outerHTML)$/], [property.value=/^(innerHTML|outerHTML)$/])",
    message: "Assigning innerHTML/outerHTML is banned; render text with React or textContent.",
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: "insertAdjacentHTML is banned; render text with React or textContent.",
  },
];
