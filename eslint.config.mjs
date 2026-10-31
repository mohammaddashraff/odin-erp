import tseslint from 'typescript-eslint';
export default [
 {ignores:['**/node_modules/**','**/dist/**','**/.next*/**','.av8/**','output/**','**/generated/**']},
 {files:['apps/**/*.{ts,tsx}','scripts/**/*.{js,mjs,cjs}'],languageOptions:{parser:tseslint.parser,ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}}},rules:{
  'no-debugger':'error','no-eval':'error','no-implied-eval':'error','no-unreachable':'error','no-unsafe-finally':'error','no-dupe-args':'error','no-dupe-else-if':'error','no-duplicate-case':'error','no-constant-binary-expression':'error','use-isnan':'error','valid-typeof':'error'
 }}
];
