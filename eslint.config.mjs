import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Vendored ui-ux-pro-max skill assets -- third-party scripts we don't
      // author or ship. Linting them fails the repo's own lint command on
      // rules (CommonJS require) that don't apply to them.
      ".claude/**",
    ],
  },
];

export default eslintConfig;
